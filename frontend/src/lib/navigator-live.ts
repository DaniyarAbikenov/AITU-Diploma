/** Working-mode rules on top of /api/v1 data: which money and which events count. Pure and tested. */
import type {
  Account,
  Rate,
  IncomeSource,
  Obligation,
  PlannedPayment,
  Transaction,
  TxKind,
  User,
} from "@/api/types";
import { reserveDays, safeToSpend, type SafeToSpend } from "./safe-to-spend";

/** Money of the account now in tenge: a foreign-currency account at the latest official rate, never unconverted. */
export const accountKzt = (a: Account): number | null =>
  a.currentBalanceKzt ??
  a.balanceKzt ??
  (a.currency === "KZT" ? (a.currentBalance ?? a.balance) : null);

/** An account counts only when the user confirmed it, chose its type, its balance is known (null ≠ 0) and,
 * for a foreign currency, an official rate exists to convert it. */
export const usableAccount = (a: Account) =>
  !!a.confirmed && !!a.kind && a.balanceKnown !== false && accountKzt(a) !== null;

export type LiveSnapshot = {
  usable: Account[];
  /** Accounts that still need the user's confirmation, type or balance. */
  needsAttention: Account[];
  /** Money on confirmed current and cash accounts, or null when there is none. */
  liquid: number | null;
  /** Money on confirmed savings accounts, or null when there is none. */
  savings: number | null;
  total: number | null;
  confirmedPayments: Obligation[];
  confirmedIncomes: IncomeSource[];
  sts: SafeToSpend | null;
  reserveDays: number | null;
  /** Money frozen today (tenge): part of `total`, not of `liquid` / `savings`. */
  frozen: number;
  unlocks: { date: string; amount: number; name: string }[];
  /** Reference only: reserve days if deposits that allow it were withdrawn early. */
  reserveDaysWithEarly: number | null;
};

/** Money on the account now in its own currency: the known balance plus manual operations entered after it. */
export const accountNow = (a: Account) => a.currentBalance ?? a.balance;
const sum = (xs: Account[]) =>
  xs.length ? xs.reduce((a, x) => a + (accountKzt(x) ?? 0), 0) : null;

/** Frozen part in tenge (0 when nothing is frozen today) and the available rest (BR-11, BR-14). */
export const frozenKzt = (a: Account) => a.frozenKzt ?? 0;
export const availableKzt = (a: Account) => a.availableKzt ?? accountKzt(a);
const sumAvailable = (xs: Account[]) =>
  xs.length ? xs.reduce((a, x) => a + (availableKzt(x) ?? 0), 0) : null;

/** Planned expenses that still need money: not cancelled, not fully paid. */
export const openPlannedExpenses = (planned: PlannedPayment[]) =>
  planned.filter((p) => p.direction === "expense" && p.status !== "cancelled" && p.left > 0);

export function liveSnapshot(input: {
  today: string;
  me: User;
  accounts: Account[];
  obligations: Obligation[];
  incomes: IncomeSource[];
  planned?: PlannedPayment[];
}): LiveSnapshot {
  const usable = input.accounts.filter(usableAccount);
  const needsAttention = input.accounts.filter((a) => !usableAccount(a));
  const liquidAccounts = usable.filter((a) => a.kind === "current" || a.kind === "cash");
  const savingsAccounts = usable.filter((a) => a.kind === "savings" || a.kind === "deposit");
  // the liquid pool and the reserve take only available money; frozen deposits stay in capital (total)
  const liquid = sumAvailable(liquidAccounts),
    savings = sumAvailable(savingsAccounts);
  const frozenAccounts = usable.filter((a) => frozenKzt(a) > 0);
  const frozen = frozenAccounts.reduce((a, x) => a + frozenKzt(x), 0);
  const unlocks = frozenAccounts
    .map((a) => ({ date: a.frozenUntil!, amount: frozenKzt(a), name: a.name }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const earlyFrozen = frozenAccounts
    .filter((a) => a.earlyWithdrawal === "yes" || a.earlyWithdrawal === "lose_interest")
    .reduce((a, x) => a + frozenKzt(x), 0);
  const confirmedPayments = input.obligations.filter((o) => o.confirmed && !o.rejected);
  const confirmedIncomes = input.incomes.filter((i) => i.confirmed && !i.rejected);
  const sts =
    liquid === null
      ? null
      : safeToSpend({
          today: input.today,
          balance: liquid,
          incomeDays: confirmedIncomes.map((i) => i.dayOfMonth),
          payments: confirmedPayments.map((o) => ({
            dayOfMonth: o.dayOfMonth,
            amount: o.amount,
            name: o.name,
            endsAt: o.endsAt,
            amountsByMonth: o.rule?.amountsByMonth,
          })),
          oneOff: openPlannedExpenses(input.planned ?? []).map((p) => ({
            date: p.dueOn,
            amount: p.left,
            name: p.name,
          })),
        });
  return {
    usable,
    needsAttention,
    liquid,
    savings,
    total: sum(usable),
    confirmedPayments,
    confirmedIncomes,
    sts,
    reserveDays: savings === null ? null : reserveDays(savings, input.me.essentialExpenses),
    frozen,
    unlocks,
    reserveDaysWithEarly:
      earlyFrozen > 0
        ? reserveDays((savings ?? 0) + earlyFrozen, input.me.essentialExpenses)
        : null,
  };
}

/** Cautious monthly income (FR-29): the lower bound of each confirmed payout. */
export const cautiousIncome = (incomes: IncomeSource[]) =>
  incomes
    .filter((i) => i.confirmed && !i.rejected)
    .reduce((a, i) => a + (i.amountMin ?? i.amount), 0);

export const txKind = (t: Transaction): TxKind =>
  t.kind ?? (t.internal ? "transfer_own" : t.amount > 0 ? "income" : "expense");

/** Own transfers are neither income nor spending (FR-18). A transfer to another person is money spent.
 * Totals are in tenge: operations in another currency are converted with `rates` (tenge per unit) or, without a
 * rate, left out and counted in `unconverted`. */
export function monthTotals(rows: Transaction[], rates: Record<string, number> = {}) {
  let income = 0,
    expense = 0,
    own = 0,
    unconverted = 0;
  for (const t of rows) {
    if (t.voided) continue;
    const r = t.currency === "KZT" || !t.currency ? 1 : rates[t.currency];
    if (!r) {
      unconverted += 1;
      continue;
    }
    const v = t.amount * r;
    const k = txKind(t);
    if (k === "transfer_own") {
      if (v < 0) own += -v; // one transfer has two legs: count the money that left an account once
    } else if (v > 0) income += v;
    else expense += -v;
  }
  return {
    income: Math.round(income),
    expense: Math.round(expense),
    own: Math.round(own),
    unconverted,
  };
}

export const rateMap = (rates: Rate[] | undefined) =>
  Object.fromEntries((rates ?? []).map((r) => [r.currency, r.rate])) as Record<string, number>;

/** Convert between two currencies through tenge. */
export function convert(amount: number, from: string, to: string, rates: Record<string, number>) {
  const f = from === "KZT" ? 1 : rates[from],
    t = to === "KZT" ? 1 : rates[to];
  return f && t ? (amount * f) / t : null;
}

/** First and last day of a YYYY-MM month. */
export function monthRange(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { from: `${month}-01`, to: `${month}-${String(last).padStart(2, "0")}` };
}

/** The current month and the `count - 1` months before it, newest first. */
export function recentMonths(today: string, count = 13) {
  let y = +today.slice(0, 4),
    m = +today.slice(5, 7);
  return Array.from({ length: count }, () => {
    const key = `${y}-${String(m).padStart(2, "0")}`;
    m -= 1;
    if (m === 0) {
      m = 12;
      y -= 1;
    }
    return key;
  });
}

export const formatDay = (iso: string) =>
  new Date(iso + "T12:00:00Z").toLocaleDateString("ru-RU", {
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  });
export const formatMonth = (month: string) =>
  new Date(month + "-15T12:00:00Z").toLocaleDateString("ru-RU", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
