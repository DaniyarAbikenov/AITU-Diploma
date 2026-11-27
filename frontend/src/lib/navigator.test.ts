import { describe, it, expect } from "vitest";
import { initialNavigator, navMetrics, updateNavigator, projectNavigator } from "./navigator";
describe("Navigator money model", () => {
  it("counts allocated goal funds once", () => {
    const s = initialNavigator(),
      m = navMetrics(s);
    expect(m.checking).toBe(485000);
    expect(m.savings).toBe(9125000);
    expect(m.capital).toBe(9610000);
    expect(m.daily).toBe(12400);
    expect(m.runway).toBe(15);
  });
  it("moves money to goals without creating capital and reverses a transfer", () => {
    const s = initialNavigator(),
      before = navMetrics(s),
      next = updateNavigator(s, { type: "transfer", goalId: "reserve", amount: 10000 }),
      after = navMetrics(next);
    expect(after.capital).toBe(before.capital);
    expect(after.checking).toBe(before.checking - 10000);
    expect(after.savings).toBe(before.savings + 10000);
    expect(after.reserve).toBe(before.reserve + 10000);
    expect(
      navMetrics(updateNavigator(next, { type: "delete", id: next.transactions[0].id })),
    ).toEqual(before);
    expect(s.goals[0].saved).toBe(125000);
  });
  it("rejects overdrawn transfers, oversaving and non-finite amounts", () => {
    const s = initialNavigator();
    for (const amount of [0, -1, NaN, Infinity, 0.5, 500000])
      expect(() => updateNavigator(s, { type: "transfer", goalId: "reserve", amount })).toThrow();
    expect(() => updateNavigator(s, { type: "transfer", goalId: "missing", amount: 10 })).toThrow();
  });
  it("corrects expenses by the difference and leaves goals unchanged", () => {
    const s = initialNavigator(),
      next = updateNavigator(s, {
        type: "transaction",
        id: "t1",
        entry: { ...s.transactions[0], kind: "expense", amount: 1000 },
      });
    expect(navMetrics(next).checking - navMetrics(s).checking).toBe(580);
    expect(next.goals).toEqual(s.goals);
  });
  it("refuses deleting income when the balance would be negative", () => {
    expect(() => updateNavigator(initialNavigator(), { type: "delete", id: "t4" })).toThrow();
  });
  it("validates dates including invalid calendar dates", () => {
    for (const date of ["garbage", "2026-02-30", "2027-01-01"])
      expect(() =>
        updateNavigator(initialNavigator(), {
          type: "transaction",
          entry: { name: "Test", date, amount: 10, category: "Другое", kind: "expense" },
        }),
      ).toThrow();
  });
  it("awards XP once and does not invent subscription savings", () => {
    const s = initialNavigator(),
      next = updateNavigator(s, { type: "quest", id: "subscriptions" }),
      again = updateNavigator(next, { type: "quest", id: "subscriptions" });
    expect(navMetrics(again).xp).toBe(260);
    expect(navMetrics(again).capital).toBe(navMetrics(s).capital);
  });
  it("requires an actual reserve transfer for the reserve quest", () => {
    const s = initialNavigator();
    expect(() => updateNavigator(s, { type: "quest", id: "reserve" })).toThrow();
    expect(
      updateNavigator(updateNavigator(s, { type: "transfer", goalId: "reserve", amount: 10000 }), {
        type: "quest",
        id: "reserve",
      }).completed,
    ).toContain("reserve");
  });
  it("models lost income and sensitivity without subtracting goal transfers twice", () => {
    const s = initialNavigator(),
      base = projectNavigator(s, 12).at(-1)!,
      stress = projectNavigator(s, 12, 3, 10000).at(-1)!;
    expect(base.median - stress.median).toBe(s.income * 3 + 120000);
    expect(stress.low).toBeLessThan(stress.median);
    expect(stress.high).toBeGreaterThan(stress.median);
    const moved = updateNavigator(s, { type: "transfer", goalId: "reserve", amount: 10000 });
    expect(projectNavigator(moved, 12)).toEqual(projectNavigator(s, 12));
  });
});
