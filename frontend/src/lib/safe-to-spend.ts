/**
 * Safe-to-Spend and reserve days for the Navigator working mode (ТЗ BR-10–BR-14). Pure functions, integer tenge.
 *
 * BR-10 Horizon: from today (day 1) to the day before the nearest confirmed income; without a confirmed income,
 *       to the end of the current month.
 * BR-11 F(d) = C − Σ confirmed payments due on days 1..d, where C is the money on current and cash accounts.
 * BR-12 SafeDaily = floor(max(0, min over d of F(d) / d)).
 * BR-13 Deficit = max(0, −min F(d)): the amount missing to cover the payments inside the horizon.
 * BR-14 Reserve days = floor(reserve / (mandatory monthly expenses / 30)); not computed when expenses are unknown.
 */

/** ISO date (YYYY-MM-DD) of "now" in the given IANA time zone (BR-06: Asia/Almaty by default). */
export function todayIn(timeZone = "Asia/Almaty", now = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const toUtc = (iso: string) => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const fromUtc = (ms: number) => new Date(ms).toISOString().slice(0, 10);
export const addDays = (iso: string, n: number) => fromUtc(toUtc(iso) + n * 86_400_000);
export const daysBetween = (a: string, b: string) => Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
export const daysInMonth = (year: number, month1: number) =>
  new Date(Date.UTC(year, month1, 0)).getUTCDate();

/** Date of a monthly event in a given month; day 29–31 moves to the last day of shorter months. */
export function monthlyDate(year: number, month1: number, dayOfMonth: number): string {
  const day = Math.min(dayOfMonth, daysInMonth(year, month1));
  return `${year}-${String(month1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** The first date on or after `from` when a monthly event with this day of month happens. */
export function nextMonthly(from: string, dayOfMonth: number): string {
  let y = +from.slice(0, 4),
    m = +from.slice(5, 7);
  for (let i = 0; i < 3; i++) {
    const d = monthlyDate(y, m, dayOfMonth);
    if (d >= from) return d;
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  throw new Error("unreachable");
}

export type Payment = { date: string; amount: number; name?: string };

export type SafeToSpend = {
  /** Days in the horizon including today (D). */
  days: number;
  /** Last day of the horizon. */
  until: string;
  /** Why the horizon ends there. */
  horizon: "income" | "month-end";
  nextIncome: string | null;
  safeDaily: number;
  deficit: number;
  /** Payments that fall inside the horizon. */
  payments: Payment[];
  committed: number;
};

/** Core of BR-11–BR-13 on day offsets: payments[d-1] is the total due on day d (1-based), D = payments.length. */
export function safeDailyFromDays(
  balance: number,
  dueByDay: number[],
): { safeDaily: number; deficit: number } {
  if (dueByDay.length === 0) return { safeDaily: 0, deficit: 0 };
  let f = balance,
    minRatio = Infinity,
    minF = Infinity;
  dueByDay.forEach((due, i) => {
    f -= due;
    minF = Math.min(minF, f);
    minRatio = Math.min(minRatio, f / (i + 1));
  });
  return { safeDaily: Math.floor(Math.max(0, minRatio)), deficit: Math.max(0, -minF) };
}

export function safeToSpend(input: {
  today: string;
  balance: number;
  /** Days of month of confirmed incomes (several payouts a month are allowed). */
  incomeDays: number[];
  /** Confirmed monthly payments. */
  /** amountsByMonth: amounts computed by a rule per YYYY-MM (null = not computed: the entered amount is used). */
  payments: {
    dayOfMonth: number;
    amount: number;
    name?: string;
    endsAt?: string | null;
    amountsByMonth?: Record<string, number | null>;
  }[];
  /** One-off planned expenses (the unpaid part). An overdue one is due today. */
  oneOff?: Payment[];
}): SafeToSpend {
  const { today } = input;
  const incomes = input.incomeDays.map((d) => nextMonthly(addDays(today, 1), d)).sort();
  // Strictly after today: money expected today is not counted as received, and the next payout is a later one.
  const next = incomes[0] ?? null;
  const monthEnd = monthlyDate(+today.slice(0, 4), +today.slice(5, 7), 31);
  const until = next ? addDays(next, -1) : monthEnd;
  const days = daysBetween(today, until) + 1;
  const due = Array.from({ length: days }, () => 0);
  const inside: Payment[] = [];
  for (const p of input.payments) {
    let d = nextMonthly(today, p.dayOfMonth);
    while (d <= until) {
      if (!p.endsAt || d.slice(0, 7) <= p.endsAt) {
        const amount = p.amountsByMonth?.[d.slice(0, 7)] ?? p.amount;
        due[daysBetween(today, d)] += amount;
        inside.push({ date: d, amount, name: p.name });
      }
      d = nextMonthly(addDays(d, 1), p.dayOfMonth);
    }
  }
  for (const p of input.oneOff ?? []) {
    const d = p.date < today ? today : p.date;
    if (d > until || p.amount <= 0) continue;
    due[daysBetween(today, d)] += p.amount;
    inside.push({ ...p, date: d });
  }
  const { safeDaily, deficit } = safeDailyFromDays(input.balance, due);
  return {
    days,
    until,
    horizon: next ? "income" : "month-end",
    nextIncome: next,
    safeDaily,
    deficit,
    payments: inside.sort((a, b) => a.date.localeCompare(b.date)),
    committed: inside.reduce((a, p) => a + p.amount, 0),
  };
}

/** BR-14. Returns null when mandatory expenses are unknown or not positive: no number instead of a fake one. */
export function reserveDays(
  reserve: number,
  mandatoryMonthly: number | null | undefined,
): number | null {
  if (mandatoryMonthly == null || mandatoryMonthly <= 0) return null;
  return Math.floor((Math.max(0, reserve) * 30) / mandatoryMonthly);
}
