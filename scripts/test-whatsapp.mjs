// Verificación del mensaje de WhatsApp: debe ser texto plano sin emojis
// (los emojis viajan por URL y llegan como rombos negros en algunos teléfonos).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = readFileSync(join(ROOT, "src/components/melo/PublicView.tsx"), "utf8");

// extraer y transpilar solo buildWhatsappMessage
const start = src.indexOf("function buildWhatsappMessage");
const nextFn = src.indexOf("function ", start + 10);
const fnSrc = src.slice(start, nextFn);
const js = ts.transpileModule(fnSrc, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } }).outputText
  + "\nmodule.exports = { buildWhatsappMessage };\n";
const mod = { exports: {} };
new Function("require", "module", "exports", js)(() => ({}), mod, mod.exports);

const msg = mod.exports.buildWhatsappMessage({
  service: { name: "Corte Clásico", price: 35000, durationMin: 45 },
  barberName: "Ronald",
  date: "martes 24 de noviembre",
  time: "10:30",
  clientName: "María Gómez",
  clientPhone: "+57 300 111 2233",
  code: "MB-4PYYVG",
});

console.log("=== MENSAJE ===");
console.log(msg);
console.log("=== CHECKS ===");
// sin caracteres fuera de ASCII/Latin-1 (emojis son > U+2000)
const raros = [...msg].filter((ch) => ch.codePointAt(0) > 0x2100);
console.log("caracteres no texto:", JSON.stringify(raros), raros.length === 0 ? "✓ LIMPIO" : "✗ FALLA");
// datos completos
const checks = [
  ["nombre cliente", msg.includes("María Gómez")],
  ["servicio", msg.includes("Corte Clásico")],
  ["precio", msg.includes("$35.000")],
  ["barbero", msg.includes("Ronald")],
  ["fecha", msg.includes("martes 24")],
  ["hora", msg.includes("10:30")],
  ["código", msg.includes("MB-4PYYVG")],
  ["negritas WhatsApp", msg.includes("*Servicio:*")],
];
let fail = 0;
for (const [n, ok] of checks) { if (!ok) fail++; console.log(ok ? "✓" : "✗", n); }
process.exit(raros.length > 0 || fail > 0 ? 1 : 0);
