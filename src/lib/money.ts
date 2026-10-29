// Formateo de dinero COP (enteros, sin decimales) y porcentajes.
const THOUSANDS = /\B(?=(\d{3})+(?!\d))/g;

export function cop(n: number): string {
  const sign = n < 0 ? "-" : "";
  const abs = Math.abs(Math.round(n));
  return `$ ${sign}${String(abs).replace(THOUSANDS, ".")}`;
}

export function copPlain(n: number): string {
  const sign = n < 0 ? "-" : "";
  return `${sign}${String(Math.abs(Math.round(n))).replace(THOUSANDS, ".")}`;
}

export function pct(n: number | null | undefined): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${n}%`.replace(".", ",");
}

export function num(n: number): string {
  return String(Math.round(n)).replace(THOUSANDS, ".");
}
