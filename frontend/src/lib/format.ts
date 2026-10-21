export type Currency = "KZT" | "USD" | "EUR" | "RUB";

const SYMBOL: Record<Currency, string> = { KZT: "₸", USD: "$", EUR: "€", RUB: "₽" };

/** Groups digits with a regular space: 1080000 -> "1 080 000". */
export function groupDigits(n: number): string {
  const sign = n < 0 ? "−" : "";
  const abs = Math.round(Math.abs(n)).toString();
  return sign + abs.replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

/** formatMoney(1080000) -> "1 080 000 ₸"; withCode adds the ISO code for tables. */
export function formatMoney(amount: number, currency: Currency = "KZT", opts: { withCode?: boolean; signed?: boolean } = {}): string {
  const base = groupDigits(amount);
  const signed = opts.signed && amount > 0 ? "+" + base : base;
  return opts.withCode ? `${signed} ${SYMBOL[currency]} ${currency}` : `${signed} ${SYMBOL[currency]}`;
}

/** Compact: 1 080 000 -> "1,08 млн ₸", 45 000 -> "45 тыс ₸". */
export function formatMoneyShort(amount: number): string {
  const abs = Math.abs(amount);
  const sign = amount < 0 ? "−" : "";
  if (abs >= 1_000_000) return `${sign}${(abs / 1_000_000).toFixed(2).replace(".", ",")} млн ₸`;
  if (abs >= 1_000) return `${sign}${Math.round(abs / 1_000)} тыс ₸`;
  return `${sign}${Math.round(abs)} ₸`;
}

export function formatPercent(v: number, digits = 0, signed = false): string {
  const s = (v * 100).toFixed(digits).replace(".", ",");
  return (signed && v > 0 ? "+" : "") + s + "%";
}

const MONTHS_GEN = ["января", "февраля", "марта", "апреля", "мая", "июня", "июля", "августа", "сентября", "октября", "ноября", "декабря"];
const MONTHS_NOM = ["январь", "февраль", "март", "апрель", "май", "июнь", "июль", "август", "сентябрь", "октябрь", "ноябрь", "декабрь"];
const MONTHS_SHORT = ["янв", "фев", "мар", "апр", "май", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

/** "2026-10-31" -> "31 октября" */
export function formatDate(iso: string, withYear = false): string {
  const d = new Date(iso + (iso.length === 10 ? "T00:00:00" : ""));
  return `${d.getDate()} ${MONTHS_GEN[d.getMonth()]}${withYear ? " " + d.getFullYear() : ""}`;
}
export function formatDayShort(iso: string): string {
  const d = new Date(iso + "T00:00:00");
  return `${d.getDate()} ${MONTHS_SHORT[d.getMonth()]}`;
}
/** "2026-10" -> "октябрь 2026" */
export function formatMonth(ym: string, short = false): string {
  const [y, m] = ym.split("-").map(Number);
  return short ? `${MONTHS_SHORT[m - 1]} ${String(y).slice(2)}` : `${MONTHS_NOM[m - 1]} ${y}`;
}
