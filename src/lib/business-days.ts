/**
 * Días hábiles en Colombia (lunes a viernes, sin festivos).
 * Festivos según Ley 51 de 1983 (Ley Emiliani) + Semana Santa.
 * Todas las fechas son strings "YYYY-MM-DD" en hora de Bogotá (UTC-5, sin horario de verano).
 */

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

function pad(n: number) {
  return String(n).padStart(2, "0");
}

/** Date (instante) → "YYYY-MM-DD" en Bogotá. */
export function toBogotaDate(d: Date): string {
  const b = new Date(d.getTime() + BOGOTA_OFFSET_MS);
  return `${b.getUTCFullYear()}-${pad(b.getUTCMonth() + 1)}-${pad(b.getUTCDate())}`;
}

export function todayBogota(): string {
  return toBogotaDate(new Date());
}

function parse(s: string): Date {
  const [y, m, d] = s.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function fmt(d: Date): string {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
}

function addDays(d: Date, n: number): Date {
  return new Date(d.getTime() + n * 86400000);
}

/** Lunes siguiente (o el mismo día si ya es lunes). */
function nextMonday(d: Date): Date {
  const dow = d.getUTCDay(); // 0 dom .. 6 sáb
  const delta = (8 - dow) % 7;
  return addDays(d, delta);
}

/** Domingo de Pascua (algoritmo anónimo gregoriano). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

const cache = new Map<number, Set<string>>();

export function colombianHolidays(year: number): Set<string> {
  const hit = cache.get(year);
  if (hit) return hit;
  const set = new Set<string>();
  const fixed = (m: number, d: number) => set.add(fmt(new Date(Date.UTC(year, m - 1, d))));
  const emiliani = (m: number, d: number) => set.add(fmt(nextMonday(new Date(Date.UTC(year, m - 1, d)))));

  // Fijos
  fixed(1, 1); // Año nuevo
  fixed(5, 1); // Día del trabajo
  fixed(7, 20); // Independencia
  fixed(8, 7); // Batalla de Boyacá
  fixed(12, 8); // Inmaculada Concepción
  fixed(12, 25); // Navidad

  // Trasladables al lunes (Ley Emiliani)
  emiliani(1, 6); // Reyes Magos
  emiliani(3, 19); // San José
  emiliani(6, 29); // San Pedro y San Pablo
  emiliani(8, 15); // Asunción
  emiliani(10, 12); // Día de la Raza
  emiliani(11, 1); // Todos los Santos
  emiliani(11, 11); // Independencia de Cartagena

  // Basados en Pascua
  const easter = easterSunday(year);
  set.add(fmt(addDays(easter, -3))); // Jueves Santo
  set.add(fmt(addDays(easter, -2))); // Viernes Santo
  set.add(fmt(addDays(easter, 43))); // Ascensión (lunes)
  set.add(fmt(addDays(easter, 64))); // Corpus Christi (lunes)
  set.add(fmt(addDays(easter, 71))); // Sagrado Corazón (lunes)

  cache.set(year, set);
  return set;
}

export function isBusinessDay(date: string): boolean {
  const d = parse(date);
  const dow = d.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !colombianHolidays(d.getUTCFullYear()).has(date);
}

/**
 * Fecha en que se cumplen `n` días hábiles contados a partir del día siguiente a `start`.
 * Ej.: solicitud el lunes 2 → día hábil 1 = martes 3 … día 10 = lunes 16 (sin festivos).
 */
export function addBusinessDays(start: string, n: number): string {
  let d = parse(start);
  let count = 0;
  while (count < n) {
    d = addDays(d, 1);
    if (isBusinessDay(fmt(d))) count++;
  }
  return fmt(d);
}

/** Días hábiles transcurridos desde `start` (exclusivo) hasta `end` (inclusivo). */
export function businessDaysBetween(start: string, end: string): number {
  if (end <= start) return 0;
  let d = parse(start);
  const e = parse(end);
  let count = 0;
  while (d < e) {
    d = addDays(d, 1);
    if (isBusinessDay(fmt(d))) count++;
  }
  return count;
}

export function formatDateEs(date: string | Date): string {
  const s = typeof date === "string" ? date.slice(0, 10) : toBogotaDate(date);
  const d = parse(s);
  return d.toLocaleDateString("es-CO", { timeZone: "UTC", day: "numeric", month: "long", year: "numeric" });
}
