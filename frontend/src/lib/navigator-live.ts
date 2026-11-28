/** Working-mode rules on top of /api/v1 data: which money and which events count. Pure and tested. */
import type { Account, IncomeSource, Obligation, Transaction, TxKind, User } from "@/api/types";
import { reserveDays, safeToSpend, type SafeToSpend } from "./safe-to-spend";

/** An account counts only when the user confirmed it, chose its type and its balance is known (null ≠ 0). */
export const usableAccount = (a: Account) =>
  !!a.confirmed && !!a.kind && a.balanceKnown !== false && a.currency === "KZT";

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
};

const sum = (xs: Account[]) => (xs.length ? xs.reduce((a, x) => a + x.balance, 0) : null);

export function liveSnapshot(input: {
  today: string;
  me: User;
  accounts: Account[];
  obligations: Obligation[];
  incomes: IncomeSource[];
}): LiveSnapshot {
  const usable = input.accounts.filter(usableAccount);
  const needsAttention = input.accounts.filter((a) => !usableAccount(a));
  const liquidAccounts = usable.filter((a) => a.kind === "current" || a.kind === "cash");
  const savingsAccounts = usable.filter((a) => a.kind === "savings");
  const liquid = sum(liquidAccounts),
    savings = sum(savingsAccounts);
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
          })),
        });
  return {
    usable,
    needsAttention,
    liquid,
    savings,
    total: usable.length ? usable.reduce((a, x) => a + x.balance, 0) : null,
    confirmedPayments,
    confirmedIncomes,
    sts,
    reserveDays: savings === null ? null : reserveDays(savings, input.me.essentialExpenses),
  };
}

/** Cautious monthly income (FR-29): the lower bound of each confirmed payout. */
export const cautiousIncome = (incomes: IncomeSource[]) =>
  incomes
    .filter((i) => i.confirmed && !i.rejected)
    .reduce((a, i) => a + (i.amountMin ?? i.amount), 0);

export const txKind = (t: Transaction): TxKind =>
  t.kind ?? (t.internal ? "transfer_own" : t.amount > 0 ? "income" : "expense");

/** Own transfers are neither income nor spending (FR-18). A transfer to another person is money spent. */
export function monthTotals(rows: Transaction[]) {
  let income = 0,
    expense = 0,
    own = 0;
  for (const t of rows) {
    const k = txKind(t);
    if (k === "transfer_own") own += Math.abs(t.amount);
    else if (t.amount > 0) income += t.amount;
    else expense += -t.amount;
  }
  return { income, expense, own };
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
