import { queryOptions } from "@tanstack/react-query";
import * as m from "./mock";
import type * as T from "./types";
import { getToken } from "@/lib/auth";

/** VITE_API_MODE=real switches every call to the backend at VITE_API_URL (default /api/v1). */
export const API_MODE = (import.meta.env.VITE_API_MODE as string | undefined) === "real" ? "real" : "mock";
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

export class ApiError extends Error { constructor(public status: number, public detail: string) { super(detail); } }

async function http<R>(path: string, init: RequestInit = {}): Promise<R> {
  const token = getToken();
  const res = await fetch(BASE + path, { ...init, headers: { ...(init.body instanceof FormData ? {} : { "Content-Type": "application/json" }), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...init.headers } });
  if (!res.ok) { const p = await res.json().catch(() => ({})); throw new ApiError(res.status, p.detail ?? p.title ?? res.statusText); }
  return res.json() as Promise<R>;
}
const delay = (ms = 350) => new Promise((r) => setTimeout(r, ms));
async function call<R>(path: string, mock: () => R, init?: RequestInit): Promise<R> {
  if (API_MODE === "real") return http<R>(path, init);
  await delay();
  return structuredClone(mock());
}
const body = (method: string, b: unknown): RequestInit => ({ method, body: JSON.stringify(b) });

export const api = {
  accounts: () => call<T.Account[]>("/accounts", () => m.accounts),
  categories: () => call<T.Category[]>("/categories", () => m.categories),
  transactions: () => call<T.Transaction[]>("/transactions", () => m.db.transactions),
  recategorize: (id: string, categoryId: string) => call("/transactions/" + id, () => {
    const t = m.db.transactions.find((x) => x.id === id); if (t) { t.categoryId = categoryId; t.needsReview = false; } return t;
  }, body("PATCH", { category: categoryId })),
  bulkCategorize: (merchant: string, categoryId: string) => call("/transactions/bulk-categorize", () => {
    m.db.transactions.filter((t) => t.merchant === merchant).forEach((t) => { t.categoryId = categoryId; t.needsReview = false; });
    m.db.rules.push({ id: "r" + Date.now(), merchant, categoryId }); return { ok: true };
  }, body("POST", { merchant, category: categoryId })),
  rules: () => call<T.MerchantRule[]>("/merchant-rules", () => m.db.rules),
  deleteRule: (id: string) => call("/merchant-rules/" + id, () => { m.db.rules = m.db.rules.filter((r) => r.id !== id); return { ok: true }; }, { method: "DELETE" }),
  importStatement: (bank: string, file?: File) => {
    let init = body("POST", { bank });
    if (file) { const form = new FormData(); form.append("bank", bank); form.append("file", file); init = { method: "POST", body: form }; }
    return call<T.ImportReport>("/imports", () => m.fakeImport(bank), init);
  },
  summary: (month: string) => call<T.DashboardSummary>(`/dashboard/summary?month=${month}`, () => m.summary(month)),
  monthEnd: () => call<T.MonthEndForecast>("/forecast/month-end", m.monthEnd),
  balance: (days: number) => call<T.BalanceForecast>(`/forecast/balance?days=${days}`, () => m.balance(days)),
  insights: () => call<T.Insight[]>("/insights", m.insights),
  dismissInsight: (id: string) => call(`/insights/${id}/dismiss`, () => { m.db.dismissed.add(id); return { ok: true }; }, { method: "POST" }),
  obligations: () => call<T.Obligation[]>("/obligations", () => m.db.obligations),
  confirmObligation: (id: string, confirmed: boolean) => call("/obligations/" + id, () => { const o = m.db.obligations.find((x) => x.id === id); if (o) o.confirmed = confirmed; return o; }, body("PATCH", { confirmed })),
  calendar: () => call<T.ObligationsCalendar>("/obligations/calendar?months=12", m.calendar),
  dti: () => call<T.DtiPoint[]>("/obligations/dti-history", m.dtiHistory),
  income: () => call<T.IncomeSource[]>("/income-sources", () => m.db.income),
  confirmIncome: (id: string, confirmed: boolean) => call("/income-sources/" + id, () => { const o = m.db.income.find((x) => x.id === id); if (o) o.confirmed = confirmed; return o; }, body("PATCH", { confirmed })),
  resilience: () => call<T.Resilience>("/resilience", m.resilience),
  resilienceHistory: () => call<{ month: string; score: number }[]>("/resilience/history", m.resilienceHistory),
  presets: () => call<T.ScenarioPreset[]>("/scenarios/presets", () => m.presets),
  runScenario: (shocks: T.Shock[]) => call<T.ScenarioResult>("/scenarios/run", () => m.runScenario(shocks), body("POST", { shocks })),
  savedScenarios: () => call<T.SavedScenario[]>("/scenarios", () => m.db.scenarios),
  saveScenario: (name: string, shocks: T.Shock[]) => call("/scenarios", () => { m.db.scenarios.unshift({ id: "s" + Date.now(), name, shocks, createdAt: m.AS_OF }); return { ok: true }; }, body("POST", { name, shocks })),
  macro: () => call<T.MacroIndicator[]>("/macro/overview", m.macro),
  personalInflation: () => call<T.PersonalInflation>("/macro/personal-inflation", m.personalInflation),
  cityPrices: (city: string) => call<T.CityPrice[]>(`/macro/city-prices?city=${encodeURIComponent(city)}`, () => m.cityPrices(city)),
  goals: () => call<(T.Goal & { projection: T.GoalProjection })[]>("/goals", () => m.db.goals.map((g) => ({ ...g, projection: m.goalProjection(g) }))),
  addGoal: (g: Omit<T.Goal, "id">) => call("/goals", () => { m.db.goals.push({ ...g, id: "g" + Date.now() }); return { ok: true }; }, body("POST", g)),
  deleteGoal: (id: string) => call("/goals/" + id, () => { m.db.goals = m.db.goals.filter((g) => g.id !== id); return { ok: true }; }, { method: "DELETE" }),
  deleteAllData: () => call("/me", () => { m.db.transactions = []; m.db.goals = []; m.db.scenarios = []; return { ok: true }; }, { method: "DELETE" }),
};

export const q = {
  accounts: queryOptions({ queryKey: ["accounts"], queryFn: api.accounts }),
  categories: queryOptions({ queryKey: ["categories"], queryFn: api.categories, staleTime: Infinity }),
  transactions: queryOptions({ queryKey: ["transactions"], queryFn: api.transactions }),
  rules: queryOptions({ queryKey: ["rules"], queryFn: api.rules }),
  summary: (month: string) => queryOptions({ queryKey: ["summary", month], queryFn: () => api.summary(month) }),
  monthEnd: queryOptions({ queryKey: ["monthEnd"], queryFn: api.monthEnd }),
  balance: (days: number) => queryOptions({ queryKey: ["balance", days], queryFn: () => api.balance(days) }),
  insights: queryOptions({ queryKey: ["insights"], queryFn: api.insights }),
  obligations: queryOptions({ queryKey: ["obligations"], queryFn: api.obligations }),
  calendar: queryOptions({ queryKey: ["calendar"], queryFn: api.calendar }),
  dti: queryOptions({ queryKey: ["dti"], queryFn: api.dti }),
  income: queryOptions({ queryKey: ["income"], queryFn: api.income }),
  resilience: queryOptions({ queryKey: ["resilience"], queryFn: api.resilience }),
  resilienceHistory: queryOptions({ queryKey: ["resilienceHistory"], queryFn: api.resilienceHistory }),
  presets: queryOptions({ queryKey: ["presets"], queryFn: api.presets }),
  savedScenarios: queryOptions({ queryKey: ["savedScenarios"], queryFn: api.savedScenarios }),
  macro: queryOptions({ queryKey: ["macro"], queryFn: api.macro }),
  personalInflation: queryOptions({ queryKey: ["personalInflation"], queryFn: api.personalInflation }),
  cityPrices: (city: string) => queryOptions({ queryKey: ["cityPrices", city], queryFn: () => api.cityPrices(city) }),
  goals: queryOptions({ queryKey: ["goals"], queryFn: api.goals }),
};
