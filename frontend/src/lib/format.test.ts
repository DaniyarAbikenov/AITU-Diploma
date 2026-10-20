import { describe, expect, it } from "vitest";
import { formatDate, formatMoney, formatMonth, formatPercent, groupDigits } from "./format";

describe("money formatting", () => {
  it("groups thousands with spaces and adds ₸", () => {
    expect(formatMoney(1080000)).toBe("1 080 000 ₸");
  });
  it("shows explicit currency code for tables", () => {
    expect(formatMoney(250, "USD", { withCode: true })).toBe("250 $ USD");
  });
  it("uses a real minus sign for negatives", () => {
    expect(groupDigits(-60000)).toBe("−60 000");
  });
  it("adds plus for signed positives", () => {
    expect(formatMoney(5000, "KZT", { signed: true })).toBe("+5 000 ₸");
  });
  it("formats percent with comma", () => {
    expect(formatPercent(0.125, 1)).toBe("12,5%");
  });
});

describe("date formatting", () => {
  it("uses Russian genitive months", () => {
    expect(formatDate("2026-10-31")).toBe("31 октября");
  });
  it("formats months", () => {
    expect(formatMonth("2026-09")).toBe("сентябрь 2026");
  });
});
