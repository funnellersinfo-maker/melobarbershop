"use client";
// ============================================================ IA INTERNA DEL DUEÑO
// Asistente conversacional 100% local: recibe órdenes en español y ejecuta
// cambios reales en la barbería (servicios, barberos, precios, horarios,
// intervalos). Determinista, sin llamadas de red: funciona siempre y sin claves.
// Toda orden queda en el historial de auditoría, como cualquier cambio manual.

import {
  getDB, mutateDB, audit, cuid, barberAccessCode, getBookingConfig, setBookingConfig,
  type Barber, type Service, type Availability,
} from "@/lib/store";

export type AssistantReply = { text: string; ok: boolean; actions?: string[] };

// ---------- utilidades de texto ----------
function norm(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "") // quitar tildes
    .replace(/\s+/g, " ")
    .trim();
}

function moneyToNumber(raw: string): number | null {
  // en COP los separadores (punto o coma) son de miles: "25.000", "25,000", "25000"
  const clean = raw.replace(/[.$\s]/g, "").replace(/,/g, "");
  const n = Number(clean);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function minutesFrom(raw: string): number | null {
  // exige unidad explícita para no confundir el precio con la duración:
  // "30 minutos", "45 min", "1h 30", "2 horas", "90'"
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

const DOW: Record<string, number> = {
  domingo: 0, dom: 0,
  lunes: 1, lun: 1,
  martes: 2, mar: 2, marte: 2,
  miercoles: 3, mie: 3,
  jueves: 4, jue: 4,
  viernes: 5, vie: 5,
  sabado: 6, sab: 6,
};

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
  return out;
}

function findService(db: ReturnType<typeof getDB>, name: string): Service | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return (
    db.services.find((s) => norm(s.name) === n) ??
    db.services.find((s) => norm(s.name).includes(n) || n.includes(norm(s.name)))
  );
}

function findBarber(db: ReturnType<typeof getDB>, name: string): Barber | undefined {
  const n = norm(name);
  if (!n) return undefined;
  return (
    db.barbers.find((b) => norm(b.name) === n) ??
    db.barbers.find((b) => norm(b.name).includes(n) || n.includes(norm(b.name)))
  );
}

function fmtMoney(n: number): string {
  return `$${n.toLocaleString("es-CO")}`;
}

function copiarDiaBase(): Availability[] {
  // horario por defecto de un barbero nuevo: martes a sábado, 10-13 y 14-19
  const out: Availability[] = [];
  for (let day = 2; day <= 6; day++) {
    out.push({ dayOfWeek: day, startTime: "10:00", endTime: "13:00", active: true });
    out.push({ dayOfWeek: day, startTime: "14:00", endTime: "19:00", active: true });
  }
  return out;
}

// ============================================================ ORDEN PRINCIPAL
export function runAssistantCommand(raw: string): AssistantReply {
  const q = norm(raw);
  if (!q) return { ok: false, text: "Dime qué quieres cambiar y me encargo." };

  // ---------- ayuda / qué sabes hacer ----------
  if (/^(hola|buenas|hey|que tal)/.test(q) || /ayuda|help|que sabes|que puedes|comandos/.test(q)) {
    return {
      ok: true,
      text:
        "Soy la IA interna de tu barbería. Pídeme cosas como:\n" +
        "• «Crea el servicio Diseño de barba de 25000, 40 minutos»\n" +
        "• «Cambia el precio de Corte Clásico a 40000»\n" +
        "• «La duración de Corte Clásico ahora es 60 minutos»\n" +
        "• «Crea el barbero Luis»\n" +
        "• «Desactiva a Luis» / «Activa a Luis»\n" +
        "• «Horario de Ronald: martes a sábado de 9 a 18»\n" +
        "• «Que las citas salgan cada 30 minutos»\n" +
        "• «¿Qué servicios hay?» · «¿Quiénes son mis barberos?»\n" +
        "Todo lo que cambio queda registrado en el Historial.",
    };
  }

  // ---------- consultas ----------
  if (/que servicios|lista de servicios|ver servicios|mis servicios/.test(q)) {
    const db = getDB();
    if (db.services.length === 0) return { ok: true, text: "No hay servicios creados todavía. Pídeme: «Crea el servicio…»." };
    const lines = db.services.map((s) => `• ${s.name} — ${fmtMoney(s.price)} · ${s.durationMin} min ${s.active ? "" : "(inactivo)"}`);
    return { ok: true, text: `Estos son tus servicios:\n${lines.join("\n")}` };
  }
  if (/quienes son mis barberos|mis barberos|que barberos|lista de barberos|ver equipo|mi equipo/.test(q)) {
    const db = getDB();
    if (db.barbers.length === 0) return { ok: true, text: "No hay barberos creados. Pídeme: «Crea el barbero…»." };
    const lines = db.barbers.map((b) => `• ${b.name} — ${b.specialty || "sin especialidad"} · código ${b.code} ${b.active ? "" : "(inactivo)"}`);
    return { ok: true, text: `Tu equipo:\n${lines.join("\n")}` };
  }
  if (/horario de|disponibilidad de/.test(q) && !/cambiar|cambia|pon|poner|quiero|nuevo|establecer/.test(q) && !/\d{1,2}[:.h]\d{2}/.test(q)) {
    const name = q.replace(/.*horario de|.*disponibilidad de/, "").replace(/[?¿]/g, "").trim();
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
    const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
    const lines = Array.from(perDay.entries()).sort((a, b2) => a[0] - b2[0]).map(([d, ws]) => `• ${DIAS[d]}: ${ws.join(" y ")}`);
    return { ok: true, text: `Horario de ${b.name}:\n${lines.join("\n")}` };
  }
  if (/intervalo|cada cuanto|cada cuantos/.test(q) && !/cambia|cambiar|pon|poner|que salgan|quiero/.test(q)) {
    const cfg = getBookingConfig();
    return { ok: true, text: `Las citas salen cada ${cfg.slotStepMin} minutos y la anticipación mínima es de ${cfg.minLeadMin} minutos.` };
  }

  // ---------- intervalo entre cortes ----------
  const intervalMatch = q.match(/(?:cada|intervalo de|intervalo entre cortes de)\s+(\d{1,2})\s*(?:min(?:utos?)?)?/);
  if (intervalMatch && /intervalo|cada cuanto|que las citas|que salgan|espaci/.test(q)) {
    const step = Number(intervalMatch[1]);
    if (step < 5 || step > 60) return { ok: false, text: "El intervalo debe estar entre 5 y 60 minutos." };
    setBookingConfig({ slotStepMin: step });
    audit("BOOKING", "config", "SET_SLOT_STEP", "IA interna", null, { slotStepMin: step });
    return { ok: true, text: `Listo: las citas ahora salen cada ${step} minutos. Se refleja al instante en el sitio público.` };
  }

  // ---------- anticipación mínima ----------
  const leadMatch = q.match(/anticipaci[oó]n(?:\s+m[ií]nima)?(?:\s+de)?\s+(\d{1,3})/);
  if (leadMatch) {
    const lead = Number(leadMatch[1]);
    if (lead < 0 || lead > 240) return { ok: false, text: "La anticipación debe estar entre 0 y 240 minutos." };
    setBookingConfig({ minLeadMin: lead });
    audit("BOOKING", "config", "SET_MIN_LEAD", "IA interna", null, { minLeadMin: lead });
    return { ok: true, text: `Listo: anticipación mínima de ${lead} minutos para reservar el mismo día.` };
  }

  // ---------- horario de un barbero ----------
  // «horario de X: martes a sábado de 9 a 18» | «X trabaja el lunes de 10:00 a 20:00»
  const schedMatch = raw.match(/horario\s+de\s+([^:]{2,40}?)\s*:\s*(.+)$/i) ?? raw.match(/([^,]{2,40}?)\s+trabaja\s+(?:el\s+|los\s+)?(.+)$/i);
  if (schedMatch && /(de\s+\d|desde|entre)/.test(norm(schedMatch[2]))) {
    const db = getDB();
    const barber = findBarber(db, schedMatch[1]);
    if (barber) {
      const spec = norm(schedMatch[2]);
      const times = parseTimes(schedMatch[2]);
      if (times.length < 2) {
        return { ok: false, text: "Dime el rango de horas, por ejemplo: «Horario de Ronald: martes a sábado de 9:00 a 18:00»." };
      }
      // días: todos | día único | rango de días «X a Y» | lista «lunes, miércoles»
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
            // rango que cruza el domingo: viernes a lunes = 5,6,0,1
            for (let d = a; d <= 6; d++) days.push(d);
            for (let d = 0; d <= b; d++) days.push(d);
          }
        }
      } else {
        for (const [k, v] of Object.entries(DOW)) if (new RegExp(`\\b${k}\\b`).test(spec)) days.push(v);
        if (days.length === 0) days = [1, 2, 3, 4, 5, 6]; // sin día explícito: lunes a sábado
      }
      days = Array.from(new Set(days.filter((d) => d >= 0 && d <= 6))).sort((a, b) => a - b);
      if (days.length === 0) return { ok: false, text: "No entendí los días. Ejemplo: «martes a sábado de 9 a 18»." };

      // horas: primer par = jornada; si hay 4 horas y «y»/«y», dos jornadas
      let windows: Availability[] = [];
      if (times.length >= 4 && /(y\s*\d{1,2}[:.h]\d{2})/.test(spec)) {
        for (const d of days) {
          windows.push({ dayOfWeek: d, startTime: times[0], endTime: times[1], active: true });
          windows.push({ dayOfWeek: d, startTime: times[2], endTime: times[3], active: true });
        }
      } else {
        for (const d of days) windows.push({ dayOfWeek: d, startTime: times[0], endTime: times[1], active: true });
      }
      const valido = windows.every((w) => w.startTime < w.endTime);
      if (!valido) return { ok: false, text: "La hora de inicio debe ser menor que la de cierre." };

      const before = [...(db.availability[barber.id] ?? [])];
      const { saved } = mutateDB((d) => {
        const b = d.barbers.find((x) => x.id === barber.id);
        if (b) d.availability[b.id] = windows;
      });
      if (!saved) return { ok: false, text: "El almacenamiento del navegador está lleno; no pude guardar el horario." };
      audit("AVAILABILITY", barber.id, "UPDATE", "IA interna", before, windows);
      const DIAS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
      const resumen = days.map((d) => DIAS[d]).join(", ");
      return { ok: true, text: `Listo: ${barber.name} ahora atiende ${resumen} de ${times[0]} a ${times[1]}${times.length >= 4 ? ` y de ${times[2]} a ${times[3]}` : ""}. Los clientes ya lo ven al reservar.` };
    }
  }

  // ---------- crear servicio ----------
  // «crea (el) servicio X de 25000 (pesos), 40 minutos»
  const createSvc = raw.match(/crea[r]?\s+(?:el\s+)?servicio\s+(.+)$/i);
  if (createSvc) {
    const rest = createSvc[1];
    const price = moneyToNumber(rest.match(/\$?\s?\d[\d.,]*\s*(?:pesos|cop|\$)?/)?.[0] ?? "");
    const dur = minutesFrom(rest);
    // nombre: texto antes del precio o de la duración
    let name = rest
      .replace(/\$?\s?\d[\d.,]*\s*(?:pesos|cop|\$)?/i, "|")
      .split("|")[0]
      .replace(/\d+\s*(?:h(?:oras?)?|min(?:utos?)?)\s*(?:de\s*)?$/i, "")
      .replace(/\s+(?:de|con|que\s+dura|dura|por)\s*$/i, "")
      .trim();
    if (!name) name = rest.split(/,|\d/)[0].trim();
    if (name.length < 3) return { ok: false, text: "Dime el nombre del servicio, por ejemplo: «Crea el servicio Barba premium de 25000, 30 minutos»." };
    if (!price) return { ok: false, text: `Falta el precio de «${name}». Ejemplo: «Crea el servicio ${name} de 25000, 30 minutos».` };
    if (!dur) return { ok: false, text: `Falta la duración de «${name}» (entre 5 y 300 minutos).` };
    const db = getDB();
    if (findService(db, name)) return { ok: false, text: `Ya existe un servicio parecido: «${findService(db, name)!.name}». Si quieres cambiarlo dime: «Cambia el precio de ${findService(db, name)!.name} a …».` };
    const svc: Service = {
      id: cuid("svc"), name, description: "", price: Math.round(price), durationMin: dur,
      active: true, sortOrder: db.services.length + 1,
    };
    const { saved } = mutateDB((d) => {
      d.services.push(svc);
      // los barberos activos quedan autorizados para el servicio nuevo
      for (const b of d.barbers) if (b.active) d.barberServices[`${b.id}:${svc.id}`] = true;
    });
    if (!saved) return { ok: false, text: "El almacenamiento del navegador está lleno; no pude guardar el servicio." };
    audit("SERVICE", svc.id, "CREATE", "IA interna", null, svc);
    return { ok: true, text: `Servicio creado: ${name} — ${fmtMoney(svc.price)} · ${dur} min. Ya aparece en el sitio público y todos tus barberos pueden atenderlo.` };
  }

  // ---------- crear barbero ----------
  const createBarber = raw.match(/crea[r]?\s+(?:el\s+)?(?:barbero|barber[oa])\s+(.+)$/i);
  if (createBarber) {
    const name = createBarber[1].replace(/\s+(?:con|que|de)\s+.*$/i, "").replace(/[.,;]$/, "").trim();
    if (name.length < 3) return { ok: false, text: "Dime el nombre, por ejemplo: «Crea el barbero Luis»." };
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
    return { ok: true, text: `Barbero creado: ${name}. Su código de acceso es ${code} (compárteselo con seguridad). Ya aparece en el sitio y atiende martes a sábado de 10:00 a 13:00 y 14:00 a 19:00; dime «Horario de ${name}: …» si quieres cambiarlo.` };
  }

  // ---------- activar / desactivar barbero o servicio ----------
  const toggle = raw.match(/(activa[r]?|desactiva[r]?|elimina[r]?|borra[r]?|elimin[ao]|borr[ao])\s+(?:el\s+|la\s+|los\s+|las\s+)?(?:servicio\s+|barbero\s+|barbera\s+)?(.+)$/i);
  if (toggle) {
    const action = norm(toggle[1]);
    const target = toggle[2].replace(/[.,;]$/, "").trim();
    const db = getDB();
    const isService = findService(db, target);
    const isBarber = !isService ? findBarber(db, target) : undefined;
    if (!isService && !isBarber) return { ok: false, text: `No encontré «${target}» entre tus servicios ni barberos.` };

    if (isService) {
      if (/desactiv/.test(action)) {
        mutateDB((d) => { const s = d.services.find((x) => x.id === isService.id); if (s) s.active = false; });
        audit("SERVICE", isService.id, "DEACTIVATE", "IA interna", null, null);
        return { ok: true, text: `Servicio «${isService.name}» desactivado: ya no aparece para reservar (el historial de citas queda intacto).` };
      }
      if (/activ/.test(action)) {
        mutateDB((d) => { const s = d.services.find((x) => x.id === isService.id); if (s) s.active = true; });
        audit("SERVICE", isService.id, "ACTIVATE", "IA interna", null, null);
        return { ok: true, text: `Servicio «${isService.name}» activado: vuelve a aparecer en el sitio público.` };
      }
      if (/elimin|borr/.test(action)) {
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
        return { ok: true, text: `Servicio «${isService.name}» eliminado del catálogo.` };
      }
    }

    if (isBarber) {
      if (/desactiv/.test(action)) {
        mutateDB((d) => { const b = d.barbers.find((x) => x.id === isBarber.id); if (b) b.active = false; });
        audit("USER", isBarber.id, "DEACTIVATE", "IA interna", null, null);
        return { ok: true, text: `${isBarber.name} quedó inactivo: no recibe citas nuevas ni aparece en el sitio. Sus citas existentes se mantienen.` };
      }
      if (/activ/.test(action)) {
        mutateDB((d) => { const b = d.barbers.find((x) => x.id === isBarber.id); if (b) b.active = true; });
        audit("USER", isBarber.id, "ACTIVATE", "IA interna", null, null);
        return { ok: true, text: `${isBarber.name} vuelve a estar activo y visible en el sitio público.` };
      }
      if (/elimin|borr/.test(action)) {
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
        return { ok: true, text: `${isBarber.name} fue eliminado del equipo.` };
      }
    }
  }

  // ---------- cambiar precio ----------
  const priceMatch = raw.match(/(?:precio\s+de|cambiar?\s+el\s+precio\s+de|pon(?:er|le)?\s+el\s+precio\s+de)\s+(.+?)\s+(?:a|en)\s+\$?\s*([\d.,]+)\s*(?:pesos|cop|\$)?/i);
  if (priceMatch) {
    const db = getDB();
    const svc = findService(db, priceMatch[1]);
    if (!svc) return { ok: false, text: `No encontré el servicio «${priceMatch[1].trim()}».` };
    const price = moneyToNumber(priceMatch[2]);
    if (!price) return { ok: false, text: "El precio no es válido. Ejemplo: «Cambia el precio de Corte Clásico a 40000»." };
    const before = { ...svc };
    mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.price = Math.round(price); });
    audit("SERVICE", svc.id, "UPDATE_PRICE", "IA interna", before, { price: Math.round(price) });
    return { ok: true, text: `Precio de «${svc.name}» actualizado: ${fmtMoney(before.price)} → ${fmtMoney(price)}. Ya se ve en el sitio público. Las citas pasadas conservan su precio original.` };
  }

  // ---------- cambiar duración ----------
  const durMatch = raw.match(/(?:duraci[oó]n\s+de|durar?|cambiar?\s+la\s+duraci[oó]n\s+de)\s+(.+?)\s+(?:a|en|sea|es|de)?\s*(\d{1,3})\s*(?:min(?:utos?)?|')/i);
  if (durMatch) {
    const db = getDB();
    const svc = findService(db, durMatch[1]);
    if (!svc) return { ok: false, text: `No encontré el servicio «${durMatch[1].trim()}».` };
    const dur = Number(durMatch[2]);
    if (dur < 5 || dur > 300) return { ok: false, text: "La duración debe estar entre 5 y 300 minutos." };
    const before = { ...svc };
    mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.durationMin = dur; });
    audit("SERVICE", svc.id, "UPDATE_DURATION", "IA interna", before, { durationMin: dur });
    return { ok: true, text: `Duración de «${svc.name}» actualizada: ${before.durationMin} → ${dur} min. Las horas disponibles en el sitio ya se recalculan con la nueva duración.` };
  }

  // ---------- renombrar servicio ----------
  const renameSvc = raw.match(/(?:renombra|cambia\s+el\s+nombre\s+de(?:l)?|llama)\s+(?:el\s+servicio\s+)?(.+?)\s+(?:a|como)\s+(.+)$/i);
  if (renameSvc) {
    const db = getDB();
    const svc = findService(db, renameSvc[1]);
    if (!svc) return { ok: false, text: `No encontré el servicio «${renameSvc[1].trim()}».` };
    const nuevo = renameSvc[2].replace(/[.,;]$/, "").trim();
    if (nuevo.length < 3) return { ok: false, text: "El nuevo nombre es demasiado corto." };
    const before = { ...svc };
    mutateDB((d) => { const s = d.services.find((x) => x.id === svc.id); if (s) s.name = nuevo; });
    audit("SERVICE", svc.id, "RENAME", "IA interna", before, { name: nuevo });
    return { ok: true, text: `Servicio renombrado: «${before.name}» → «${nuevo}».` };
  }

  // ---------- no entendí ----------
  return {
    ok: false,
    text: "No entendí esa orden. Prueba con:\n• «Crea el servicio X de 25000, 40 minutos»\n• «Cambia el precio de X a 40000»\n• «Crea el barbero Luis»\n• «Horario de Luis: lunes a sábado de 9:00 a 18:00»\n• «Que las citas salgan cada 30 minutos»\nO escribe «ayuda» para ver todo lo que sé hacer.",
  };
}
