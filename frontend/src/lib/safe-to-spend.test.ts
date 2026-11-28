import { describe, expect, it } from "vitest";
import {
  monthlyDate,
  nextMonthly,
  reserveDays,
  safeDailyFromDays,
  safeToSpend,
  todayIn,
} from "./safe-to-spend";

const tenDays = (paymentOnDay2: number) => [0, paymentOnDay2, 0, 0, 0, 0, 0, 0, 0, 0];

describe("Safe-to-Spend, control example of the ТЗ (BR-13)", () => {
  it("C = 100 000, payment 90 000 on day 2, D = 10 -> SafeDaily 1 000", () => {
    expect(safeDailyFromDays(100_000, tenDays(90_000))).toEqual({ safeDaily: 1_000, deficit: 0 });
  });
  it("payment 110 000 -> SafeDaily 0 and a deficit of 10 000", () => {
    expect(safeDailyFromDays(100_000, tenDays(110_000))).toEqual({ safeDaily: 0, deficit: 10_000 });
  });
  it("the same example through dates: horizon ends the day before the next confirmed income", () => {
    const r = safeToSpend({
      today: "2026-11-21",
      balance: 100_000,
      incomeDays: [1],
      payments: [{ dayOfMonth: 22, amount: 90_000, name: "Аренда" }],
    });
    expect(r).toMatchObject({
      days: 10,
      until: "2026-11-30",
      horizon: "income",
      safeDaily: 1_000,
      deficit: 0,
    });
    expect(r.nextIncome).toBe("2026-12-01");
  });
});

describe("horizon", () => {
  it("without a confirmed income runs to the end of the month", () => {
    const r = safeToSpend({ today: "2026-11-28", balance: 30_000, incomeDays: [], payments: [] });
    expect(r).toMatchObject({
      days: 3,
      until: "2026-11-30",
      horizon: "month-end",
      safeDaily: 10_000,
    });
  });
  it("two payouts a month: the nearest one ends the horizon", () => {
    const r = safeToSpend({
      today: "2026-11-08",
      balance: 120_000,
      incomeDays: [5, 20],
      payments: [],
    });
    expect(r).toMatchObject({ until: "2026-11-19", days: 12, safeDaily: 10_000 });
  });
  it("the only payout is today: the horizon runs to the next one, a month later", () => {
    const r = safeToSpend({ today: "2026-11-29", balance: 1_000, incomeDays: [29], payments: [] });
    expect(r).toMatchObject({ until: "2026-12-28", horizon: "income", days: 30 });
  });
  it("an income dated today is already received", () => {
    const r = safeToSpend({
      today: "2026-11-05",
      balance: 100_000,
      incomeDays: [5, 20],
      payments: [],
    });
    expect(r.until).toBe("2026-11-19");
  });
  it("payments after the horizon or after their end month are not counted", () => {
    const r = safeToSpend({
      today: "2026-11-08",
      balance: 100_000,
      incomeDays: [20],
      payments: [
        { dayOfMonth: 10, amount: 20_000, endsAt: "2026-10" },
        { dayOfMonth: 25, amount: 50_000 },
      ],
    });
    expect(r.committed).toBe(0);
  });
});

describe("planned one-off expenses", () => {
  it("count inside the horizon by their unpaid part; overdue ones are due today", () => {
    const r = safeToSpend({
      today: "2026-11-21",
      balance: 100_000,
      incomeDays: [1],
      payments: [],
      oneOff: [
        { date: "2026-11-22", amount: 90_000, name: "Взнос" },
        { date: "2026-12-15", amount: 50_000, name: "После горизонта" },
      ],
    });
    expect(r).toMatchObject({ safeDaily: 1_000, committed: 90_000 });
    const overdue = safeToSpend({
      today: "2026-11-21",
      balance: 10_000,
      incomeDays: [1],
      payments: [],
      oneOff: [{ date: "2026-11-01", amount: 20_000 }],
    });
    expect(overdue).toMatchObject({ safeDaily: 0, deficit: 10_000 });
    expect(overdue.payments[0].date).toBe("2026-11-21");
  });
});

describe("amounts computed by rules", () => {
  it("use the amount of each month (30 vs 31 days); an uncomputed month falls back to the entered amount", () => {
    const r = safeToSpend({
      today: "2026-11-30",
      balance: 400_000,
      incomeDays: [],
      payments: [{ dayOfMonth: 30, amount: 1, amountsByMonth: { "2026-11": 150_000, "2026-12": 155_000 } }],
    });
    expect(r.committed).toBe(150_000);
    const unknown = safeToSpend({
      today: "2026-11-30",
      balance: 400_000,
      incomeDays: [],
      payments: [{ dayOfMonth: 30, amount: 12_000, amountsByMonth: { "2026-11": null } }],
    });
    expect(unknown.committed).toBe(12_000);
  });
});

describe("dates", () => {
  it("day 31 moves to the last day of shorter months (29–31 rule)", () => {
    expect(monthlyDate(2026, 2, 31)).toBe("2026-02-28");
    expect(monthlyDate(2028, 2, 30)).toBe("2028-02-29");
    expect(nextMonthly("2026-11-15", 31)).toBe("2026-11-30");
    expect(nextMonthly("2026-12-31", 5)).toBe("2027-01-05");
  });
  it("today is taken in Asia/Almaty, not in UTC", () => {
    expect(todayIn("Asia/Almaty", new Date("2026-11-27T20:30:00Z"))).toBe("2026-11-28");
    expect(todayIn("UTC", new Date("2026-11-27T20:30:00Z"))).toBe("2026-11-27");
  });
});

describe("reserve days (BR-14)", () => {
  it("is not computed when mandatory expenses are unknown", () => {
    expect(reserveDays(500_000, null)).toBeNull();
    expect(reserveDays(500_000, 0)).toBeNull();
  });
  it("reserve divided by daily mandatory expenses, rounded down", () => {
    expect(reserveDays(125_000, 250_000)).toBe(15);
  });
});
