// MELO BARBERSHOP — servidor de sincronización (Cloudflare Worker + Durable Object).
// Guarda el estado compartido de la barbería (catálogo, equipo, citas, sitio público)
// para que TODOS los dispositivos —computador, celular, visitantes— vean lo mismo
// en tiempo real. El Durable Object es la única fuente de verdad: guarda el último
// estado mergeado con un contador de revisión monotónico.

const CHUNK = 512 * 1024; // 512 KB por fragmento (límite seguro del storage del DO)
const MAX_PAYLOAD = 26_214_400; // 25 MB

/** CORS: solo el sitio de la barbería (pages.dev, previews y localhost para pruebas). */
function allowOrigin(origin) {
  if (!origin) return "*"; // peticiones sin Origin (curl, scripts) — el token sigue siendo obligatorio
  try {
    const u = new URL(origin);
    if (/(^|\.)pages\.dev$/.test(u.hostname)) return origin;
    if (u.protocol === "http:" && (u.hostname === "localhost" || u.hostname === "127.0.0.1")) return origin;
  } catch {}
  return null;
}

function corsHeaders(origin) {
  const h = {
    "access-control-allow-methods": "GET, PUT, DELETE, OPTIONS",
    "access-control-allow-headers": "content-type, x-melo-sync",
    "access-control-max-age": "86400",
    "content-type": "application/json; charset=utf-8",
  };
  const o = allowOrigin(origin);
  if (o) h["access-control-allow-origin"] = o;
  return h;
}

export class MeloSyncDO {
  constructor(state) {
    this.state = state;
  }

  async fetch(req) {
    const url = new URL(req.url);

    // GET /state[?rev=N] → { rev, same:true } si el cliente ya está al día;
    // si no, { rev, payload:{db,admin} } con el estado completo.
    if (req.method === "GET") {
      const rev = (await this.state.storage.get("rev")) || 0;
      if (!rev) return Response.json({ rev: 0 });
      const clientRev = Number(url.searchParams.get("rev") || 0);
      if (clientRev === rev) return Response.json({ rev, same: true });
      const n = (await this.state.storage.get("chunks")) || 0;
      let raw = "";
      for (let i = 0; i < n; i++) raw += (await this.state.storage.get("c" + i)) || "";
      let payload = null;
      try {
        payload = raw ? JSON.parse(raw) : null;
      } catch {
        return Response.json({ rev: 0 }); // estado corrupto: empezar de cero
      }
      return Response.json({ rev, payload });
    }

    // PUT /state { rev, payload } → solo acepta revisiones estrictamente mayores.
    if (req.method === "PUT") {
      let body;
      try {
        body = await req.json();
      } catch {
        return Response.json({ ok: false, error: "bad json" }, { status: 400 });
      }
      const cur = (await this.state.storage.get("rev")) || 0;
      const rev = Number(body && body.rev);
      if (!Number.isFinite(rev) || rev <= cur) {
        return Response.json({ ok: false, rev: cur }, { status: 409 });
      }
      const raw = JSON.stringify((body && body.payload) || {});
      if (raw.length > MAX_PAYLOAD) {
        return Response.json({ ok: false, error: "payload too large" }, { status: 413 });
      }
      const n = Math.max(1, Math.ceil(raw.length / CHUNK));
      const oldN = (await this.state.storage.get("chunks")) || 0;
      const ops = [];
      for (let i = n; i < oldN; i++) ops.push(this.state.storage.delete("c" + i));
      for (let i = 0; i < n; i++) ops.push(this.state.storage.put("c" + i, raw.slice(i * CHUNK, (i + 1) * CHUNK)));
      ops.push(this.state.storage.put("chunks", n));
      ops.push(this.state.storage.put("rev", rev));
      ops.push(this.state.storage.put("updatedAt", Date.now()));
      await Promise.all(ops);
      return Response.json({ ok: true, rev });
    }

    // DELETE /state → borra todo (reiniciar la sincronización desde cero).
    if (req.method === "DELETE") {
      await this.state.storage.deleteAll();
      return Response.json({ ok: true });
    }

    return Response.json({ error: "not found" }, { status: 404 });
  }
}

export default {
  async fetch(req, env) {
    const headers = corsHeaders(req.headers.get("origin") || "");
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });

    const path = new URL(req.url).pathname;
    if (req.method === "GET" && path === "/health") {
      return new Response(JSON.stringify({ ok: true, service: "melo-sync" }), { status: 200, headers });
    }

    // token compartido: evita que bots arbitrarios escriban el estado
    if (req.headers.get("x-melo-sync") !== env.SYNC_TOKEN) {
      return new Response("forbidden", { status: 403, headers });
    }

    if (path !== "/state") {
      return new Response(JSON.stringify({ error: "not found" }), { status: 404, headers });
    }

    const stub = env.SYNC_DO.get(env.SYNC_DO.idFromName("melo-global"));
    const body = req.method === "PUT" ? await req.text() : undefined;
    const res = await stub.fetch(req.url, {
      method: req.method,
      headers: { "content-type": "application/json" },
      body,
    });
    const data = await res.text();
    return new Response(data, { status: res.status, headers });
  },
};
