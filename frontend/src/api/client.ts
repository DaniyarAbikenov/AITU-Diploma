import { queryOptions } from "@tanstack/react-query";
import * as m from "./mock";
import { readNavigator, mutateNavigator, resetNavigator } from "./navigator-store";
import type { NavigatorAction } from "@/lib/navigator";
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
  navigator: async () => readNavigator(),
  updateNavigator: async (action: NavigatorAction) => mutateNavigator(action),
  resetNavigator: async () => resetNavigator(),
  rates: () => call<T.Rates>("/rates", () => m.rates),
  me: () => call<T.User>("/me", () => m.db.me),
  updateMe: (patch: T.ProfilePatch) => call<T.User>("/me", () => Object.assign(m.db.me, patch), body("PATCH", patch)),
  accounts: () => call<T.Account[]>("/accounts", () => m.accounts),
  createAccount: (a: T.AccountIn) => call<T.Account>("/accounts", () => m.createAccount(a), body("POST", a)),
  updateAccount: (id: string, patch: Partial<Pick<T.Account, "bank" | "name" | "kind" | "confirmed" | "currency">> & T.Availability) =>
    call<T.Account>("/accounts/" + id, () => Object.assign(m.accounts.find((a) => a.id === id)!, patch), body("PATCH", patch)),
  addCheckpoint: (id: string, cp: { balance: number; asOf: string; source?: "manual" | "statement" }) =>
    call<T.Account>(`/accounts/${id}/checkpoints`, () => m.addCheckpoint(id, cp), body("POST", cp)),
  transactionsFor: (f: T.TxQuery) => {
    const p = new URLSearchParams();
    if (f.from) p.set("date_from", f.from);
    if (f.to) p.set("date_to", f.to);
    if (f.account) p.set("account", f.account);
    if (f.bank) p.set("bank", f.bank);
    if (f.q) p.set("q", f.q);
    return call<T.Transaction[]>("/transactions?" + p, () => m.filterTransactions(f));
  },
  createTx: (t: T.TransactionIn) => call<T.Transaction>("/transactions", () => m.createTx(t), body("POST", t)),
  updateTx: (id: string, patch: T.TransactionPatch) => call<T.Transaction>("/transactions/" + id, () => m.updateTx(id, patch), body("PATCH", patch)),
  deleteTx: (id: string) => call("/transactions/" + id, () => { m.db.transactions = m.db.transactions.filter((x) => x.id !== id); return { ok: true }; }, { method: "DELETE" }),
  voidTx: (id: string, voided: boolean) => call<T.Transaction>(`/transactions/${id}/${voided ? "void" : "restore"}`, () => Object.assign(m.db.transactions.find((x) => x.id === id)!, { voided }), { method: "POST" }),
  txHistory: (id: string) => call<T.TransactionEdit[]>(`/transactions/${id}/history`, () => []),
  moveOperations: (fromId: string, toId: string) => call(`/accounts/${fromId}/move-operations`, () => { m.db.transactions.forEach((t) => { if (t.accountId === fromId) t.accountId = toId; }); return { ok: true }; }, body("POST", { targetAccountId: toId })),
  createTransfer: (tr: T.TransferIn) => call<T.Transaction[]>("/transfers", () => m.createTransfer(tr), body("POST", tr)),
  transferCandidates: () => call<T.TransferCandidate[]>("/transfers/candidates", () => []),
  linkTransfer: (outId: string, inId: string) => call<T.Transaction[]>("/transfers/link", () => [], body("POST", { outId, inId })),
  setTxKind: (id: string, kind: T.TxKind | null, saveRule = false) =>
    call<T.Transaction>(`/transactions/${id}/kind`, () => m.setTxKind(id, kind, saveRule), body("PATCH", { kind, saveRule })),
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
  previewStatement: (bank: string, file: File) => {
    const form = new FormData(); form.append("bank", bank); form.append("file", file);
    return call<T.ImportPreview>("/imports/preview", () => m.fakePreview(bank), { method: "POST", body: form });
  },
  /** accountId: "auto" | "new" | an account id chosen in the preview. */
  importStatement: (bank: string, file?: File, accountId = "auto") => {
    let init = body("POST", { bank });
    if (file) { const form = new FormData(); form.append("bank", bank); form.append("file", file); form.append("accountId", accountId); init = { method: "POST", body: form }; }
    return call<T.ImportReport>("/imports", () => m.fakeImport(bank), init);
  },
  summary: (month: string) => call<T.DashboardSummary>(`/dashboard/summary?month=${month}`, () => m.summary(month)),
  monthEnd: () => call<T.MonthEndForecast>("/forecast/month-end", m.monthEnd),
  balance: (days: number) => call<T.BalanceForecast>(`/forecast/balance?days=${days}`, () => m.balance(days)),
  insights: () => call<T.Insight[]>("/insights", m.insights),
  dismissInsight: (id: string) => call(`/insights/${id}/dismiss`, () => { m.db.dismissed.add(id); return { ok: true }; }, { method: "POST" }),
  obligations: () => call<T.Obligation[]>("/obligations", () => m.db.obligations),
  confirmObligation: (id: string, confirmed: boolean) => call("/obligations/" + id, () => { const o = m.db.obligations.find((x) => x.id === id); if (o) o.confirmed = confirmed; return o; }, body("PATCH", { confirmed })),
  addObligation: (o: T.ObligationIn) => call<T.Obligation>("/obligations", () => { const n = { ...o, id: "o" + Date.now(), confirmed: true, rejected: false, categoryId: o.category ?? null }; m.db.obligations.push(n); return n; }, body("POST", o)),
  updateObligation: (id: string, patch: Partial<T.ObligationIn>) => call<T.Obligation>("/obligations/" + id, () => Object.assign(m.db.obligations.find((x) => x.id === id)!, patch), body("PATCH", patch)),
  deleteObligation: (id: string) => call("/obligations/" + id, () => { m.db.obligations = m.db.obligations.filter((x) => x.id !== id); return { ok: true }; }, { method: "DELETE" }),
  planned: () => call<T.PlannedPayment[]>("/planned-payments", () => m.db.planned),
  addPlanned: (p: T.PlannedIn) => call<T.PlannedPayment>("/planned-payments", () => m.addPlanned(p), body("POST", p)),
  updatePlanned: (id: string, patch: T.PlannedPatch) => call<T.PlannedPayment>("/planned-payments/" + id, () => m.updatePlanned(id, patch), body("PATCH", patch)),
  deletePlanned: (id: string) => call("/planned-payments/" + id, () => { m.db.planned = m.db.planned.filter((x) => x.id !== id); return { ok: true }; }, { method: "DELETE" }),
  settlePlanned: (id: string, s: T.SettleIn) => call<T.PlannedPayment>(`/planned-payments/${id}/settle`, () => m.settlePlanned(id, s), body("POST", s)),
  decideObligation: (id: string, d: T.Decision) => call<T.Obligation>("/obligations/" + id, () => m.decide(m.db.obligations, id, d), body("PATCH", d)),
  calendar: () => call<T.ObligationsCalendar>("/obligations/calendar?months=12", m.calendar),
  dti: () => call<T.DtiPoint[]>("/obligations/dti-history", m.dtiHistory),
  income: () => call<T.IncomeSource[]>("/income-sources", () => m.db.income),
  decideIncome: (id: string, d: T.Decision) => call<T.IncomeSource>("/income-sources/" + id, () => m.decide(m.db.income, id, d), body("PATCH", d)),
  addIncome: (i: T.IncomeIn) => call<T.IncomeSource>("/income-sources", () => { const n = { ...i, id: "i" + Date.now(), confirmed: true, rejected: false }; m.db.income.push(n); return n; }, body("POST", i)),
  updateIncome: (id: string, patch: Partial<T.IncomeIn>) => call<T.IncomeSource>("/income-sources/" + id, () => Object.assign(m.db.income.find((x) => x.id === id)!, patch), body("PATCH", patch)),
  deleteIncome: (id: string) => call("/income-sources/" + id, () => { m.db.income = m.db.income.filter((x) => x.id !== id); return { ok: true }; }, { method: "DELETE" }),
  confirmIncome: (id: string, confirmed: boolean) => call("/income-sources/" + id, () => { const o = m.db.income.find((x) => x.id === id); if (o) o.confirmed = confirmed; return o; }, body("PATCH", { confirmed })),
  resilience: () => call<T.Resilience>("/resilience", m.resilience),
  resilienceHistory: () => call<{ month: string; score: number }[]>("/resilience/history", m.resilienceHistory),
  presets: () => call<T.ScenarioPreset[]>("/scenarios/presets", () => m.presets),
  runScenario: (shocks: T.Shock[]) => call<T.ScenarioResult>("/scenarios/run", () => m.runScenario(shocks), body("POST", { shocks })),
  savedScenarios: () => call<T.SavedScenario[]>("/scenarios", () => m.db.scenarios),
  saveScenario: (name: string, shocks: T.Shock[]) => call("/scenarios", () => { m.db.scenarios.unshift({ id: "s" + Date.now(), name, shocks, createdAt: m.AS_OF }); return { ok: true }; }, body("POST", { name, shocks })),
  deleteScenario: (id: string) => call("/scenarios/" + id, () => { m.db.scenarios = m.db.scenarios.filter((x) => x.id !== id); return { ok: true }; }, { method: "DELETE" }),
  macro: () => call<T.MacroIndicator[]>("/macro/overview", m.macro),
  personalInflation: () => call<T.PersonalInflation>("/macro/personal-inflation", m.personalInflation),
  cityPrices: (city: string) => call<T.CityPrice[]>(`/macro/city-prices?city=${encodeURIComponent(city)}`, () => m.cityPrices(city)),
  goals: () => call<(T.Goal & { projection: T.GoalProjection })[]>("/goals", () => m.db.goals.map((g) => ({ ...g, projection: m.goalProjection(g) }))),
  addGoal: (g: Omit<T.Goal, "id">) => call("/goals", () => { m.db.goals.push({ ...g, id: "g" + Date.now() }); return { ok: true }; }, body("POST", g)),
  deleteGoal: (id: string) => call("/goals/" + id, () => { m.db.goals = m.db.goals.filter((g) => g.id !== id); return { ok: true }; }, { method: "DELETE" }),
  deleteAllData: () => call("/me", () => { m.db.transactions = []; m.db.goals = []; m.db.scenarios = []; return { ok: true }; }, { method: "DELETE" }),
};

export const q = {
  navigator: queryOptions({ queryKey: ["navigator"], queryFn: api.navigator, enabled: typeof window !== "undefined", retry: false }),
  /** NBK publishes one official rate a day; the server re-reads it hourly, the page re-asks every 10 minutes. */
  rates: queryOptions({ queryKey: ["rates"], queryFn: api.rates, refetchInterval: 10 * 60 * 1000 }),
  me: queryOptions({ queryKey: ["me"], queryFn: api.me }),
  accounts: queryOptions({ queryKey: ["accounts"], queryFn: api.accounts }),
  transactionsFor: (f: T.TxQuery) => queryOptions({ queryKey: ["transactions", f], queryFn: () => api.transactionsFor(f) }),
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
  transferCandidates: queryOptions({ queryKey: ["transactions", "candidates"], queryFn: api.transferCandidates }),
  planned: queryOptions({ queryKey: ["planned"], queryFn: api.planned }),
  txHistory: (id: string) => queryOptions({ queryKey: ["txHistory", id], queryFn: () => api.txHistory(id) }),
};
