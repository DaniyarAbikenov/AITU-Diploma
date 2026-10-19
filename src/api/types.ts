// API contract types (mirror of architecture.md §5). Amounts are in tenge (major units) for the UI;
// when docs/openapi.json lands, replace this file with generated types (openapi-typescript).

export type Status = "ok" | "warn" | "risk";

export interface User { id: string; email: string; name: string; city: string; currency: "KZT" }
export interface Account { id: string; bank: string; name: string; currency: "KZT" | "USD"; balance: number }

export interface Category { id: string; name: string; color: string }
export interface Transaction {
  id: string; date: string; amount: number; currency: "KZT" | "USD";
  merchant: string; categoryId: string; accountId: string; needsReview: boolean; internal?: boolean;
}

export interface ImportReport { id: string; status: "processing" | "done" | "failed"; parsed: number; needsReview: number; period: { from: string; to: string }; bank: string }

export interface Forecasted { as_of: string; model_version: string }

export interface MonthEndForecast extends Forecasted {
  month: string; spentSoFar: number; median: number; low: number; high: number;
  prevMonth: number; pacePerDay: number; drivers: { label: string; delta: number }[];
}
export interface BalancePoint { date: string; p10: number; p25: number; p50: number; p75: number; p90: number }
export interface BalanceForecast extends Forecasted {
  days: BalancePoint[]; riskDays: { date: string; reason: string; pBelowZero: number }[];
  payments: { date: string; name: string; amount: number }[];
}

export interface DashboardSummary { month: string; income: number; expense: number; net: number; prevExpense: number; topCategories: { categoryId: string; amount: number; prev: number }[] }

export interface Insight { id: string; status: Status; title: string; why: string; action: string; to: string }

export interface Obligation { id: string; name: string; kind: "credit" | "installment" | "rent" | "subscription" | "utility"; amount: number; dayOfMonth: number; endsAt?: string; confirmed: boolean }
export interface ObligationsCalendar { months: { month: string; credit: number; installment: number; regular: number }[]; income: number }
export interface DtiPoint { month: string; dti: number }

export interface IncomeSource { id: string; name: string; amount: number; dayOfMonth: number; confirmed: boolean }

export interface ResilienceComponent { key: string; name: string; status: Status; value: string; explain: string; action: string }
export interface Resilience extends Forecasted { score: number; pShortfall: number; runwayMonths: number; components: ResilienceComponent[] }

export interface Shock { type: "fx" | "inflation" | "income" | "jobloss"; value: number }
export interface ScenarioPreset { id: string; name: string; description: string; shocks: Shock[] }
export interface ScenarioResult extends Forecasted {
  base: BalancePoint[]; scenario: BalancePoint[];
  deltas: { label: string; base: string; scenario: string; status: Status }[];
}
export interface SavedScenario { id: string; name: string; shocks: Shock[]; createdAt: string }

export interface MacroIndicator { code: string; name: string; value: string; change: string; trend: "up" | "down" | "flat"; why: string; series: number[] }
export interface PersonalInflation extends Forecasted { personal: number; official: number; contributions: { category: string; pp: number }[] }
export interface CityPrice { item: string; unit: string; price: number; change: number }

export interface Goal { id: string; name: string; target: number; saved: number; monthly: number; deadline: string }
export interface GoalProjection { goalId: string; etaMonth: string; requiredMonthly: number; onTrack: boolean }

export interface MerchantRule { id: string; merchant: string; categoryId: string }
