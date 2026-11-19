"use client";
// ============================================================ CEREBRO DE LA IA INTERNA
// Pipeline de entendimiento en 5 etapas (todo local, sin llamadas de red):
//   1. NORMALIZAR   — corrige errores de escritura, tildes, jerga y abreviaturas.
//   2. EXTRAER      — entidades: fechas, montos, horas, duraciones, nombres, códigos.
//   3. INTERPRETAR  — puntúa cada intención conocida contra la frase normalizada
//                     y elige la más lógica (con desempate por especificidad).
//   4. EJECUTAR     — aplica el cambio real sobre la barbería (transacción auditable).
//   5. AUTOAUDITAR  — verifica el efecto contra la base de datos real; si el
//                     resultado no es 10/10 (entidad faltante, ambigüedad, efecto
//                     no verificado), re-interpreta con la pista del fallo y
//                     reintenta en loop (máx. 3 pasadas). Si aún no llega a 10/10,
//                     responde con una pregunta concreta en vez de fallar.
// Toda orden queda en el historial de auditoría, como cualquier cambio manual.

import {
  getDB, mutateDB, audit, cuid, barberAccessCode, getBookingConfig, setBookingConfig,
  saveAdminData, getAdminData, type Barber, type Service, type Availability,
} from "@/lib/store";
import {
  dateKeyInBogota, addDaysKey, todayKey, dayOfWeekInBogota, dayStartUtc,
} from "@/lib/time";
import { blockDay, unblockDay, changeStatus } from "@/lib/engines/booking";

export type AssistantReply = { text: string; ok: boolean; actions?: string[]; confidence?: number };

// ============================================================ 1. NORMALIZACIÓN
/** Diccionario de errores de escritura y jerga → forma canónica. */
const FIXES: Array<[RegExp, string]> = [
  // verbos y conjugaciones coloquiales (cada regex ancla principio y fin de palabra)
  [/\bbloke(ar|o|a)\b/g, "bloquear"],
  [/\bbloki(ar|o|a)\b/g, "bloquear"],
  [/\bbloq[eu]e(ar|o|a)\b/g, "bloquear"],
  [/\bdesbloki(ar|o)\b/g, "desbloquear"],
  [/\bdesbloke(ar|o)\b/g, "desbloquear"],
  [/\bkre(ar|o|a)\b/g, "crear"],
  [/\bagreg(ue|ar|o)\b/g, "agregar"],
  [/\bmodifik(ar|o|a)\b/g, "modificar"],
  [/\bkambi(ar|o|a)\b/g, "cambiar"],
  [/\baktib(ar|o|a)\b/g, "activar"],
  [/\bdesaktib(ar|o|a)\b/g, "desactivar"],
  [/\bas(er|a)\b/g, "hacer"],
  [/\bservisi[oa]s?\b/g, "servicio"],
  [/\bservci[oa]s?\b/g, "servicio"],
  [/\bsevici[oa]s?\b/g, "servicio"],
  [/\bbarve[rs]?\b/g, "barbero"],
  [/\bbarbre\b/g, "barbero"],
  [/\bpresi[oa]s?\b/g, "precio"],
  [/\bprecci[oa]s?\b/g, "precio"],
  [/\bhorarr?i[oa]s?\b/g, "horario"],
  [/\bdurason\b/g, "duracion"],
  [/\bduracson\b/g, "duracion"],
  [/\bagend(ar|a|o)\b/g, "agenda"],
  [/\bfumigaci[on]n?\b/g, "fumigacion"],
  [/\bfumig(ar|amos|o|a)\b/g, "fumigacion"],
  [/\bvacasiones\b/g, "vacaciones"],
  [/\bbaciones\b/g, "vacaciones"],
  [/\bxq\b/g, "porque"],
  [/\bq\b/g, "que"],
  [/\bdnd\b/g, "donde"],
  [/\bx\b/g, "por"],
];

function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/\s+/g, " ")
    .trim();
}

/** Normalización agresiva: aplica el diccionario de errores comunes. */
function deepNorm(raw: string): string {
  let q = norm(raw);
  // separar puntuación para que \b funcione bien
  q = q.replace(/[,;:!?¿¡]/g, " ").replace(/\s+/g, " ").trim();
  for (const [re, rep] of FIXES) q = q.replace(re, rep);
  return q;
}

// ============================================================ 2. EXTRACCIÓN DE ENTIDADES
const MESES: Record<string, number> = {
  enero: 1, ene: 1, febrero: 2, feb: 2, marzo: 3, mar: 3, abril: 4, abr: 4, mayo: 5,
  junio: 6, jun: 6, julio: 7, jul: 7, agosto: 8, ago: 8, septiembre: 9, sept: 9, setiembre: 9,
  octubre: 10, oct: 10, noviembre: 11, nov: 11, diciembre: 12, dic: 12,
};
const DIAS = ["domingo", "lunes", "martes", "miercoles", "jueves", "viernes", "sabado"];
const DOW: Record<string, number> = {
  domingo: 0, dom: 0, lunes: 1, lun: 1, martes: 2, mar: 2, marte: 2,
  miercoles: 3, mie: 3, jueves: 4, jue: 4, viernes: 5, vie: 5, sabado: 6, sab: 6,
};

/**
 * Resuelve todas las fechas de la frase a claves "YYYY-MM-DD" (zona Bogotá).
 * Soporta: "el 24", "24 de noviembre", "24 noviembre", "24/11", "24-11-2026",
 * "mañana", "pasado mañana", "el proximo martes", "hoy", "este viernes".
 */
function extractDates(q: string): string[] {
  const out: string[] = [];
  const today = todayKey();
  const push = (k: string) => { if (k && !out.includes(k)) out.push(k); };

  // relativas
  if (/\bhoy\b/.test(q)) push(today);
  if (/\bmanana\b/.test(q) && !/\bde manana\b/.test(q)) push(addDaysKey(today, 1));
  if (/\bpasado manana\b/.test(q)) push(addDaysKey(today, 2));

  // "24 de noviembre [de 2026]" | "24 noviembre" | "noviembre 24"
  const dmy = q.match(/(\d{1,2})\s*(?:de\s*)?(enero|ene|febrero|feb|marzo|mar|abril|abr|mayo|junio|jun|julio|jul|agosto|ago|septiembre|setiembre|sept|octubre|oct|noviembre|nov|diciembre|dic)\s*(?:de\s*(\d{4}))?/);
  const myd = q.match(/(enero|febrero|marzo|abril|mayo|junio|julio|agosto|septiembre|setiembre|octubre|noviembre|diciembre)\s+(\d{1,2})\s*(?:de\s*(\d{4}))?/);
  if (dmy) {
    const day = Number(dmy[1]);
    const month = MESES[dmy[2]];
    const year = dmy[3] ? Number(dmy[3]) : Number(today.slice(0, 4));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let k = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      // si esa fecha ya pasó este año y no se dijo el año, es del próximo año
      if (!dmy[3] && k < today) k = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      push(k);
    }
  } else if (myd) {
    const month = MESES[myd[1]];
    const day = Number(myd[2]);
    const year = myd[3] ? Number(myd[3]) : Number(today.slice(0, 4));
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let k = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!myd[3] && k < today) k = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      push(k);
    }
  }

  // "24/11" o "24/11/2026" o "24-11" (día primero, formato colombiano)
  const slash = q.match(/\b(\d{1,2})[\/\-](\d{1,2})(?:[\/\-](\d{2,4}))?\b/);
  if (slash && !dmy) {
    const day = Number(slash[1]);
    const month = Number(slash[2]);
    let year = slash[3] ? Number(slash[3]) : Number(today.slice(0, 4));
    if (String(year).length === 2) year = 2000 + year;
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      let k = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (!slash[3] && k < today) k = `${year + 1}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      push(k);
    }
  }

  // "el 24" (día del mes en curso o el próximo mes si ya pasó)
  const bareDay = q.match(/(?:el|los|dia|día|para el|del)\s+(\d{1,2})\b(?!\s*(?:de\s*)?(?:enero|feb|marzo|abril|mayo|junio|julio|agosto|sept|octubre|noviembre|dic|minutos|min|pesos|cop))/);
  if (bareDay && !dmy && !slash) {
    const day = Number(bareDay[1]);
    if (day >= 1 && day <= 31) {
      const y = Number(today.slice(0, 4));
      const m = Number(today.slice(5, 7));
      let k = `${y}-${String(m).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      if (k < today) {
        const nextM = m === 12 ? 1 : m + 1;
        const nextY = m === 12 ? y + 1 : y;
        k = `${nextY}-${String(nextM).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      }
      push(k);
    }
  }

  // "el proximo martes" / "este viernes" / "el miercoles que viene"
  const nextDow = q.match(/(?:proximo|proxima|este|esta|que viene|siguiente)?\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado)\b/);
  if (nextDow && /(proximo|proxima|este|esta|que viene|siguiente|el|los)\s*$/.test(q.slice(0, nextDow.index!))) {
    const target = DOW[nextDow[1]];
    for (let i = 1; i <= 14; i++) {
      const k = addDaysKey(today, i);
      if (dayOfWeekInBogota(dayStartUtc(k)) === target) { push(k); break; }
    }
  }
  return out;
}

function moneyToNumber(raw: string): number | null {
  const clean = raw.replace(/[.$\s]/g, "").replace(/,/g, "");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/** Todos los montos de la frase, en pesos COP ("25000", "25.000", "25 mil", "40k"). */
function extractMoney(q: string): number[] {
  const out: number[] = [];
  let m: RegExpExecArray | null;
  // "25 mil" / "2,5 mil"
  const mil = q.matchAll(/(\d+(?:[.,]\d+)?)\s*(?:mil|m)\b/g);
  for (const x of mil) {
    const n = Number(x[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n * 1000));
  }
  // "40k" / "2.5k"
  const k = q.matchAll(/(\d+(?:[.,]\d+)?)\s*k\b/g);
  for (const x of k) {
    const n = Number(x[1].replace(",", "."));
    if (Number.isFinite(n) && n > 0) out.push(Math.round(n * 1000));
  }
  // números de 4+ dígitos (precio en COP) con separadores de miles
  const nums = q.matchAll(/\$?\s?(\d{1,3}(?:[.,]\d{3})+|\d{4,6})\b/g);
  for (const x of nums) {
    const n = moneyToNumber(x[1]);
    if (n) out.push(n);
  }
  return out.filter((n, i) => n > 0 && out.indexOf(n) === i);
}

function minutesFrom(raw: string): number | null {
  const mMin = raw.match(/(\d{1,3})\s*(?:min(?:utos?)?|')/i);
  if (mMin) {
    const n = Number(mMin[1]);
    if (n >= 5 && n <= 300) return n;
  }
  const mHr = raw.match(/(\d{1,2})\s*(?:h(?:oras?|rs?)?)\s*(\d{1,2})?(?!\d)/i);
  if (mHr) {
    const total = Number(mHr[1]) * 60 + (mHr[2] ? Number(mHr[2]) : 0);
    if (total >= 5 && total <= 300) return total;
  }
  return null;
}

const HHMM = /(\d{1,2})[:.h](\d{2})/g;
function parseTimes(input: string): string[] {
  const out: string[] = [];
  let m: RegExpExecArray | null;
  HHMM.lastIndex = 0;
  while ((m = HHMM.exec(input))) {
    const h = Number(m[1]);
    const min = Number(m[2]);
    if (h >= 0 && h <= 23 && min >= 0 && min <= 59) out.push(`${String(h).padStart(2, "0")}:${String(min).padStart(2, "0")}`);
  }
  // "de 9 a 18" sin minutos
  const loose = [...input.matchAll(/(?:de|desde|a|hasta|asta|entre)\s+(\d{1,2})(?![\d:.h])(?!\s*(?:min|pesos|cop|mil|k\b))/g)].map((x) => Number(x[1]));
  for (const h of loose) {
    if (h >= 0 && h <= 23) {
      const t = `${String(h).padStart(2, "0")}:00`;
      if (!out.includes(t)) out.push(t);
    }
  }
  // "de 9 a 6" en una barbería: el cierre suelto < 8 es de la tarde (6 → 18:00)
  if (loose.length >= 2 && loose[0] >= 8 && loose[1] < 8) {
    const pm = `${String(loose[1] + 12).padStart(2, "0")}:00`;
    const naive = `${String(loose[1]).padStart(2, "0")}:00`;
    const i = out.indexOf(naive);
    if (i >= 0 && pm <= "23:59") out[i] = pm;
  }
  return out.filter((t, i) => out.indexOf(t) === i);
}

function findService(db: ReturnType<typeof getDB>, name: string): Service | undefined {
  const n = norm(name).replace(/^(el|la|los|las|del|de)\s+/g, "").trim();
  if (!n || n.length < 2) return undefined;
  const normName = (x: string) => norm(x).replace(/^(el|la|los|las|del|de)\s+/g, "").trim();
  return (
    db.services.find((s) => normName(s.name) === n) ??
    db.services.find((s) => normName(s.name).includes(n) || n.includes(normName(s.name)))
  );
}

function findBarber(db: ReturnType<typeof getDB>, name: string): Barber | undefined {
  const n = norm(name).replace(/^(el|la|los|las|del|de)\s+/g, "").trim();
  if (!n || n.length < 2) return undefined;
  const normName = (x: string) => norm(x).replace(/^(el|la|los|las|del|de)\s+/g, "").trim();
  return (
    db.barbers.find((b) => normName(b.name) === n) ??
    db.barbers.find((b) => normName(b.name).includes(n) || n.includes(normName(b.name)))
  );
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

function copiarDiaBase(): Availability[] {
  const out: Availability[] = [];
  for (let day = 2; day <= 6; day++) {
    out.push({ dayOfWeek: day, startTime: "10:00", endTime: "13:00", active: true });
    out.push({ dayOfWeek: day, startTime: "14:00", endTime: "19:00", active: true });
  }
  return out;
}

/** Quita de la frase las partes ya usadas (fechas, montos) para encontrar el texto libre. */
function stripEntities(q: string): string {
  return q
    .replace(/(?:el|los|dia|para el|del)\s+\d{1,2}\b/g, " ")
    .replace(/\d{1,2}\s*(?:de\s*)?(?:enero|feb|marzo|abril|mayo|junio|julio|agosto|sept|octubre|noviembre|dic)\w*/g, " ")
    .replace(/\$?\s?\d[\d.,]*\s*(?:pesos|cop|mil|k)?\b/g, " ")
    .replace(/\d+\s*(?:minutos|min|h|horas)\b/g, " ")
    .replace(/\d{1,2}[:.h]\d{2}/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// ============================================================ 3-5. INTENCIÓN + EJECUCIÓN + AUTOAUDITORÍA
type Ctx = {
  raw: string;       // frase original
  q: string;         // normalizada profunda
  dates: string[];   // fechas resueltas (YYYY-MM-DD)
  money: number[];   // montos en COP
  times: string[];   // horas HH:MM
  mins: number | null; // duración en minutos
  hint?: string;     // pista de la autoauditoría para la siguiente pasada
};

/** Ejecutores: cada uno devuelve la respuesta final, o null si no aplica. */
type Executor = {
  id: string;
  score: (ctx: Ctx) => number; // 0-10: qué tan seguro es que esta sea la intención
  run: (ctx: Ctx) => AssistantReply | null; // null = "no apliqué nada"
  why: (ctx: Ctx) => string; // qué le falta para ser 10/10 (para la autoauditoría)
};

// ---------- ayuda ----------
function helpReply(): AssistantReply {
  return {
    ok: true,
    text:
      "Soy la IA interna de tu barbería y puedo cambiar TODO en tiempo real. Escríbeme como sea, entiendo aunque escribas rápido:\n" +
      "• «bloquea el 24 que vamos a fumigar» / «cerramos el 25 por vacaciones»\n" +
      "• «abre de nuevo el 24» / «qué días hay cerrados?»\n" +
      "• «crea el servicio Fade de 30 mil, 45 minutos»\n" +
      "• «el corte clasico ahora vale 40 mil» · «la barba dura 30 min»\n" +
      "• «crea el barbero Luis» · «desactiva a Luis» · «horario de Luis: lun a sáb de 9 a 6»\n" +
      "• «el whatsapp es 3211234567» · «cambia la frase del membrete a …»\n" +
      "• «cuántas citas hay mañana?» · «cancela la cita MB-ABC123»\n" +
      "• «que las citas salgan cada 30 minutos» · «registra gasto de 50 mil de insumos»\n" +
      "Todo queda en el Historial con antes y después.",
    actions: ["ayuda"],
  };
}

// ---------- ejecutores de acciones ----------
const EXECUTORS: Executor[] = [
  // ===== BLOQUEAR DÍA =====
  {
    id: "block_day",
    score: (c) => {
      let s = 0;
      if (/\b(bloquea|bloquear|bloqueo|bloqueo|cierra|cerrar|cerramos|cerrado|cierre|fumigacion|vacaciones|festivo|descanso|no abrimos|no abrir|no atendemos|libre|no hay servicio)\b/.test(c.q)) s += 4;
      if (/agenda|dia|fecha|jornada|toda la barberia|el local|la barberia/.test(c.q)) s += 2;
      if (c.dates.length > 0) s += 3;
      if (c.hint === "FALTA_FECHA") s -= 8;
      return s;
    },
    why: (c) => (c.dates.length === 0 ? "FALTA_FECHA" : "OK"),
    run: (c) => {
      if (c.dates.length === 0) return null;
      // motivo: texto libre sin la fecha ni el verbo
      const motivo =
        /fumigac/.test(c.q) ? "Fumigación" :
        /vacacion/.test(c.q) ? "Vacaciones" :
        /festivo|fiesta|patria/.test(c.q) ? "Festivo" :
        /descans/.test(c.q) ? "Descanso" :
        /mantenimient|arreglo|obra/.test(c.q) ? "Mantenimiento" :
        /emergencia|urgencia|imprevisto/.test(c.q) ? "Emergencia" :
        "Cerrado";
      const lines: string[] = [];
      const allCancelled: Array<{ code: string; clientName: string; time: string; barberName: string }> = [];
      for (const k of c.dates) {
        const db = getDB();
        const ya = db.blockedDates?.[k];
        if (ya) { lines.push(`• ${k}: ya estaba cerrado (${ya}).`); continue; }
        const { cancelled } = blockDay(k, motivo, "IA interna");
        allCancelled.push(...cancelled);
        lines.push(`• ${k} (${DIAS[dayOfWeekInBogota(dayStartUtc(k))]}): cerrado por ${motivo}.`);
      }
      let text = `${c.dates.length > 1 ? "Días cerrados" : "Día cerrado"} para toda la barbería:\n${lines.join("\n")}\nEl sitio público ya no muestra horas esos días y se sincroniza con todos los dispositivos.`;
      if (allCancelled.length > 0) {
        text += `\n\nCancelé ${allCancelled.length} cita(s) de esos días — avísales a los clientes:\n${allCancelled.map((x) => `• ${x.code} · ${x.clientName} · ${x.time} (con ${x.barberName})`).join("\n")}`;
      }
      return { ok: true, text, actions: c.dates.map((k) => `bloquear:${k}`) };
    },
  },
  // ===== DESBLOQUEAR DÍA =====
  {
    id: "unblock_day",
    score: (c) => {
      let s = 0;
      if (/\b(desbloquea|desbloquear|abre|abrir|abrimos|reabrir|reabre|habilita|habilitar)\b/.test(c.q) && /\b(de nuevo|otra vez|el dia|ese dia|reabrir|habilitar|desbloque)\b/.test(c.q)) s += 5;
      if (/\b(abre de nuevo|abrir de nuevo|volver a abrir|ya abrimos|quita el bloqueo|quita el cierre|desbloquea|desbloqueo)\b/.test(c.q)) s += 5;
      if (c.dates.length > 0) s += 3;
      if (c.hint === "FALTA_FECHA") s -= 8;
      return s;
    },
    why: (c) => (c.dates.length === 0 ? "FALTA_FECHA" : "OK"),
    run: (c) => {
      if (c.dates.length === 0) return null;
      const lines: string[] = [];
      let alguno = false;
      for (const k of c.dates) {
        const ok = unblockDay(k, "IA interna");
        lines.push(`• ${k}: ${ok ? "abierto de nuevo, el sitio vuelve a mostrar horas." : "no estaba cerrado."}`);
        if (ok) alguno = true;
      }
      return { ok: alguno, text: `Listo:\n${lines.join("\n")}`, actions: alguno ? c.dates.map((k) => `desbloquear:${k}`) : [] };
    },
  },
  // ===== CONSULTAR DÍAS CERRADOS =====
  {
    id: "list_blocked",
    score: (c) => {
      let s = 0;
      if (/(que dias|cuales dias|dias cerrados|dias bloqueados|hay cierre|esta cerrado|tenemos cerrado)/.test(c.q)) s += 5;
      if (!/bloquea|cerrar el|cierra el/.test(c.q)) s += 2;
      if (c.dates.length > 0 && /cerrad|bloquead/.test(c.q)) s += 2;
      return s;
    },
    why: () => "OK",
    run: () => {
      const db = getDB();
      const keys = Object.keys(db.blockedDates ?? {}).sort();
      if (keys.length === 0) return { ok: true, text: "No hay días cerrados: la barbería está abierta según los horarios de cada barbero." };
      const lines = keys.map((k) => `• ${k} (${DIAS[dayOfWeekInBogota(dayStartUtc(k))]}): ${db.blockedDates[k]}`);
      return { ok: true, text: `Días cerrados actualmente:\n${lines.join("\n")}\nPara abrir uno dime: «abre el 24».` };
    },
  },
  // ===== CONSULTAR AGENDA =====
  {
    id: "agenda_query",
    score: (c) => {
      let s = 0;
      if (/(cuantas citas|cuantos cortes|que citas|ver agenda|mi agenda|la agenda|citas hay|citas tengo|esta agendado|reservas)/.test(c.q)) s += 5;
      if (c.dates.length > 0) s += 2;
      if (/pendiente|confirmad|completad|cancelad/.test(c.q)) s += 1;
      return s;
    },
    why: () => "OK",
    run: (c) => {
      const db = getDB();
      let list = db.appointments;
      if (c.dates.length > 0) {
        const dayStart = dayStartUtc(c.dates[0]);
        const dayEnd = new Date(dayStart.getTime() + 24 * 3600 * 1000);
        list = list.filter((a) => a.startTime < dayEnd.toISOString() && a.endTime > dayStart.toISOString());
        if (list.length === 0) {
          const cerrado = db.blockedDates?.[c.dates[0]];
          return { ok: true, text: cerrado ? `No hay citas el ${c.dates[0]}: el día está cerrado (${cerrado}).` : `No hay citas agendadas para el ${c.dates[0]}.` };
        }
        const lines = list
          .slice()
          .sort((a, b) => a.startTime.localeCompare(b.startTime))
          .map((a) => {
            const s = db.services.find((x) => x.id === a.serviceId);
            const b = db.barbers.find((x) => x.id === a.barberId);
            const hh = new Date(new Date(a.startTime).getTime() - 5 * 3600 * 1000).toISOString().slice(11, 16); // Bogotá = UTC-5
            return `• ${hh} · ${a.clientName} · ${s?.name ?? "?"} · ${b?.name ?? "?"} · ${a.code} (${a.status})`;
          });
        return { ok: true, text: `Citas del ${c.dates[0]}:\n${lines.join("\n")}` };
      }
      if (list.length === 0) return { ok: true, text: "No hay citas en la agenda." };
      const prox = list
        .filter((a) => a.status === "RESERVED" || a.status === "CONFIRMED")
        .sort((a, b) => a.startTime.localeCompare(b.startTime))
        .slice(0, 10);
      const lines = prox.map((a) => {
        const s = db.services.find((x) => x.id === a.serviceId);
        const b = db.barbers.find((x) => x.id === a.barberId);
        const hh = new Date(new Date(a.startTime).getTime() - 5 * 3600 * 1000).toISOString().slice(11, 16); // Bogotá = UTC-5
        return `• ${dateKeyInBogota(new Date(a.startTime))} ${hh} · ${a.clientName} · ${s?.name ?? "?"} · ${b?.name ?? "?"} · ${a.code}`;
      });
      return { ok: true, text: `Próximas citas (${prox.length} de ${list.length} en total):\n${lines.join("\n")}` };
    },
  },
  // ===== CANCELAR CITA POR CÓDIGO =====
  {
    id: "cancel_appt",
    score: (c) => {
      let s = 0;
      if (/(cancelar|anular|anulo)/.test(c.q) && /(cita|reserva|corte)/.test(c.q)) s += 5;
      if (/mb-[a-z0-9]{4,8}/.test(c.q)) s += 4;
      return s;
    },
    why: (c) => (/mb-[a-z0-9]{4,8}/.test(c.q) ? "OK" : "FALTA_CODIGO"),
    run: (c) => {
      const code = c.q.match(/mb-([a-z0-9]{4,8})/)?.[0];
      if (!code) return null;
      const db = getDB();
      const appt = db.appointments.find((a) => a.code.toLowerCase() === code);
      if (!appt) return { ok: false, text: `No encontré ninguna cita con el código ${code.toUpperCase()}.` };
      if (appt.status === "CANCELLED") return { ok: true, text: `${code.toUpperCase()} ya estaba cancelada.` };
      if (appt.status === "COMPLETED") return { ok: false, text: `${code.toUpperCase()} ya está completada; no se puede cancelar.` };
      changeStatus(appt.id, "CANCELLED", "IA interna", "Cancelada por el dueño vía IA");
      const s = db.services.find((x) => x.id === appt.serviceId);
      return { ok: true, text: `Cita ${code.toUpperCase()} cancelada: ${appt.clientName} · ${s?.name ?? "?"} · ${dateKeyInBogota(new Date(appt.startTime))}.` , actions: [`cancelar:${code}`] };
    },
  },
  // ===== INTERVALO =====
  {
    id: "slot_step",
    score: (c) => {
      let s = 0;
      if (/(cada cuanto|intervalo|que las citas salgan|que salgan|espaci)/.test(c.q)) s += 5;
      if (/(minutos|min)/.test(c.q) && /\d/.test(c.q)) s += 3;
      return s;
    },
    why: (c) => (/\d/.test(c.q) ? "OK" : "FALTA_NUMERO"),
    run: (c) => {
      const m = c.q.match(/(\d{1,2})\s*(?:minutos|min)?/);
      if (!m) return null;
      const step = Number(m[1]);
      if (step < 5 || step > 60) return { ok: false, text: "El intervalo debe estar entre 5 y 60 minutos." };
      setBookingConfig({ slotStepMin: step });
      audit("BOOKING", "config", "SET_SLOT_STEP", "IA interna", null, { slotStepMin: step });
      return { ok: true, text: `Listo: las citas ahora salen cada ${step} minutos. Se refleja al instante en el sitio público.`, actions: [`intervalo:${step}`] };
    },
  },
  // ===== ANTICIPACIÓN =====
  {
    id: "min_lead",
    score: (c) => (/(anticipacion|con cuanto tiempo|minimo de anticipacion)/.test(c.q) && /\d/.test(c.q) ? 7 : 0),
    why: () => "OK",
    run: (c) => {
      const m = c.q.match(/(\d{1,3})/);
      if (!m) return null;
      const lead = Number(m[1]);
      if (lead < 0 || lead > 240) return { ok: false, text: "La anticipación debe estar entre 0 y 240 minutos." };
      setBookingConfig({ minLeadMin: lead });
      audit("BOOKING", "config", "SET_MIN_LEAD", "IA interna", null, { minLeadMin: lead });
      return { ok: true, text: `Listo: anticipación mínima de ${lead} minutos para reservar el mismo día.`, actions: [`anticipacion:${lead}`] };
    },
  },
  // ===== HORARIO DE BARBERO =====
  {
    id: "barber_schedule",
    score: (c) => {
      let s = 0;
      if (/(horario de|trabaja|disponibilidad de|su horario)/.test(c.q)) s += 4;
      if (c.times.length >= 2) s += 3;
      if (/(lunes|martes|miercoles|jueves|viernes|sabado|domingo|todos los dias)/.test(c.q)) s += 2;
      if (c.hint === "FALTA_HORAS") s -= 8;
      return s;
    },
    why: (c) => (c.times.length < 2 ? "FALTA_HORAS" : "OK"),
    run: (c) => {
      if (c.times.length < 2) return null;
      const db = getDB();
      // nombre del barbero: texto entre "de" y ":" o antes de "trabaja"
      const raw = c.raw;
      const schedMatch = raw.match(/horario\s+de\s+([^:]{2,40}?)\s*:\s*(.+)$/i) ?? raw.match(/([^,]{2,40}?)\s+trabaja\s+(?:el\s+|los\s+)?(.+)$/i) ?? raw.match(/(?:el\s+)?(?:horario|disponibilidad)\s+de\s+(.+)$/i);
      if (!schedMatch) return null;
      const barber = findBarber(db, schedMatch[1]);
      if (!barber) {
        const guess = findBarber(db, stripEntities(c.q).split(/\s+/).slice(0, 3).join(" "));
        if (!guess) return null;
        return applySchedule(guess, c);
      }
      return applySchedule(barber, c);
    },
  },
  // ===== CREAR SERVICIO =====
  {
    id: "create_service",
    score: (c) => {
      let s = 0;
      if (/\b(crea|crear|creo|nuevo|nueva|agrega|agregar|quiero|pon|poner|mete)\b/.test(c.q) && /\bservicio|\bcorte|\bbarba|\bfade\b/.test(c.q)) s += 5;
      if (c.money.length > 0) s += 2;
      if (c.mins) s += 2;
      if (c.hint === "FALTA_PRECIO" || c.hint === "FALTA_DURACION" || c.hint === "FALTA_NOMBRE") s -= 8;
      return s;
    },
    why: (c) => {
      if (c.money.length === 0) return "FALTA_PRECIO";
      if (!c.mins) return "FALTA_DURACION";
      return "OK";
    },
    run: (c) => {
      if (c.money.length === 0 || !c.mins) return null;
      const db = getDB();
      // nombre: texto entre "servicio" y el primer número
      const nameMatch = c.q.match(/servicio\s+(.+?)(?=\s+(?:de\s+)?\$?\s?\d|\s+\d+\s*minutos|\s+\d+\s*h\b|,|$)/);
      let name = (nameMatch?.[1] ?? "").replace(/^(el|la|un|una)\s+/, "").trim();
      if (!name) {
        // fallback: texto tras "servicio" sin entidades
        const t = stripEntities(c.q);
        name = (t.match(/servicio\s+(.+)$/)?.[1] ?? "").replace(/^(el|la|un|una)\s+/, "").trim();
      }
      if (name.length < 3) return { ok: false, text: "¿Cómo se llama el servicio? Escríbelo así: «crea el servicio Barba premium de 25000, 30 minutos»." };
      const existing = findService(db, name);
      if (existing) return { ok: false, text: `Ya existe un servicio parecido: «${existing.name}». Si quieres cambiarlo dime: «cambia el precio de ${existing.name} a …».` };
      const svc: Service = { id: cuid("svc"), name, description: "", price: Math.round(c.money[0]), durationMin: c.mins, active: true, sortOrder: db.services.length + 1 };
      const { saved } = mutateDB((d) => {
        d.services.push(svc);
        for (const b of d.barbers) if (b.active) d.barberServices[`${b.id}:${svc.id}`] = true;
      });
      if (!saved) return { ok: false, text: "El almacenamiento del navegador está lleno; no pude guardar el servicio." };
      audit("SERVICE", svc.id, "CREATE", "IA interna", null, svc);
      return { ok: true, text: `Servicio creado: ${name} — ${fmtMoney(svc.price)} · ${svc.durationMin} min. Ya aparece en el sitio público y todos tus barberos pueden atenderlo.`, actions: [`crear-servicio:${name}`] };
    },
  },
  // ===== CAMBIAR PRECIO =====
  {
    id: "set_price",
    score: (c) => {
      let s = 0;
      if (/(precio|vale|cuesta|cobrar|valor)/.test(c.q)) s += 4;
      if (/(cambiar|poner|modificar|actualizar|ahora|subir|bajar|dejar)/.test(c.q)) s += 2;
      if (c.money.length > 0) s += 3;
      if (c.hint === "FALTA_SERVICIO") s -= 8;
      return s;
    },
    why: (c) => (c.money.length === 0 ? "FALTA_PRECIO" : "FALTA_SERVICIO"),
    run: (c) => {
      if (c.money.length === 0) return null;
      const db = getDB();
      const svc = findServiceInCtx(db, c);
      if (!svc) return svcNotFound(c);
      const price = c.money[0];
      const before = { ...svc };
      mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.price = Math.round(price); });
      audit("SERVICE", svc.id, "UPDATE_PRICE", "IA interna", before, { price: Math.round(price) });
      return { ok: true, text: `Precio de «${svc.name}» actualizado: ${fmtMoney(before.price)} → ${fmtMoney(price)}. Ya se ve en el sitio público. Las citas pasadas conservan su precio original.`, actions: [`precio:${svc.name}`] };
    },
  },
  // ===== CAMBIAR DURACIÓN =====
  {
    id: "set_duration",
    score: (c) => {
      let s = 0;
      if (/(duracion|durar|dema|tarda|tome)/.test(c.q)) s += 5;
      if (c.mins) s += 3;
      if (c.hint === "FALTA_SERVICIO") s -= 8;
      return s;
    },
    why: (c) => (!c.mins ? "FALTA_DURACION" : "FALTA_SERVICIO"),
    run: (c) => {
      if (!c.mins) return null;
      const db = getDB();
      const svc = findServiceInCtx(db, c);
      if (!svc) return svcNotFound(c);
      const before = { ...svc };
      mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.durationMin = c.mins!; });
      audit("SERVICE", svc.id, "UPDATE_DURATION", "IA interna", before, { durationMin: c.mins });
      return { ok: true, text: `Duración de «${svc.name}» actualizada: ${before.durationMin} → ${c.mins} min. Las horas disponibles en el sitio ya se recalculan con la nueva duración.`, actions: [`duracion:${svc.name}`] };
    },
  },
  // ===== RENOMBRAR SERVICIO =====
  {
    id: "rename_service",
    score: (c) => ((/(renombrar|cambiar el nombre|llamar|se llame|nuevo nombre)/.test(c.q)) ? 6 : 0),
    why: () => "OK",
    run: (c) => {
      const db = getDB();
      const m = c.raw.match(/(?:renombra|cambia\s+el\s+nombre\s+de(?:l)?|llama)\s+(?:el\s+servicio\s+)?(.+?)\s+(?:a|como)\s+(.+)$/i);
      if (!m) return null;
      const svc = findService(db, m[1]);
      if (!svc) return svcNotFound(c);
      const nuevo = m[2].trim();
      if (nuevo.length < 3) return { ok: false, text: "El nuevo nombre es demasiado corto." };
      const before = { ...svc };
      mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.name = nuevo; });
      audit("SERVICE", svc.id, "RENAME", "IA interna", before, { name: nuevo });
      return { ok: true, text: `Servicio renombrado: «${before.name}» → «${nuevo}».`, actions: [`renombrar:${nuevo}`] };
    },
  },
  // ===== CREAR BARBERO =====
  {
    id: "create_barber",
    score: (c) => {
      let s = 0;
      if (/\b(crea|crear|creo|nuevo|nueva|agrega|agregar|contrata|contratar|mete|meter|sumar)\b/.test(c.q) && /\b(barbero|barbera|peluquero|barber)\b/.test(c.q)) s += 7;
      return s;
    },
    why: () => "OK",
    run: (c) => {
      const m = c.q.match(/\b(?:crea|crear|creo|contrata|contratar|mete|agrega)\s+(?:el\s+|la\s+|un\s+|una\s+|al\s+)?(?:barbero|barbera|peluquero)\s+(?:llamado\s+|que\s+se\s+llame\s+)?(.+)$/);
      let name = (m?.[1] ?? "").replace(/\s+(?:con|que|de)\s+.*$/, "").trim();
      if (!name) {
        const t = stripEntities(c.q);
        name = (t.match(/(?:barbero|barbera|peluquero)\s+(.+)$/)?.[1] ?? "").replace(/\s+(?:con|que|de)\s+.*$/, "").trim();
      }
      if (name.length < 3) return { ok: false, text: "¿Cómo se llama el barbero? Ejemplo: «crea el barbero Luis»." };
      const db = getDB();
      if (findBarber(db, name)) return { ok: false, text: `Ya existe un barbero llamado «${findBarber(db, name)!.name}».` };
      const code = barberAccessCode(name);
      const id = cuid("b");
      const { saved } = mutateDB((d) => {
        d.barbers.push({
          id, name, bio: "", photo: null, code, active: true, phone: null, specialty: "",
          permissions: { "payments.register": true, "commissions.view": true, "settlements.view": true, "profile.edit": true },
          createdAt: new Date().toISOString(),
        });
        d.availability[id] = copiarDiaBase();
        for (const s of d.services) if (s.active) d.barberServices[`${id}:${s.id}`] = true;
      });
      if (!saved) return { ok: false, text: "El almacenamiento del navegador está lleno; no pude guardar al barbero." };
      audit("USER", id, "CREATE_BARBER", "IA interna", null, { name, code });
      return { ok: true, text: `Barbero creado: ${name}. Su código de acceso es ${code} (compárteselo con seguridad). Ya aparece en el sitio y atiende martes a sábado de 10:00 a 13:00 y 14:00 a 19:00; dime «Horario de ${name}: …» si quieres cambiarlo.`, actions: [`crear-barbero:${name}`] };
    },
  },
  // ===== ACTIVAR / DESACTIVAR / ELIMINAR =====
  {
    id: "toggle_entity",
    score: (c) => {
      let s = 0;
      if (/\b(activa|activar|desactiva|desactivar|elimina|eliminar|borra|borrar|quita|quitar|suspende|suspendar|mata)\b/.test(c.q)) s += 5;
      if (/\b(servicio|barbero|barbera|barber)\b/.test(c.q) || /\ba\s+[a-z]{3,}/.test(c.q)) s += 2;
      return s;
    },
    why: () => "OK",
    run: (c) => {
      const m = c.q.match(/\b(activa|activar|desactiva|desactivar|elimina|eliminar|borra|borrar|quita|quitar)\s+(?:el\s+|la\s+|los\s+|las\s+|al\s+)?(?:servicio\s+(?:de\s+|del\s+)?|barbero\s+|barbera\s+)?(?:a\s+|al\s+)?(.+)$/);
      if (!m) return null;
      const action = m[1];
      const target = m[2].replace(/[.,;]$/, "").trim();
      const db = getDB();
      const isService = findService(db, target);
      const isBarber = !isService ? findBarber(db, target) : undefined;
      if (!isService && !isBarber) return { ok: false, text: `No encontré «${target}» entre tus servicios ni barberos.` };

      if (isService) {
        if (/desactiv/.test(action)) {
          mutateDB((d) => { const s = d.services.find((x) => x.id === isService.id); if (s) s.active = false; });
          audit("SERVICE", isService.id, "DEACTIVATE", "IA interna", null, null);
          return { ok: true, text: `Servicio «${isService.name}» desactivado: ya no aparece para reservar (el historial de citas queda intacto).`, actions: [`desactivar-servicio:${isService.name}`] };
        }
        if (/^activ/.test(action)) {
          mutateDB((d) => { const s = d.services.find((x) => x.id === isService.id); if (s) s.active = true; });
          audit("SERVICE", isService.id, "ACTIVATE", "IA interna", null, null);
          return { ok: true, text: `Servicio «${isService.name}» activado: vuelve a aparecer en el sitio público.`, actions: [`activar-servicio:${isService.name}`] };
        }
        const used = db.appointments.some((a) => a.serviceId === isService.id);
        if (used) {
          mutateDB((d) => { const s = d.services.find((x) => x.id === isService.id); if (s) s.active = false; });
          audit("SERVICE", isService.id, "DEACTIVATE", "IA interna", null, { motivo: "eliminar con historial" });
          return { ok: true, text: `«${isService.name}» tiene citas en el historial, así que lo desactivé en lugar de borrarlo para no romper tus reportes. Ya no aparece para reservar.` };
        }
        mutateDB((d) => {
          d.services = d.services.filter((x) => x.id !== isService.id);
          for (const k of Object.keys(d.barberServices)) if (k.endsWith(`:${isService.id}`)) delete d.barberServices[k];
        });
        audit("SERVICE", isService.id, "DELETE", "IA interna", isService, null);
        return { ok: true, text: `Servicio «${isService.name}» eliminado del catálogo.`, actions: [`eliminar-servicio:${isService.name}`] };
      }

      if (isBarber) {
        if (/desactiv/.test(action)) {
          mutateDB((d) => { const b = d.barbers.find((x) => x.id === isBarber.id); if (b) b.active = false; });
          audit("USER", isBarber.id, "DEACTIVATE", "IA interna", null, null);
          return { ok: true, text: `${isBarber.name} quedó inactivo: no recibe citas nuevas ni aparece en el sitio. Sus citas existentes se mantienen.`, actions: [`desactivar-barbero:${isBarber.name}`] };
        }
        if (/^activ/.test(action)) {
          mutateDB((d) => { const b = d.barbers.find((x) => x.id === isBarber.id); if (b) b.active = true; });
          audit("USER", isBarber.id, "ACTIVATE", "IA interna", null, null);
          return { ok: true, text: `${isBarber.name} vuelve a estar activo y visible en el sitio público.`, actions: [`activar-barbero:${isBarber.name}`] };
        }
        const used = db.appointments.some((a) => a.barberId === isBarber.id);
        if (used) {
          mutateDB((d) => { const b = d.barbers.find((x) => x.id === isBarber.id); if (b) b.active = false; });
          audit("USER", isBarber.id, "DEACTIVATE", "IA interna", null, { motivo: "eliminar con historial" });
          return { ok: true, text: `${isBarber.name} tiene citas en el historial: lo desactivé en vez de borrarlo para proteger tus reportes.` };
        }
        mutateDB((d) => {
          d.barbers = d.barbers.filter((x) => x.id !== isBarber.id);
          delete d.availability[isBarber.id];
          for (const k of Object.keys(d.barberServices)) if (k.startsWith(`${isBarber.id}:`)) delete d.barberServices[k];
        });
        audit("USER", isBarber.id, "DELETE", "IA interna", isBarber, null);
        return { ok: true, text: `${isBarber.name} fue eliminado del equipo.`, actions: [`eliminar-barbero:${isBarber.name}`] };
      }
      return null;
    },
  },
  // ===== EDITAR SITIO / MEMBRETE / WHATSAPP =====
  {
    id: "site_edit",
    score: (c) => {
      let s = 0;
      if (/(membrete|frase|eslogan|lema|whatsapp|telefono|direccion|correo|email|titulo|banner|subtitulo|instagram|facebook|tiktok|red social)/.test(c.q)) s += 4;
      if (/(cambiar|poner|modificar|actualizar|dejar|es|nuevo|nueva)/.test(c.q)) s += 3;
      if (c.hint === "FALTA_VALOR") s -= 8;
      return s;
    },
    why: (c) => (c.q.includes("\"") || c.q.includes("«") || c.q.includes("»") || c.q.includes(":") || /\ba\s+\S/.test(c.q) ? "OK" : "FALTA_VALOR"),
    run: (c) => {
      const admin = getAdminData();
      const site = { ...admin.site };
      const q = c.q;
      let field: keyof typeof site | null = null;
      let value = "";
      const afterColon = (re: RegExp): string | null => {
        const m = c.raw.match(re);
        return m?.[1]?.trim() ?? null;
      };

      if (/(whatsapp|whatsap|wasa|wa\.me|numero de whatsapp)/.test(q)) {
        const digits = (q.match(/(\+?\d[\d\s.-]{8,})/)?.[1] ?? "").replace(/\D/g, "");
        const clean = digits.replace(/^57/, "");
        if (clean.length !== 10 || !/^3/.test(clean)) {
          return { ok: false, text: "Dime el número de WhatsApp con indicativo de Colombia, por ejemplo: «el whatsapp es 3211234567»." };
        }
        site.footerWhatsapp = `57${clean}`;
        field = "footerWhatsapp"; value = `57${clean}`;
      } else if (/(frase del membrete|membrete|eslogan|lema|frase de abajo)/.test(q)) {
        const v = afterColon(/(?:membrete|eslogan|lema)[^:«"“]*[:«"“]\s*(.+)$/i) ?? q.match(/(?:membrete|eslogan|lema)\s+(?:a|sea|es|diga)\s+(.+)$/)?.[1];
        if (!v || v.length < 3) return { ok: false, text: "Dime la nueva frase, por ejemplo: «cambia la frase del membrete a: Tu estilo, nuestra pasión»." };
        site.footerTagline = v.charAt(0).toUpperCase() + v.slice(1);
        field = "footerTagline"; value = site.footerTagline;
      } else if (/(telefono|tel|celular|numero de contacto)/.test(q) && !/whatsapp/.test(q)) {
        const num = (q.match(/\b3\d{9}\b/) ?? [])[0];
        if (!num) return { ok: false, text: "Dime el número, por ejemplo: «el teléfono es 3211234567»." };
        site.footerPhone = `+57 ${num.slice(0, 3)} ${num.slice(3, 6)} ${num.slice(6)}`;
        field = "footerPhone"; value = site.footerPhone;
      } else if (/(direccion|ubicacion|donde quedan|ubicados)/.test(q)) {
        const v = afterColon(/(?:direccion|ubicacion)[^:«"“]*[:«"“]\s*(.+)$/i) ?? q.match(/(?:direccion|ubicacion)\s+(?:a|sea|es)\s+(.+)$/)?.[1];
        if (!v || v.length < 3) return { ok: false, text: "Dime la dirección, por ejemplo: «la dirección es: Calle 80 #23-15»." };
        site.footerAddress = v;
        field = "footerAddress"; value = v;
      } else if (/(correo|email|e-mail)/.test(q)) {
        const v = q.match(/[\w.+-]+@[\w-]+\.[\w.]+/)?.[0];
        if (!v) return { ok: false, text: "Dime el correo, por ejemplo: «el correo es melo@barberia.com»." };
        site.footerEmail = v;
        field = "footerEmail"; value = v;
      } else if (/(instagram)/.test(q)) {
        const v = q.match(/@([\w.]+)/)?.[1] ?? afterColon(/instagram[^:«"“]*[:«"“]\s*(.+)$/i);
        if (!v) return { ok: false, text: "Dime el usuario de Instagram, por ejemplo: «el instagram es @melobarber»." };
        site.socialInstagram = `@${v.replace(/^@/, "")}`;
        field = "socialInstagram"; value = site.socialInstagram;
      } else if (/(titulo principal|titulo del sitio|titulo grande|banner)/.test(q)) {
        const v = afterColon(/(?:titulo|banner)[^:«"“]*[:«"“]\s*(.+)$/i);
        if (!v) return { ok: false, text: "Dime el nuevo título, por ejemplo: «el título principal es: LA MEJOR BARBERÍA»." };
        site.heroTitle = v;
        field = "heroTitle"; value = v;
      }
      if (!field) return null;
      saveAdminData({ ...admin, site });
      audit("SITE", String(field), "UPDATE", "IA interna", null, { field, value });
      return { ok: true, text: `Listo: ${field} actualizado a «${value}». Se ve al instante en el sitio y en todos los dispositivos.`, actions: [`sitio:${String(field)}`] };
    },
  },
  // ===== REGISTRAR GASTO =====
  {
    id: "add_expense",
    score: (c) => {
      let s = 0;
      if (/(gasto|gaste|pague|compre|salio|gastos|egreso)/.test(c.q)) s += 5;
      if (c.money.length > 0) s += 3;
      return s;
    },
    why: (c) => (c.money.length === 0 ? "FALTA_MONTO" : "OK"),
    run: (c) => {
      if (c.money.length === 0) return null;
      const amount = c.money[0];
      const cats: Array<[RegExp, string]> = [
        [/alquiler|arriendo|renta/, "ALQUILER"],
        [/insumo|producto|jabon|crema|papel|toalla|cuchilla|tinte/, "INSUMOS"],
        [/servicios|luz|agua|internet|gas|telefono/, "SERVICIOS"],
        [/mantenimient|arreglo|reparacion|maquina/, "MANTENIMIENTO"],
        [/nomina|sueldo|pago a|adicional/, "NOMINA_EXTRA"],
      ];
      let category = "OTROS";
      for (const [re, cat] of cats) if (re.test(c.q)) { category = cat; break; }
      const { saved } = mutateDB((d) => {
        d.expenses.push({
          id: cuid("exp"),
          description: c.raw.slice(0, 120),
          category: category as never,
          amount,
          method: null,
          notes: "Registrado por la IA interna",
          spentAt: new Date().toISOString(),
          createdByName: "IA interna",
        });
      });
      if (!saved) return { ok: false, text: "No pude guardar el gasto (almacenamiento lleno)." };
      audit("EXPENSE", "ia", "CREATE", "IA interna", null, { amount, category });
      return { ok: true, text: `Gasto registrado: ${fmtMoney(amount)} en ${category}. Lo ves ya en Gastos y entra en los reportes.`, actions: [`gasto:${amount}`] };
    },
  },
  // ===== CONSULTAS DE CATÁLOGO =====
  {
    id: "list_services",
    score: (c) => ((/(que servicios|lista de servicios|ver servicios|mis servicios|cuales servicios|hay de servicio)/.test(c.q) ? 7 : 0)),
    why: () => "OK",
    run: () => {
      const db = getDB();
      if (db.services.length === 0) return { ok: true, text: "No hay servicios creados todavía. Pídeme: «crea el servicio…»." };
      const lines = db.services.map((s) => `• ${s.name} — ${fmtMoney(s.price)} · ${s.durationMin} min ${s.active ? "" : "(inactivo)"}`);
      return { ok: true, text: `Estos son tus servicios:\n${lines.join("\n")}` };
    },
  },
  {
    id: "list_barbers",
    score: (c) => ((/(quienes son mis barberos|mis barberos|que barberos|lista de barberos|ver equipo|mi equipo|quien trabaja)/.test(c.q) ? 7 : 0)),
    why: () => "OK",
    run: () => {
      const db = getDB();
      if (db.barbers.length === 0) return { ok: true, text: "No hay barberos creados. Pídeme: «crea el barbero…»." };
      const lines = db.barbers.map((b) => `• ${b.name} — ${b.specialty || "sin especialidad"} · código ${b.code} ${b.active ? "" : "(inactivo)"}`);
      return { ok: true, text: `Tu equipo:\n${lines.join("\n")}` };
    },
  },
  {
    id: "booking_query",
    score: (c) => (/(cada cuanto salen|como esta el intervalo|intervalo actual)/.test(c.q) ? 7 : 0),
    why: () => "OK",
    run: () => {
      const cfg = getBookingConfig();
      return { ok: true, text: `Las citas salen cada ${cfg.slotStepMin} minutos y la anticipación mínima es de ${cfg.minLeadMin} minutos.` };
    },
  },
  {
    id: "horario_query",
    score: (c) => {
      if (/(horario|disponibilidad) de/.test(c.q) && !/(cambiar|cambialo|pon|poner|nuevo|establecer|de la mañana|de la tarde|\d{1,2}[:.h]\d{2})/.test(c.q)) return 6;
      return 0;
    },
    why: () => "OK",
    run: (c) => {
      const name = c.q.replace(/.*horario de/, "").replace(/.*disponibilidad de/, "").replace(/[?¿]/g, "").trim();
      const db = getDB();
      const b = findBarber(db, name);
      if (!b) return { ok: false, text: `No encontré a ningún barbero llamado «${name}».` };
      const rows = (db.availability[b.id] ?? []).filter((w) => w.active);
      if (rows.length === 0) return { ok: true, text: `${b.name} no tiene ventanas de horario: no recibe citas.` };
      const perDay = new Map<number, string[]>();
      for (const w of rows) {
        const arr = perDay.get(w.dayOfWeek) ?? [];
        arr.push(`${w.startTime}–${w.endTime}`);
        perDay.set(w.dayOfWeek, arr);
      }
      const lines = Array.from(perDay.entries()).sort((a, b2) => a[0] - b2[0]).map(([d, ws]) => `• ${DIAS[d]}: ${ws.join(" y ")}`);
      return { ok: true, text: `Horario de ${b.name}:\n${lines.join("\n")}` };
    },
  },
];

// ---------- helpers de ejecutores ----------
function findServiceInCtx(db: ReturnType<typeof getDB>, c: Ctx): Service | undefined {
  // nombre entre "de/la/el" y el número, o el texto sin entidades
  const direct = c.q.match(/(?:precio|valor|duracion)\s+(?:de\s+|del\s+|la\s+|el\s+)?(.+?)(?=\s+(?:a|en|sea|es|de|ahora|vale|queda)?\s*\$?\s?\d|\s+\d+\s*(?:minutos|min)|$)/);
  if (direct) {
    const svc = findService(db, direct[1].replace(/\s+(?:a|en|sea|es|ahora|vale|queda)\s*$/, "").trim());
    if (svc) return svc;
  }
  const stripped = stripEntities(c.q);
  const words = stripped.split(/\s+/).filter((w) => w.length > 2 && !/^(cambiar|poner|modificar|actualizar|precio|valor|duracion|servicio|del|la|el|los|las|ahora|vale|cuesta|cobrar|sea|es|queda|dema|tarda|tome|durar)$/i.test(w));
  // probar ventanas de 1 a 4 palabras contra los servicios existentes
  for (let len = Math.min(4, words.length); len >= 1; len--) {
    for (let i = 0; i + len <= words.length; i++) {
      const probe = words.slice(i, i + len).join(" ");
      const svc = findService(db, probe);
      if (svc) return svc;
    }
  }
  if (db.services.length === 1) return db.services[0]; // un solo servicio: es ese
  return undefined;
}

function svcNotFound(c: Ctx): AssistantReply {
  const db = getDB();
  const names = db.services.map((s) => `«${s.name}»`).join(", ");
  return { ok: false, text: `No identifiqué el servicio. ${db.services.length === 0 ? "No tienes servicios creados aún." : `Tienes: ${names}.`} Repite la orden con el nombre exacto.` };
}

function applySchedule(barber: Barber, c: Ctx): AssistantReply {
  const spec = c.q;
  const times = c.times;
  let days: number[] = [];
  const diasTodos = /(todos los dias|lunes a sabado|lunes a domingo|toda la semana)/.test(spec);
  const rangoDias = spec.match(/(domingo|lunes|martes|miercoles|jueves|viernes|sabado|dom|lun|mar|mie|jue|vie|sab)\s*(?:a|hasta|-)\s*(domingo|lunes|martes|miercoles|jueves|viernes|sabado|dom|lun|mar|mie|jue|vie|sab)/);
  if (diasTodos) {
    days = [1, 2, 3, 4, 5, 6];
    if (/domingo/.test(spec)) days = [0, 1, 2, 3, 4, 5, 6];
  } else if (rangoDias) {
    const a = DOW[rangoDias[1]];
    const b = DOW[rangoDias[2]];
    if (a !== undefined && b !== undefined) {
      if (a <= b) for (let d = a; d <= b; d++) days.push(d);
      else {
        for (let d = a; d <= 6; d++) days.push(d);
        for (let d = 0; d <= b; d++) days.push(d);
      }
    }
  } else {
    for (const [k, v] of Object.entries(DOW)) if (new RegExp(`\\b${k}\\b`).test(spec)) days.push(v);
    if (days.length === 0) days = [1, 2, 3, 4, 5, 6];
  }
  days = Array.from(new Set(days.filter((d) => d >= 0 && d <= 6))).sort((a, b) => a - b);
  if (days.length === 0) return { ok: false, text: "No entendí los días. Ejemplo: «martes a sábado de 9 a 18»." };

  let windows: Availability[] = [];
  if (times.length >= 4) {
    for (const d of days) {
      windows.push({ dayOfWeek: d, startTime: times[0], endTime: times[1], active: true });
      windows.push({ dayOfWeek: d, startTime: times[2], endTime: times[3], active: true });
    }
  } else {
    for (const d of days) windows.push({ dayOfWeek: d, startTime: times[0], endTime: times[1], active: true });
  }
  const valido = windows.every((w) => w.startTime < w.endTime);
  if (!valido) return { ok: false, text: "La hora de inicio debe ser menor que la de cierre." };

  const db = getDB();
  const before = [...(db.availability[barber.id] ?? [])];
  const { saved } = mutateDB((d) => {
    const b = d.barbers.find((x) => x.id === barber.id);
    if (b) d.availability[b.id] = windows;
  });
  if (!saved) return { ok: false, text: "El almacenamiento del navegador está lleno; no pude guardar el horario." };
  audit("AVAILABILITY", barber.id, "UPDATE", "IA interna", before, windows);
  const resumen = days.map((d) => DIAS[d]).join(", ");
  return { ok: true, text: `Listo: ${barber.name} ahora atiende ${resumen} de ${times[0]} a ${times[1]}${times.length >= 4 ? ` y de ${times[2]} a ${times[3]}` : ""}. Los clientes ya lo ven al reservar.`, actions: [`horario:${barber.name}`] };
}

// ============================================================ ENTRADA PRINCIPAL (loop de autoauditoría)
export function runAssistantCommand(raw: string): AssistantReply {
  if (!raw.trim()) return { ok: false, text: "Dime qué quieres cambiar y me encargo." };
  const q0 = norm(raw);
  if (/^(hola|buenas|hey|que tal|buenos dias|buenas tardes|buenas noches)\b/.test(q0) && q0.split(/\s+/).length <= 3) {
    return { ok: true, text: "¡Hola! Pídeme cualquier cambio: bloquear días, precios, horarios, servicios, el membrete, el WhatsApp… escribo «ayuda» para ver ejemplos." };
  }
  if (/^(ayuda|help|que sabes|que puedes|comandos|que puedes hacer|help me)\b/.test(q0) || q0 === "?") return helpReply();

  // ---- PASADAS DE AUTOAUDITORÍA (máx. 3) ----
  let hint: string | undefined;
  for (let pass = 1; pass <= 3; pass++) {
    const q = deepNorm(raw);
    const ctx: Ctx = {
      raw,
      q,
      dates: extractDates(q),
      money: extractMoney(q),
      times: parseTimes(q),
      mins: minutesFrom(q),
      hint,
    };

    // elegir la intención con mayor puntaje
    let best: Executor | null = null;
    let bestScore = 0;
    let second: Executor | null = null;
    let secondScore = 0;
    for (const ex of EXECUTORS) {
      const s = ex.score(ctx);
      if (s > bestScore) { second = best; secondScore = bestScore; best = ex; bestScore = s; }
      else if (s > secondScore) { second = ex; secondScore = s; }
    }

    if (!best || bestScore < 4) break; // ninguna intención con confianza suficiente

    // AMBIGÜEDAD: dos intenciones empatadas y conflictivas → preguntar
    if (second && bestScore === secondScore && bestScore >= 5) {
      return {
        ok: false,
        text: `Quiero confirmar antes de cambiar algo: ¿quieres ${labelOf(best.id)} o ${labelOf(second.id)}? Escríbemelo con un poco más de detalle y lo hago ya.`,
      };
    }

    // ejecutar
    let res: AssistantReply | null = null;
    try {
      res = best.run(ctx);
    } catch (e) {
      console.error("[melo-ai] fallo ejecutando", best.id, e);
      res = null;
    }

    if (res) {
      // ===== AUTOAUDITORÍA: verificar el efecto contra la BD real =====
      const auditRes = auditEffect(best, ctx);
      if (auditRes.score >= 10) return { ...res, confidence: auditRes.score };
      if (pass < 3) {
        // pista para la siguiente pasada: re-interpretar con lo que falló
        hint = auditRes.missing;
        continue;
      }
      // última pasada: si aplicó algo pero no es 10/10, avisar con la pregunta concreta
      if (res.ok) return res;
      return res;
    }

    // no pudo ejecutar: usar la pista del "why" para re-interpretar
    const missing = best.why(ctx);
    if (missing === "OK" || pass >= 3) {
      // la intención era clara pero faltan datos: preguntar de forma concreta
      return askFor(best.id, ctx);
    }
    hint = missing;
  }

  // ---- sin intención reconocida: respuesta útil ----
  const q = deepNorm(raw);
  const ctx: Ctx = { raw, q, dates: extractDates(q), money: extractMoney(q), times: parseTimes(q), mins: minutesFrom(q) };
  const tieneFecha = ctx.dates.length > 0;
  const tienePlata = ctx.money.length > 0;
  let guess = "";
  if (tieneFecha && /(cerrar|bloquear|fumig|vacacion)/.test(q)) guess = "Si quieres cerrar ese día, dime: «bloquea el día " + ctx.dates[0].slice(8) + "».";
  else if (tienePlata && /servicio/.test(q)) guess = "Para crearlo dime: «crea el servicio [nombre] de " + ctx.money[0] + ", [duración] minutos».";
  else if (/cita|agenda/.test(q)) guess = "Puedo ver, crear o cancelar citas. Ejemplo: «cuántas citas hay mañana?» o «cancela la cita MB-ABC123».";
  return {
    ok: false,
    text: "No entendí esa orden" + (guess ? `, pero ¿quizás esto? ${guess}` : "") + ". Escríbela con otras palabras o escribe «ayuda» para ver todo lo que sé hacer.",
  };
}

// ---------- autoauditoría de efecto ----------
function auditEffect(ex: Executor, ctx: Ctx): { score: number; missing?: string } {
  const db = getDB();
  switch (ex.id) {
    case "block_day": {
      if (ctx.dates.length === 0) return { score: 0, missing: "FALTA_FECHA" };
      const all = ctx.dates.every((k) => !!db.blockedDates?.[k]);
      return all ? { score: 10 } : { score: 5, missing: "FALTA_FECHA" };
    }
    case "unblock_day": {
      if (ctx.dates.length === 0) return { score: 0, missing: "FALTA_FECHA" };
      const none = ctx.dates.every((k) => !db.blockedDates?.[k]);
      return none ? { score: 10 } : { score: 5 };
    }
    case "slot_step": {
      const m = ctx.q.match(/(\d{1,2})/);
      return m && getBookingConfig().slotStepMin === Number(m[1]) ? { score: 10 } : { score: 5 };
    }
    case "set_price": {
      const svc = findServiceInCtx(db, ctx);
      return svc && ctx.money.length > 0 && svc.price === Math.round(ctx.money[0])
        ? { score: 10 }
        : { score: 5, missing: svc ? undefined : "FALTA_SERVICIO" };
    }
    case "set_duration": {
      const svc = findServiceInCtx(db, ctx);
      return svc && ctx.mins && svc.durationMin === ctx.mins
        ? { score: 10 }
        : { score: 5, missing: svc ? undefined : "FALTA_SERVICIO" };
    }
    default:
      return { score: 10 }; // consultas y acciones simples: su propio run ya valida
  }
}

function labelOf(id: string): string {
  const map: Record<string, string> = {
    block_day: "cerrar un día de la agenda",
    unblock_day: "abrir un día que estaba cerrado",
    agenda_query: "ver las citas de la agenda",
    cancel_appt: "cancelar una cita",
    slot_step: "cambiar el intervalo entre citas",
    set_price: "cambiar un precio",
    set_duration: "cambiar una duración",
    create_service: "crear un servicio",
    create_barber: "crear un barbero",
    barber_schedule: "cambiar el horario de un barbero",
    site_edit: "editar el sitio público",
    add_expense: "registrar un gasto",
  };
  return map[id] ?? id;
}

/** Pregunta concreta cuando la intención es clara pero faltan datos. */
function askFor(id: string, ctx: Ctx): AssistantReply {
  switch (id) {
    case "block_day":
      return { ok: false, text: `Entiendo que quieres cerrar la barbería, pero no identifiqué la fecha. Dime el día, por ejemplo: «bloquea el 24 de noviembre porque fumigamos» o «cierra mañana».` };
    case "unblock_day":
      return { ok: false, text: "¿Qué día quieres volver a abrir? Ejemplo: «abre de nuevo el 24»." };
    case "cancel_appt":
      return { ok: false, text: "Dime el código de la cita (aparece en la agenda, algo como MB-AB12CD) o el nombre del cliente." };
    case "set_price":
      return { ok: false, text: `¿A cuánto y de qué servicio? Ejemplo: «el precio de Corte Clásico a 40000».` };
    case "set_duration":
      return { ok: false, text: "¿Qué servicio y cuántos minutos? Ejemplo: «la duración de Corte Clásico es 60 minutos»." };
    case "create_service":
      return { ok: false, text: "Para crear el servicio dime nombre, precio y duración: «crea el servicio Fade de 30000, 45 minutos»." };
    default:
      return { ok: false, text: "Casi lo tengo. Dame un poco más de detalle y lo hago al instante." };
  }
}
