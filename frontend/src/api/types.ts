// API contract types (mirror of architecture.md §5). Amounts are in tenge (major units) for the UI;
// when docs/openapi.json lands, replace this file with generated types (openapi-typescript).

export type Status = "ok" | "warn" | "risk";

export interface User {
  id: string; email: string; name: string; city: string; currency: "KZT";
  /** IANA zone, Asia/Almaty by default. Plan fields: null = not provided yet (never read as 0). */
  timezone?: string; plannedIncome?: number | null; essentialExpenses?: number | null; workHours?: number | null;
}
export type ProfilePatch = Partial<Pick<User, "name" | "city" | "timezone" | "plannedIncome" | "essentialExpenses" | "workHours">>;
export type AccountKind = "current" | "savings" | "cash";
export interface Account {
  id: string; bank: string; name: string; currency: "KZT" | "USD"; balance: number;
  kind?: AccountKind | null; confirmed?: boolean;
  /** false: no checkpoint or statement balance, `balance` is a placeholder and must not be shown as 0. */
  balanceKnown?: boolean; balanceAsOf?: string | null; balanceSource?: "manual" | "statement" | null;
  /** Checkpoint plus manual operations after it; null when the balance is unknown. */
  currentBalance?: number | null;
}
export interface AccountIn { bank: string; name: string; kind: AccountKind; currency?: "KZT" | "USD"; balance?: number | null; balanceAsOf?: string | null }
export interface Checkpoint { id: string; accountId: string; balance: number; asOf: string; source: "manual" | "statement" }
export type TxKind = "expense" | "income" | "income_salary" | "income_other" | "transfer_own" | "transfer_third_party";

export interface Category { id: string; name: string; color: string }
export interface Transaction {
  id: string; date: string; amount: number; currency: "KZT" | "USD";
  merchant: string; categoryId: string; accountId: string; needsReview: boolean; internal?: boolean;
  /** Effective type: the user's decision when kindSource = "user", otherwise derived from the import. */
  kind?: TxKind; kindSource?: "user" | "auto";
  source?: "import" | "manual"; note?: string | null; voided?: boolean;
  /** Imported values when the user corrected amount or date (the original is never overwritten). */
  original?: { amount: number; date: string } | null;
}
export interface TransactionIn { accountId: string; date: string; amount: number; merchant: string; category?: string | null; kind?: TxKind | null; note?: string | null }
export type TransactionPatch = Partial<Pick<TransactionIn, "accountId" | "date" | "amount" | "merchant" | "note">> & { category?: string };
export interface TransactionEdit { action: "create" | "update" | "void" | "restore" | "delete"; before?: Record<string, unknown> | null; after?: Record<string, unknown> | null; at: string }
export interface PlannedPayment {
  id: string; name: string; direction: "expense" | "income"; amount: number; dueOn: string; dueTo?: string | null;
  repeat: "once" | "yearly"; categoryId?: string | null; accountId?: string | null; mandatory: boolean; movable: boolean;
  status: "planned" | "partial" | "paid" | "cancelled"; paid: number; left: number;
  settlements: { transactionId: string; amount: number; period: string }[];
}
export type PlannedIn = Pick<PlannedPayment, "name" | "direction" | "amount" | "dueOn" | "repeat" | "mandatory" | "movable"> & { dueTo?: string | null; category?: string | null; accountId?: string | null };
export type PlannedPatch = Partial<PlannedIn> & { cancelled?: boolean };
export interface SettleIn { transactionId?: string; amount?: number; accountId?: string; date?: string }
export interface TxQuery { from?: string; to?: string; account?: string; bank?: string; q?: string }

export interface ImportReport { id: string; status: "processing" | "done" | "failed"; parsed: number; needsReview: number; period: { from: string; to: string }; bank: string; warnings?: string[] }

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

export interface Obligation { id: string; name: string; kind: "credit" | "installment" | "rent" | "subscription" | "utility"; amount: number; dayOfMonth: number; endsAt?: string | null; confirmed: boolean; rejected?: boolean; categoryId?: string | null; debtLeft?: number | null }
export type ObligationIn = Pick<Obligation, "name" | "kind" | "amount" | "dayOfMonth"> & { endsAt?: string | null; category?: string | null; debtLeft?: number | null };
export type Decision = { confirmed?: boolean; rejected?: boolean };
export interface ObligationsCalendar { months: { month: string; credit: number; installment: number; regular: number }[]; income: number }
export interface DtiPoint { month: string; dti: number }

export interface IncomeSource {
  id: string; name: string; amount: number; dayOfMonth: number; confirmed: boolean; rejected?: boolean;
  /** Payout varies: cautious plans use amountMin (FR-29). */
  amountMin?: number | null; amountMax?: number | null;
}
export type IncomeIn = Pick<IncomeSource, "name" | "amount" | "dayOfMonth"> & { amountMin?: number | null; amountMax?: number | null };

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
