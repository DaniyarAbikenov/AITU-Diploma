import { describe, expect, it } from "vitest";
import type { Account, User } from "@/api/types";
import {
  cautiousIncome,
  convert,
  liveSnapshot,
  monthRange,
  monthTotals,
  recentMonths,
} from "./navigator-live";

const me: User = {
  id: "1",
  email: "t@example.com",
  name: "Тест",
  city: "Алматы",
  currency: "KZT",
  essentialExpenses: null,
};
const acc = (p: Partial<Account>): Account => ({
  id: "a",
  bank: "Kaspi Bank",
  name: "Kaspi Gold",
  currency: "KZT",
  balance: 100_000,
  kind: "current",
  confirmed: true,
  balanceKnown: true,
  ...p,
});

describe("liveSnapshot", () => {
  it("does not compute anything from unconfirmed or unknown accounts (empty is not zero)", () => {
    const s = liveSnapshot({
      today: "2026-11-28",
      me,
      accounts: [
        acc({ confirmed: false }),
        acc({ id: "b", balanceKnown: false }),
        acc({ id: "c", kind: null }),
      ],
      obligations: [],
      incomes: [],
    });
    expect(s.liquid).toBeNull();
    expect(s.sts).toBeNull();
    expect(s.total).toBeNull();
    expect(s.needsAttention).toHaveLength(3);
  });
  it("uses current and cash accounts for Safe-to-Spend and savings for the reserve", () => {
    const s = liveSnapshot({
      today: "2026-11-21",
      me: { ...me, essentialExpenses: 300_000 },
      accounts: [
        acc({ balance: 60_000 }),
        acc({ id: "cash", kind: "cash", balance: 40_000 }),
        acc({ id: "s", kind: "savings", balance: 500_000 }),
      ],
      obligations: [
        { id: "o1", name: "Аренда", kind: "rent", amount: 90_000, dayOfMonth: 22, confirmed: true },
        {
          id: "o2",
          name: "Не подтверждено",
          kind: "credit",
          amount: 50_000,
          dayOfMonth: 23,
          confirmed: false,
        },
        {
          id: "o3",
          name: "Отклонено",
          kind: "utility",
          amount: 50_000,
          dayOfMonth: 23,
          confirmed: false,
          rejected: true,
        },
      ],
      incomes: [{ id: "i", name: "Зарплата", amount: 300_000, dayOfMonth: 1, confirmed: true }],
    });
    expect(s.liquid).toBe(100_000);
    expect(s.sts).toMatchObject({ days: 10, safeDaily: 1_000, committed: 90_000 });
    expect(s.reserveDays).toBe(50);
  });
  it("reserve days stay unknown while mandatory expenses are not provided", () => {
    const s = liveSnapshot({
      today: "2026-11-21",
      me,
      accounts: [acc({ kind: "savings" })],
      obligations: [],
      incomes: [],
    });
    expect(s.savings).toBe(100_000);
    expect(s.reserveDays).toBeNull();
  });
});

describe("helpers", () => {
  it("cautious income takes the lower bound of each confirmed payout", () => {
    expect(
      cautiousIncome([
        {
          id: "1",
          name: "Зарплата 1",
          amount: 400_000,
          amountMin: 300_000,
          amountMax: 500_000,
          dayOfMonth: 5,
          confirmed: true,
        },
        { id: "2", name: "Зарплата 2", amount: 350_000, dayOfMonth: 20, confirmed: true },
        {
          id: "3",
          name: "Отклонено",
          amount: 900_000,
          dayOfMonth: 1,
          confirmed: false,
          rejected: true,
        },
      ]),
    ).toBe(650_000);
  });
  it("own transfers are neither income nor expense", () => {
    const base = {
      currency: "KZT" as const,
      merchant: "x",
      categoryId: "other",
      accountId: "a",
      needsReview: false,
      date: "2026-11-01",
    };
    expect(
      monthTotals([
        { ...base, id: "1", amount: 300_000, kind: "income_salary" },
        { ...base, id: "2", amount: -100_000, kind: "transfer_own" },
        { ...base, id: "3", amount: -5_000, kind: "transfer_third_party" },
        { ...base, id: "4", amount: -2_000, internal: true },
      ]),
    ).toEqual({ income: 300_000, expense: 5_000, own: 102_000, unconverted: 0 });
  });
  it("foreign-currency operations are converted to tenge or reported as unconverted", () => {
    const base = {
      merchant: "x",
      categoryId: "other",
      accountId: "a",
      needsReview: false,
      date: "2026-11-01",
    };
    const rows = [
      { ...base, id: "1", amount: -10, currency: "USD" },
      { ...base, id: "2", amount: -1000, currency: "KZT" },
      { ...base, id: "3", amount: -5, currency: "GBP" },
    ];
    expect(monthTotals(rows, { USD: 470 })).toMatchObject({ expense: 5_700, unconverted: 1 });
    expect(convert(100, "USD", "KZT", { USD: 470 })).toBe(47_000);
    expect(convert(47_000, "KZT", "EUR", { EUR: 470 })).toBe(100);
    expect(convert(1, "GBP", "KZT", {})).toBeNull();
  });
  it("a USD account counts in tenge only through its official rate", () => {
    const usd = acc({
      id: "u",
      currency: "USD",
      balance: 1000,
      kind: "savings",
      balanceKzt: 470_000,
      currentBalanceKzt: 470_000,
    });
    const s = liveSnapshot({
      today: "2026-11-21",
      me: { ...me, essentialExpenses: 300_000 },
      accounts: [acc({}), usd],
      obligations: [],
      incomes: [],
    });
    expect(s.total).toBe(570_000);
    expect(s.savings).toBe(470_000);
    const noRate = liveSnapshot({
      today: "2026-11-21",
      me,
      accounts: [acc({ id: "u", currency: "USD", balance: 1000 })],
      obligations: [],
      incomes: [],
    });
    expect(noRate.total).toBeNull();
    expect(noRate.needsAttention).toHaveLength(1);
  });
  it("month ranges and the list of recent months", () => {
    expect(monthRange("2026-02")).toEqual({ from: "2026-02-01", to: "2026-02-28" });
    expect(recentMonths("2026-01-10", 3)).toEqual(["2026-01", "2025-12", "2025-11"]);
  });
});
