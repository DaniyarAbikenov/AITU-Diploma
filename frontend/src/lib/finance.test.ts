import { describe, expect, it } from "vitest";
import { dtiStatus, monthlyPayment, scoreStatus } from "./finance";

describe("finance rules", () => {
  it("0% installment splits price evenly", () => expect(monthlyPayment(450000, 12, 0)).toBe(37500));
  it("annuity with interest costs more than even split", () => expect(monthlyPayment(1200000, 12, 0.2)).toBe(111161));
  it("DTI under 30% is ok", () => expect(dtiStatus(0.27)).toBe("ok"));
  it("DTI 30–50% needs attention", () => expect(dtiStatus(0.35)).toBe("warn"));
  it("DTI from 50% is risk", () => expect(dtiStatus(0.5)).toBe("risk"));
  it("score 62 is warn", () => expect(scoreStatus(62)).toBe("warn"));
});
