// lib/schedule.ts

function pad2(n: number) {
  return String(n).padStart(2, "0");
}

export function ymd(d: Date) {
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

export function fromYmd(s: string) {
  const [y, m, d] = s.split("-").map(Number);
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d, 0, 0, 0, 0);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

export function isSunday(d: Date) {
  return d.getDay() === 0;
}

function nextSunday(from: Date) {
  const d = new Date(from);
  d.setHours(0, 0, 0, 0);
  const day = d.getDay();
  const add = (7 - day) % 7;
  d.setDate(d.getDate() + add);
  return d;
}

export function getAllowedSundays(): string[] {
  const startStr = process.env.SCHEDULE_START_YYYYMMDD || "2026-05-31";
  const weeks = Math.max(4, Math.min(2000, Number(process.env.SCHEDULE_WEEKS) || 104));

  const parsed = fromYmd(startStr) || new Date();
  const first = nextSunday(parsed);

  const list: string[] = [];
  const cur = new Date(first);
  for (let i = 0; i < weeks; i++) {
    list.push(ymd(cur));
    cur.setDate(cur.getDate() + 7);
  }
  return list;
}

export function isAllowedSunday(yyyyMmDd: string) {
  const dt = fromYmd(yyyyMmDd);
  if (!dt || !isSunday(dt)) return false;
  return getAllowedSundays().includes(yyyyMmDd);
}

export function niceDate(yyyyMmDd: string) {
  const d = fromYmd(yyyyMmDd);
  if (!d) return yyyyMmDd;
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}
