import type { Status } from "@/api/types";

/** Debt-to-income: <30% comfortable, 30–50% attention, ≥50% risk. */
export const dtiStatus = (v: number) => (v < 0.3 ? "ok" : v < 0.5 ? "warn" : "risk") as Status;

/** Monthly payment for a 0%-installment or annuity credit. */
export function monthlyPayment(price: number, months: number, annualRate: number) {
  if (annualRate === 0) return Math.round(price / months);
  const r = annualRate / 12;
  return Math.round((price * r) / (1 - Math.pow(1 + r, -months)));
}


export function scoreStatus(score: number): Status { return score >= 70 ? "ok" : score >= 45 ? "warn" : "risk"; }
