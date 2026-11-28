// In-memory mock backend with deterministic fixtures. Used when VITE_API_MODE !== "real".
import type {
  Account, BalancePoint, Category, CityPrice, DashboardSummary, DtiPoint, Goal, GoalProjection, ImportReport, IncomeSource,
  Insight, MacroIndicator, MerchantRule, MonthEndForecast, BalanceForecast, Obligation, ObligationsCalendar, PersonalInflation,
  Resilience, SavedScenario, ScenarioPreset, ScenarioResult, Shock, Transaction, User, AccountIn, TxKind, TxQuery, Decision, ImportPreview, RuleIn, RuleInfo, RulePreview, Rates, TransactionIn, TransferIn, TransactionPatch, PlannedPayment, PlannedIn, PlannedPatch, SettleIn,
} from "./types";

export const AS_OF = "2026-10-19";
export const MODEL_VERSION = "fc-2.3.1";

function rng(seed: number) {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) - 1) / 2147483646;
}
const iso = (d: Date) => d.toISOString().slice(0, 10);
const addDays = (isoDate: string, n: number) => { const d = new Date(isoDate + "T00:00:00Z"); d.setUTCDate(d.getUTCDate() + n); return iso(d); };

export const categories: Category[] = [
  { id: "food", name: "Продукты", color: "chart-1" },
  { id: "cafe", name: "Кафе и доставка", color: "chart-2" },
  { id: "transport", name: "Транспорт", color: "chart-3" },
  { id: "housing", name: "Жильё и ЖКУ", color: "chart-4" },
  { id: "credit", name: "Кредиты и рассрочки", color: "chart-5" },
  { id: "health", name: "Здоровье", color: "chart-3" },
  { id: "shopping", name: "Покупки", color: "chart-2" },
  { id: "transfers", name: "Переводы", color: "chart-5" },
  { id: "income", name: "Доход", color: "chart-3" },
  { id: "other", name: "Другое", color: "chart-5" },
];

const MERCHANTS: [string, string, number, number][] = [
  ["Magnum Cash&Carry", "food", 4000, 22000], ["Small", "food", 1500, 9000], ["Galmart", "food", 5000, 30000],
  ["Glovo", "cafe", 2500, 9000], ["Wolt", "cafe", 3000, 8000], ["Coffee Boom", "cafe", 1200, 3500],
  ["Yandex Go", "transport", 900, 4500], ["Onay", "transport", 200, 2000], ["Helios АЗС", "transport", 8000, 18000],
  ["Europharma", "health", 2000, 15000], ["Kaspi Магазин", "shopping", 6000, 60000], ["Wildberries", "shopping", 3000, 25000],
  ["Перевод Айгерим С.", "transfers", 5000, 40000], ["ИП Нурлан К.", "other", 2000, 15000],
];

export const accounts: Account[] = [
  { id: "acc-kaspi", bank: "Kaspi Bank", name: "Kaspi Gold", currency: "KZT", balance: 486_300 },
  { id: "acc-halyk", bank: "Halyk Bank", name: "Halyk карта", currency: "KZT", balance: 212_000 },
];

function genTransactions(): Transaction[] {
  const r = rng(42);
  const out: Transaction[] = [];
  let id = 1;
  for (let day = -110; day <= 0; day++) {
    const date = addDays(AS_OF, day);
    const n = Math.floor(r() * 4);
    for (let k = 0; k < n; k++) {
      const [merchant, cat, lo, hi] = MERCHANTS[Math.floor(r() * MERCHANTS.length)];
      const unsure = r() < 0.08;
      out.push({
        id: `t${id++}`, date, amount: -Math.round((lo + r() * (hi - lo)) / 10) * 10, currency: "KZT", merchant,
        categoryId: unsure ? "other" : cat, accountId: r() < 0.75 ? "acc-kaspi" : "acc-halyk", needsReview: unsure,
      });
    }
    const dom = new Date(date + "T00:00:00Z").getUTCDate();
    if (dom === 5) out.push({ id: `t${id++}`, date, amount: 620_000, currency: "KZT", merchant: "ТОО «Технодом» — зарплата", categoryId: "income", accountId: "acc-kaspi", needsReview: false });
    if (dom === 20) out.push({ id: `t${id++}`, date, amount: 180_000, currency: "KZT", merchant: "ТОО «Технодом» — аванс", categoryId: "income", accountId: "acc-kaspi", needsReview: false });
    if (dom === 1) out.push({ id: `t${id++}`, date, amount: -220_000, currency: "KZT", merchant: "Аренда квартиры", categoryId: "housing", accountId: "acc-kaspi", needsReview: false });
    if (dom === 10) out.push({ id: `t${id++}`, date, amount: -54_300, currency: "KZT", merchant: "Kaspi Рассрочка — iPhone", categoryId: "credit", accountId: "acc-kaspi", needsReview: false });
    if (dom === 15) out.push({ id: `t${id++}`, date, amount: -87_500, currency: "KZT", merchant: "Halyk Кредит наличными", categoryId: "credit", accountId: "acc-halyk", needsReview: false });
    if (dom === 12) out.push({ id: `t${id++}`, date, amount: -28_400, currency: "KZT", merchant: "Алсеко ЖКУ", categoryId: "housing", accountId: "acc-halyk", needsReview: false });
  }
  return out.sort((a, b) => (a.date < b.date ? 1 : -1));
}

export const db = {
  transactions: genTransactions(),
  rules: [{ id: "r1", merchant: "Glovo", categoryId: "cafe" }] as MerchantRule[],
  obligations: [
    { id: "o1", name: "Аренда квартиры", kind: "rent", amount: 220_000, dayOfMonth: 1, confirmed: true },
    { id: "o2", name: "Kaspi Рассрочка — iPhone", kind: "installment", amount: 54_300, dayOfMonth: 10, endsAt: "2027-04", confirmed: false },
    { id: "o3", name: "Halyk Кредит наличными", kind: "credit", amount: 87_500, dayOfMonth: 15, endsAt: "2028-02", confirmed: false },
    { id: "o4", name: "Алсеко ЖКУ", kind: "utility", amount: 28_400, dayOfMonth: 12, confirmed: false },
    { id: "o5", name: "Yandex Plus", kind: "subscription", amount: 2_490, dayOfMonth: 3, confirmed: false },
  ] as Obligation[],
  income: [
    { id: "i1", name: "Зарплата — ТОО «Технодом»", amount: 620_000, dayOfMonth: 5, confirmed: false },
    { id: "i2", name: "Аванс — ТОО «Технодом»", amount: 180_000, dayOfMonth: 20, confirmed: false },
  ] as IncomeSource[],
  goals: [
    { id: "g1", name: "Подушка безопасности", target: 2_400_000, saved: 860_000, monthly: 90_000, deadline: "2027-12" },
    { id: "g2", name: "Отпуск в Турции", target: 900_000, saved: 310_000, monthly: 60_000, deadline: "2027-06" },
  ] as Goal[],
  scenarios: [] as SavedScenario[],
  dismissed: new Set<string>(),
  planned: [] as PlannedPayment[],
  me: { id: "u1", email: "mock@example.com", name: "Айгерим", city: "Алматы", currency: "KZT", timezone: "Asia/Almaty", plannedIncome: null, essentialExpenses: null, workHours: null } as User,
};

export const rates: Rates = {
  base: "KZT",
  source: "Национальный банк РК, официальный курс (nationalbank.kz)",
  rates: [
    { currency: "USD", rate: 452.59, rateDate: AS_OF, fetchedAt: null, source: "demo-seed", stale: true },
    { currency: "EUR", rate: 492.1, rateDate: AS_OF, fetchedAt: null, source: "demo-seed", stale: true },
    { currency: "RUB", rate: 5.61, rateDate: AS_OF, fetchedAt: null, source: "demo-seed", stale: true },
  ],
};

export function createAccount(a: AccountIn): Account {
  const acc: Account = { id: "acc-" + Date.now(), bank: a.bank, name: a.name, kind: a.kind, currency: a.currency ?? "KZT", balance: a.balance ?? 0,
    confirmed: true, balanceKnown: a.balance != null, balanceAsOf: a.balance != null ? a.balanceAsOf ?? AS_OF : null, balanceSource: a.balance != null ? "manual" : null };
  const r = acc.currency === "KZT" ? 1 : rates.rates.find((x) => x.currency === acc.currency)?.rate;
  if (r && acc.currency !== "KZT") Object.assign(acc, { rate: r, rateDate: AS_OF, rateStale: true });
  if (r && a.balance != null) Object.assign(acc, { balanceKzt: Math.round(a.balance * r), currentBalanceKzt: Math.round(a.balance * r) });
  accounts.push(acc);
  return acc;
}
export function addCheckpoint(id: string, cp: { balance: number; asOf: string; source?: "manual" | "statement" }): Account {
  const acc = accounts.find((a) => a.id === id)!;
  return Object.assign(acc, { balance: cp.balance, balanceKnown: true, balanceAsOf: cp.asOf, balanceSource: cp.source ?? "manual", confirmed: true });
}
const autoKind = (t: Transaction): TxKind => (t.internal ? "transfer_own" : t.amount > 0 ? "income" : "expense");
export function filterTransactions(f: TxQuery): Transaction[] {
  const bankOf = (id: string) => accounts.find((a) => a.id === id)?.bank;
  return db.transactions
    .filter((t) => (!f.from || t.date >= f.from) && (!f.to || t.date <= f.to) && (!f.account || t.accountId === f.account)
      && (!f.bank || bankOf(t.accountId) === f.bank) && (!f.q || t.merchant.toLowerCase().includes(f.q.toLowerCase())))
    .map((t) => ({ ...t, kind: t.kind ?? autoKind(t), kindSource: t.kindSource ?? "auto" }));
}
export function setTxKind(id: string, kind: TxKind | null, saveRule: boolean): Transaction {
  const t = db.transactions.find((x) => x.id === id)!;
  const targets = saveRule ? db.transactions.filter((x) => x.merchant === t.merchant) : [t];
  for (const x of targets) Object.assign(x, kind ? { kind, kindSource: "user" } : { kind: autoKind({ ...x, kind: undefined }), kindSource: "auto" });
  return t;
}
export function decide<R extends { id: string; confirmed: boolean; rejected?: boolean }>(rows: R[], id: string, d: Decision): R {
  const r = rows.find((x) => x.id === id)!;
  if (d.rejected) Object.assign(r, { rejected: true, confirmed: false });
  else if (d.confirmed) Object.assign(r, { confirmed: true, rejected: false });
  else {
    if (d.confirmed === false) r.confirmed = false;
    if (d.rejected === false) r.rejected = false;
  }
  return r;
}

export function monthKey(isoDate: string) { return isoDate.slice(0, 7); }

export function summary(month: string): DashboardSummary {
  const [y, m] = month.split("-").map(Number);
  const prev = `${m === 1 ? y - 1 : y}-${String(m === 1 ? 12 : m - 1).padStart(2, "0")}`;
  const tx = db.transactions.filter((t) => !t.internal);
  const sum = (mk: string, f: (t: Transaction) => boolean) => tx.filter((t) => monthKey(t.date) === mk && f(t)).reduce((s, t) => s + t.amount, 0);
  const income = sum(month, (t) => t.amount > 0);
  const expense = -sum(month, (t) => t.amount < 0);
  const prevExpense = -sum(prev, (t) => t.amount < 0);
  const topCategories = categories.filter((c) => c.id !== "income").map((c) => ({
    categoryId: c.id, amount: -sum(month, (t) => t.categoryId === c.id && t.amount < 0), prev: -sum(prev, (t) => t.categoryId === c.id && t.amount < 0),
  })).filter((c) => c.amount > 0 || c.prev > 0).sort((a, b) => b.amount - a.amount);
  return { month, income, expense, net: income - expense, prevExpense, topCategories };
}

export function monthEnd(): MonthEndForecast {
  const s = summary(monthKey(AS_OF));
  const day = Number(AS_OF.slice(8));
  const pace = s.expense / day;
  const median = Math.round((s.expense + pace * (31 - day) * 0.92 + 220_000 * 0) / 1000) * 1000;
  return {
    as_of: AS_OF, model_version: MODEL_VERSION, month: monthKey(AS_OF), spentSoFar: s.expense, median,
    low: median - 60_000, high: median + 75_000, prevMonth: s.prevExpense, pacePerDay: Math.round(pace),
    drivers: [{ label: "Кафе и доставка", delta: 38_000 }, { label: "Покупки на Kaspi", delta: 24_000 }, { label: "Транспорт", delta: -9_000 }],
  };
}

function fan(start: number, days: number, drift: number, vol: number, extra: (i: number, date: string) => number = () => 0): BalancePoint[] {
  const out: BalancePoint[] = [];
  let mid = start;
  for (let i = 0; i <= days; i++) {
    const date = addDays(AS_OF, i);
    const dom = Number(date.slice(8));
    if (i > 0) {
      mid += drift;
      if (dom === 5) mid += 620_000; if (dom === 20) mid += 180_000;
      if (dom === 1) mid -= 220_000; if (dom === 10) mid -= 54_300; if (dom === 15) mid -= 87_500; if (dom === 12) mid -= 28_400;
      mid += extra(i, date);
    }
    const w = vol * Math.sqrt(i);
    const r = (v: number) => Math.round(v / 100) * 100;
    out.push({ date, p10: r(mid - 1.28 * w), p25: r(mid - 0.67 * w), p50: r(mid), p75: r(mid + 0.67 * w), p90: r(mid + 1.28 * w) });
  }
  return out;
}

const START_BALANCE = accounts.reduce((s, a) => s + a.balance, 0);
export function balance(days: number): BalanceForecast {
  const pts = fan(START_BALANCE, days, -19_500, 26_000);
  const riskDays = pts.filter((p) => p.p10 < 50_000).slice(0, 6).map((p) => ({
    date: p.date, reason: p.date.endsWith("-01") ? "Аренда до зарплаты" : "Платежи по кредитам до поступления дохода", pBelowZero: Math.min(0.45, Math.max(0.04, (50_000 - p.p10) / 600_000)),
  }));
  const payments: BalanceForecast["payments"] = [];
  for (let i = 1; i <= days; i++) {
    const d = addDays(AS_OF, i);
    for (const o of db.obligations) if (Number(d.slice(8)) === o.dayOfMonth) payments.push({ date: d, name: o.name, amount: o.amount });
  }
  return { as_of: AS_OF, model_version: MODEL_VERSION, days: pts, riskDays, payments };
}

export function calendar(): ObligationsCalendar {
  const months = Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(2026, 10 + i, 1)); const mk = iso(d).slice(0, 7);
    const active = (o: Obligation) => !o.endsAt || mk <= o.endsAt;
    const by = (k: Obligation["kind"][]) => db.obligations.filter((o) => k.includes(o.kind) && active(o)).reduce((s, o) => s + o.amount, 0);
    return { month: mk, credit: by(["credit"]), installment: by(["installment"]), regular: by(["rent", "utility", "subscription"]) };
  });
  return { months, income: 800_000 };
}
export function dtiHistory(): DtiPoint[] {
  const vals = [0.12, 0.13, 0.13, 0.19, 0.2, 0.21, 0.25, 0.26, 0.24, 0.25, 0.27, 0.268];
  return vals.map((dti, i) => ({ month: iso(new Date(Date.UTC(2025, 10 + i, 1))).slice(0, 7), dti }));
}

export function resilience(): Resilience {
  return {
    as_of: AS_OF, model_version: MODEL_VERSION, score: 62, pShortfall: 0.18, runwayMonths: 1.4,
    components: [
      { key: "buffer", name: "Финансовая подушка", status: "risk", value: "1,4 мес.", explain: "Сбережений хватит примерно на 1,4 месяца обязательных расходов без дохода.", action: "Откладывать 10% с каждой зарплаты до 3 месяцев запаса" },
      { key: "dti", name: "Долговая нагрузка (КДН)", status: "warn", value: "27%", explain: "Платежи по кредитам и рассрочкам забирают 27% дохода. Комфортно — до 30%, банки смотрят на 50%.", action: "Не брать новые рассрочки до закрытия iPhone в апреле" },
      { key: "volatility", name: "Стабильность расходов", status: "warn", value: "±14%", explain: "Расходы колеблются от месяца к месяцу сильнее, чем доход. Главный источник — доставка еды.", action: "Поставить лимит на «Кафе и доставку» 60 000 ₸" },
      { key: "income", name: "Стабильность дохода", status: "ok", value: "2 поступления", explain: "Зарплата и аванс приходят регулярно 5 и 20 числа последние 6 месяцев.", action: "Всё в порядке, ничего делать не нужно" },
      { key: "fx", name: "Валютный риск", status: "ok", value: "8% расходов", explain: "Лишь небольшая часть ваших трат напрямую зависит от курса доллара.", action: "Следить за покупками импортной техники" },
    ],
  };
}
export function resilienceHistory() {
  const vals = [70, 71, 69, 66, 64, 65, 61, 58, 60, 59, 61, 62];
  return vals.map((score, i) => ({ month: iso(new Date(Date.UTC(2025, 10 + i, 1))).slice(0, 7), score }));
}

export const presets: ScenarioPreset[] = [
  { id: "fx15", name: "Тенге −15%", description: "Импортные товары и техника дорожают", shocks: [{ type: "fx", value: 15 }] },
  { id: "inf15", name: "Инфляция 15%", description: "Цены на продукты и услуги растут быстрее", shocks: [{ type: "inflation", value: 15 }] },
  { id: "inc20", name: "Доход −20%", description: "Сокращение премии или часов", shocks: [{ type: "income", value: 20 }] },
  { id: "job3", name: "Потеря работы на 3 месяца", description: "Доход 0 на время поиска", shocks: [{ type: "jobloss", value: 3 }] },
];

export function runScenario(shocks: Shock[], days = 90): ScenarioResult {
  const base = fan(START_BALANCE, days, -19_500, 26_000);
  let extraDrift = 0; let incomeCut = 0; let jobDays = 0; let vol = 26_000;
  for (const s of shocks) {
    if (s.type === "fx") { extraDrift -= 600 * s.value * 0.4; vol *= 1 + s.value / 100; }
    if (s.type === "inflation") { extraDrift -= 600 * Math.max(0, s.value - 8); vol *= 1.05; }
    if (s.type === "income") incomeCut = s.value / 100;
    if (s.type === "jobloss") jobDays = s.value * 30;
  }
  const scenario = fan(START_BALANCE, days, -19_500 + extraDrift, vol, (i, date) => {
    const dom = Number(date.slice(8)); const inc = dom === 5 ? 620_000 : dom === 20 ? 180_000 : 0;
    return -(i <= jobDays ? inc : inc * incomeCut);
  });
  const minB = Math.min(...base.map((p) => p.p50)); const minS = Math.min(...scenario.map((p) => p.p50));
  const endB = base[base.length - 1].p50; const endS = scenario[scenario.length - 1].p50;
  const pB = base.filter((p) => p.p10 < 0).length / base.length; const pS = scenario.filter((p) => p.p10 < 0).length / scenario.length;
  const st = (v: number): "ok" | "warn" | "risk" => (v < 0 ? "risk" : v < 100_000 ? "warn" : "ok");
  const fmt = (n: number) => (n < 0 ? "−" : "") + Math.round(Math.abs(n)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ") + " ₸";
  return {
    as_of: AS_OF, model_version: MODEL_VERSION, base, scenario,
    deltas: [
      { label: `Баланс через ${days} дней`, base: fmt(endB), scenario: fmt(endS), status: st(endS) },
      { label: "Минимальный баланс", base: fmt(minB), scenario: fmt(minS), status: st(minS) },
      { label: "Дней с риском разрыва", base: `${Math.round(pB * days)}`, scenario: `${Math.round(pS * days)}`, status: pS > 0.2 ? "risk" : pS > 0.05 ? "warn" : "ok" },
      { label: "Индекс устойчивости", base: "62", scenario: `${Math.max(8, Math.round(62 - (endB - endS) / 40_000))}`, status: endB - endS > 800_000 ? "risk" : endB - endS > 200_000 ? "warn" : "ok" },
    ],
  };
}

export function insights(): Insight[] {
  return ([
    { id: "in1", status: "risk", title: "Возможен минус около 1 ноября", why: "Аренда 220 000 ₸ списывается за 4 дня до зарплаты, а прогнозный остаток к этому дню — около 90 000 ₸.", action: "Посмотреть прогноз", to: "/forecast" },
    { id: "in2", status: "warn", title: "Доставка еды +38% к сентябрю", why: "14 заказов Glovo и Wolt за 19 дней — это 61 000 ₸, в сентябре было 44 000 ₸ за весь месяц.", action: "Открыть расходы", to: "/expenses" },
    { id: "in3", status: "warn", title: "Ваша личная инфляция выше официальной", why: "Цены на то, что покупаете именно вы, выросли на 11,4% против 8,7% в среднем по стране — из-за продуктов и аренды.", action: "Почему так", to: "/macro" },
    { id: "in4", status: "ok", title: "Рассрочка за iPhone закончится в апреле", why: "После этого КДН снизится с 27% до 20%, освободится 54 300 ₸ в месяц.", action: "К обязательствам", to: "/debts" },
  ] as Insight[]).filter((i) => !db.dismissed.has(i.id));
}

export function macro(): MacroIndicator[] {
  return [
    { code: "usdkzt", name: "USD/KZT", value: "512,4 ₸", change: "+3,1% за месяц", trend: "up", why: "Техника, лекарства и часть продуктов импортные: при росте доллара ваши покупки на Kaspi дорожают через 1–3 месяца.", series: [478, 481, 486, 490, 488, 494, 497, 499, 503, 506, 509, 512] },
    { code: "brent", name: "Нефть Brent", value: "$78,2", change: "−2,4% за месяц", trend: "down", why: "Нефть — главный экспорт Казахстана. Её цена влияет на курс тенге и бюджет, а значит на зарплаты в госсекторе.", series: [84, 83, 85, 82, 80, 81, 79, 80, 82, 80, 79, 78] },
    { code: "cpi", name: "Инфляция, год к году", value: "8,7%", change: "−0,3 п.п.", trend: "down", why: "Средний рост цен. Ваша личная инфляция отличается — смотрите блок ниже.", series: [9.8, 9.6, 9.5, 9.4, 9.3, 9.2, 9.1, 9.0, 9.0, 8.9, 9.0, 8.7] },
    { code: "rate", name: "Базовая ставка НБРК", value: "14,25%", change: "без изменений", trend: "flat", why: "От неё зависят ставки по депозитам и новым кредитам. Сейчас депозит может защитить подушку от инфляции.", series: [15.25, 15.25, 15, 15, 14.75, 14.75, 14.5, 14.5, 14.25, 14.25, 14.25, 14.25] },
    { code: "food", name: "Продукты, год к году", value: "10,2%", change: "+0,4 п.п.", trend: "up", why: "Продукты — ваша крупнейшая категория (22% трат), поэтому этот рост вы почувствуете сильнее всего.", series: [8.9, 9.1, 9.3, 9.2, 9.4, 9.6, 9.7, 9.8, 9.9, 9.8, 9.8, 10.2] },
  ];
}
export function personalInflation(): PersonalInflation {
  return { as_of: AS_OF, model_version: MODEL_VERSION, personal: 0.114, official: 0.087, contributions: [
    { category: "Продукты", pp: 3.6 }, { category: "Аренда", pp: 3.1 }, { category: "Кафе и доставка", pp: 1.9 }, { category: "Транспорт", pp: 1.2 }, { category: "Покупки", pp: 0.9 }, { category: "Здоровье", pp: 0.5 }, { category: "Связь", pp: 0.2 },
  ] };
}
export function cityPrices(city: string): CityPrice[] {
  const k = city === "Алматы" ? 1.06 : city === "Астана" ? 1.04 : 1;
  return [
    ["Хлеб пшеничный", "кг", 380, 0.07], ["Молоко 2,5%", "л", 520, 0.09], ["Говядина", "кг", 3950, 0.12], ["Яйца", "10 шт", 720, 0.15],
    ["Картофель", "кг", 260, -0.04], ["Рис", "кг", 640, 0.06], ["Бензин АИ-92", "л", 245, 0.11], ["Проезд в автобусе", "поездка", 150, 0.25],
  ].map(([item, unit, p, c]) => ({ item: item as string, unit: unit as string, price: Math.round((p as number) * k), change: c as number }));
}

export function goalProjection(g: Goal): GoalProjection {
  const left = Math.max(0, g.target - g.saved);
  const months = g.monthly > 0 ? Math.ceil(left / g.monthly) : 999;
  const eta = new Date(Date.UTC(2026, 9 + months, 1));
  const [dy, dm] = g.deadline.split("-").map(Number);
  const monthsToDeadline = (dy - 2026) * 12 + (dm - 10);
  return { goalId: g.id, etaMonth: iso(eta).slice(0, 7), requiredMonthly: Math.ceil(left / Math.max(1, monthsToDeadline) / 1000) * 1000, onTrack: iso(eta).slice(0, 7) <= g.deadline };
}

export function fakeImport(bank: string): ImportReport {
  return { id: "imp-" + Date.now(), status: "done", parsed: db.transactions.length, needsReview: db.transactions.filter((t) => t.needsReview).length, period: { from: addDays(AS_OF, -110), to: AS_OF }, bank };
}

export function createTx(t: TransactionIn): Transaction {
  const tx: Transaction = { id: "m" + Date.now(), date: t.date, amount: t.amount, currency: "KZT", merchant: t.merchant, categoryId: t.category ?? "other",
    accountId: t.accountId, needsReview: false, kind: t.kind ?? (t.amount > 0 ? "income" : "expense"), kindSource: "user", source: "manual", note: t.note ?? null };
  db.transactions.unshift(tx);
  return tx;
}
export function updateTx(id: string, p: TransactionPatch): Transaction {
  const t = db.transactions.find((x) => x.id === id)!;
  const { category, ...rest } = p;
  return Object.assign(t, rest, category ? { categoryId: category } : {});
}
const plannedStatus = (p: PlannedPayment): PlannedPayment => {
  p.left = Math.max(0, p.amount - p.paid);
  if (p.status !== "cancelled") p.status = p.left === 0 ? "paid" : p.paid > 0 ? "partial" : "planned";
  return p;
};
export function addPlanned(i: PlannedIn): PlannedPayment {
  const p: PlannedPayment = { ...i, categoryId: i.category ?? null, id: "p" + Date.now(), status: "planned", paid: 0, left: i.amount, settlements: [] };
  db.planned.push(p);
  return p;
}
export function updatePlanned(id: string, patch: PlannedPatch): PlannedPayment {
  const p = db.planned.find((x) => x.id === id)!;
  const { cancelled, category, ...rest } = patch;
  Object.assign(p, rest, category !== undefined ? { categoryId: category } : {});
  if (cancelled !== undefined) p.status = cancelled ? "cancelled" : "planned";
  return plannedStatus(p);
}
export function settlePlanned(id: string, s: SettleIn): PlannedPayment {
  const p = db.planned.find((x) => x.id === id)!;
  const amount = s.amount ?? p.left;
  p.paid += amount;
  p.settlements.push({ transactionId: s.transactionId ?? "m" + Date.now(), amount, period: p.dueOn });
  return plannedStatus(p);
}

export function createTransfer(tr: TransferIn): Transaction[] {
  const group = "tr-" + tr.requestId;
  const done = db.transactions.filter((t) => t.transferGroup === group);
  if (done.length) return done;
  const legs: Transaction[] = [
    { id: "m" + Date.now(), date: tr.date, amount: -tr.amount, currency: "KZT", merchant: "Перевод", categoryId: "transfers", accountId: tr.fromAccountId, needsReview: false, internal: true, kind: "transfer_own", kindSource: "user", source: "manual", transferGroup: group },
    { id: "m" + (Date.now() + 1), date: tr.date, amount: tr.toAmount ?? tr.amount, currency: "KZT", merchant: "Перевод", categoryId: "transfers", accountId: tr.toAccountId, needsReview: false, internal: true, kind: "transfer_own", kindSource: "user", source: "manual", transferGroup: group },
  ];
  db.transactions.unshift(...legs);
  return legs;
}

export function fakePreview(bank: string): ImportPreview {
  return { bank, accountName: "Kaspi Gold", numberMask: null, currency: "KZT", periodFrom: "2026-09-01", periodTo: "2026-09-30", operations: 42,
    closingBalance: 120000, suggestedAccountId: accounts[0]?.id ?? null, matchedBy: "name", needsChoice: true,
    accounts: accounts.map((a) => ({ id: a.id, bank: a.bank, name: a.name, currency: a.currency, numberMask: a.numberMask ?? null })) };
}

export const ruleVariables = [
  { name: "days_in_month", description: "дней в месяце (28–31)" },
  { name: "income_min", description: "осторожный доход" },
];
/** Mock evaluation of the two common rules (the real parser is on the server). */
export function rulePreview(r: RuleIn): RulePreview {
  const days = 30;
  if (r.kind === "per_day") { const a = Number(r.params.perDay) * days; return { amount: a, explanation: `${r.params.perDay} ₸ × ${days} дн. = ${a} ₸`, estimate: false }; }
  if (r.kind === "percent_income") return { amount: null, explanation: "не рассчитано: нужен подтверждённый доход", missing: "income_min", estimate: true };
  if (r.kind === "formula" && /[^\w\s+\-*/().,;×÷]/.test(r.expression ?? "")) return { error: "недопустимый символ", errorPos: 0 };
  return { amount: 0, explanation: r.expression ?? "", estimate: false };
}
export function setRule(type: string, id: string, r: RuleIn): RuleInfo {
  const p = rulePreview(r);
  const info: RuleInfo = { kind: r.kind, params: r.params, expression: r.expression ?? "", validFrom: AS_OF.slice(0, 7), amountThisMonth: p.amount ?? null,
    explanation: p.explanation ?? "", estimate: !!p.estimate, missing: p.missing ?? null, amountsByMonth: { [AS_OF.slice(0, 7)]: p.amount ?? null } };
  const row = type === "obligation" ? db.obligations.find((o) => o.id === id) : db.planned.find((x) => x.id === id);
  if (row) row.rule = info;
  return info;
}
export function deleteAmountRule(type: string, id: string) {
  const row = type === "obligation" ? db.obligations.find((o) => o.id === id) : db.planned.find((x) => x.id === id);
  if (row) row.rule = null;
  return { ok: true };
}
