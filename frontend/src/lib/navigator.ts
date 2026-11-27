/** Deterministic demo model. All money is integer KZT; goals are allocations inside savings. */
export const DEMO_DATE = "2026-11-27";
export const NAV_MODEL = "navigator-demo-v1";
export type NavGoal = {
  id: string;
  name: string;
  target: number;
  saved: number;
  monthly: number;
  kind: "home" | "car" | "reserve" | "other";
};
export type NavTransaction = {
  id: string;
  date: string;
  name: string;
  amount: number;
  category: string;
  kind: "income" | "expense" | "transfer";
  goalId?: string;
};
export type NavigatorState = {
  version: 1;
  name: string;
  income: number;
  essential: number;
  hours: number;
  committed: number;
  daysToSalary: number;
  openingChecking: number;
  openingSavings: number;
  goals: NavGoal[];
  transactions: NavTransaction[];
  completed: string[];
  strategy: "parallel" | "reserve";
  dismissed: boolean;
};
export type NavigatorAction =
  | {
      type: "transaction";
      entry: Omit<NavTransaction, "id" | "kind"> & { kind: "income" | "expense" };
      id?: string;
    }
  | { type: "delete"; id: string }
  | { type: "transfer"; goalId: string; amount: number }
  | { type: "goal"; name: string; target: number; monthly: number }
  | { type: "quest"; id: string }
  | { type: "strategy"; value: "parallel" | "reserve" }
  | { type: "settings"; name: string; income: number; essential: number; hours: number }
  | { type: "dismiss" };
export const NAV_QUESTS = [
  {
    id: "plan",
    title: "Составьте свой финансовый план",
    text: "Проверьте доход, обязательные расходы и рабочие часы в профиле.",
    xp: 20,
  },
  {
    id: "subscriptions",
    title: "Проверьте свои подписки",
    text: "Откройте список подписок и решите, какие вам нужны. Отметка означает, что вы провели проверку; деньги автоматически не добавляются.",
    xp: 20,
  },
  {
    id: "reserve",
    title: "Первый шаг к спокойствию",
    text: "Пополните резерв хотя бы на 10 000 ₸ в этом демо.",
    xp: 30,
  },
  {
    id: "lesson",
    title: "Разберитесь с финансовой подушкой",
    text: "Пройдите короткий урок о доступности резерва.",
    xp: 15,
  },
];
export function initialNavigator(): NavigatorState {
  return {
    version: 1,
    name: "Алия",
    income: 550000,
    essential: 250000,
    hours: 160,
    committed: 137800,
    daysToSalary: 28,
    openingChecking: 150180,
    openingSavings: 9125000,
    goals: [
      {
        id: "reserve",
        name: "Подушка спокойствия",
        target: 750000,
        saved: 125000,
        monthly: 50000,
        kind: "reserve",
      },
      {
        id: "home",
        name: "Своя квартира",
        target: 30000000,
        saved: 7200000,
        monthly: 150000,
        kind: "home",
      },
      {
        id: "car",
        name: "Новый автомобиль",
        target: 12000000,
        saved: 1800000,
        monthly: 50000,
        kind: "car",
      },
    ],
    transactions: [
      {
        id: "t1",
        date: "2026-11-27",
        name: "Кофе по дороге",
        amount: 1580,
        category: "Кафе",
        kind: "expense",
      },
      {
        id: "t2",
        date: "2026-11-26",
        name: "Magnum",
        amount: 24700,
        category: "Продукты",
        kind: "expense",
      },
      {
        id: "t3",
        date: "2026-11-26",
        name: "Yandex Go",
        amount: 2500,
        category: "Транспорт",
        kind: "expense",
      },
      {
        id: "t4",
        date: "2026-11-25",
        name: "Зарплата",
        amount: 550000,
        category: "Доход",
        kind: "income",
      },
      {
        id: "t5",
        date: "2026-11-25",
        name: "Аренда квартиры",
        amount: 145000,
        category: "Дом",
        kind: "expense",
      },
      {
        id: "t6",
        date: "2026-11-25",
        name: "Коммунальные услуги",
        amount: 32900,
        category: "Дом",
        kind: "expense",
      },
      {
        id: "t7",
        date: "2026-11-24",
        name: "Ужин с друзьями",
        amount: 8500,
        category: "Кафе",
        kind: "expense",
      },
    ],
    completed: [],
    strategy: "parallel",
    dismissed: false,
  };
}
export function navMetrics(s: NavigatorState) {
  const checking =
    s.openingChecking +
    s.transactions.reduce((a, t) => a + (t.kind === "income" ? t.amount : -t.amount), 0);
  const transferred = s.transactions
    .filter((t) => t.kind === "transfer")
    .reduce((a, t) => a + t.amount, 0);
  const savings = s.openingSavings + transferred;
  const reserve = s.goals.filter((g) => g.kind === "reserve").reduce((a, g) => a + g.saved, 0);
  const free = Math.max(0, checking - s.committed);
  const runway = Math.floor((reserve / s.essential) * 30);
  const score = Math.round(
    Math.min(60, (runway / 90) * 60) +
      Math.min(25, Math.max(0, (s.income - s.essential) / s.income) * 50) +
      (checking >= s.committed ? 15 : 0),
  );
  const xp =
    240 + NAV_QUESTS.filter((q) => s.completed.includes(q.id)).reduce((a, q) => a + q.xp, 0);
  return {
    checking,
    savings,
    reserve,
    free,
    daily: Math.floor(free / s.daysToSalary),
    capital: checking + savings,
    runway,
    score,
    xp,
    level: 5 + Math.floor(xp / 300),
    levelXP: xp % 300,
    expenses: s.transactions.filter((t) => t.kind === "expense").reduce((a, t) => a + t.amount, 0),
  };
}
function amount(n: number, allowZero = false) {
  if (!Number.isSafeInteger(n) || n < (allowZero ? 0 : 1) || n > 1e12)
    throw new Error("Укажите корректную сумму в целых тенге.");
}
function label(s: string) {
  if (!s.trim() || s.trim().length > 80)
    throw new Error("Название должно содержать от 1 до 80 символов.");
  return s.trim();
}
function validDate(d: string) {
  return (
    /^\d{4}-\d{2}-\d{2}$/.test(d) &&
    !Number.isNaN(Date.parse(d)) &&
    new Date(d).toISOString().slice(0, 10) === d
  );
}
export function updateNavigator(state: NavigatorState, a: NavigatorAction): NavigatorState {
  const s = structuredClone(state);
  if (a.type === "transaction") {
    amount(a.entry.amount);
    label(a.entry.name);
    if (!validDate(a.entry.date) || a.entry.date > DEMO_DATE)
      throw new Error("Выберите дату не позже 27 ноября 2026.");
    if (a.id) {
      const old = s.transactions.find((t) => t.id === a.id);
      if (!old || old.kind === "transfer") throw new Error("Эту операцию нельзя изменить.");
      s.transactions = s.transactions.filter((t) => t.id !== a.id);
    }
    if (a.entry.kind === "expense" && a.entry.amount > navMetrics(s).checking)
      throw new Error("На текущем счёте недостаточно средств.");
    s.transactions.unshift({
      ...a.entry,
      name: a.entry.name.trim(),
      id: a.id ?? crypto.randomUUID(),
    });
  } else if (a.type === "delete") {
    const t = s.transactions.find((t) => t.id === a.id);
    if (!t) throw new Error("Операция не найдена.");
    if (t.kind === "transfer") {
      const g = s.goals.find((g) => g.id === t.goalId);
      if (g) g.saved -= t.amount;
    }
    s.transactions = s.transactions.filter((t) => t.id !== a.id);
    if (navMetrics(s).checking < 0)
      throw new Error(
        "Нельзя удалить доход: средства уже использованы. Сначала отмените связанные расходы или переводы.",
      );
  } else if (a.type === "transfer") {
    amount(a.amount);
    const g = s.goals.find((g) => g.id === a.goalId);
    if (!g) throw new Error("Цель не найдена.");
    if (a.amount > navMetrics(s).checking)
      throw new Error("На текущем счёте недостаточно средств.");
    if (a.amount > g.target - g.saved) throw new Error("Сумма превышает остаток до цели.");
    g.saved += a.amount;
    s.transactions.unshift({
      id: crypto.randomUUID(),
      date: DEMO_DATE,
      name: `В цель «${g.name}»`,
      amount: a.amount,
      category: "Накопления",
      kind: "transfer",
      goalId: g.id,
    });
  } else if (a.type === "goal") {
    amount(a.target);
    amount(a.monthly);
    s.goals.push({
      id: crypto.randomUUID(),
      name: label(a.name),
      target: a.target,
      monthly: a.monthly,
      saved: 0,
      kind: "other",
    });
  } else if (a.type === "quest") {
    if (!NAV_QUESTS.some((q) => q.id === a.id)) throw new Error("Задание не найдено.");
    if (
      a.id === "reserve" &&
      s.transactions
        .filter((t) => t.kind === "transfer" && t.goalId === "reserve")
        .reduce((n, t) => n + t.amount, 0) < 10000
    )
      throw new Error("Сначала пополните резерв на 10 000 ₸.");
    if (!s.completed.includes(a.id)) s.completed.push(a.id);
  } else if (a.type === "strategy") s.strategy = a.value;
  else if (a.type === "dismiss") s.dismissed = true;
  else if (a.type === "settings") {
    amount(a.income);
    amount(a.essential);
    amount(a.hours);
    if (a.hours > 744) throw new Error("В месяце не больше 744 часов.");
    Object.assign(s, {
      name: label(a.name),
      income: a.income,
      essential: a.essential,
      hours: a.hours,
    });
  }
  if (navMetrics(s).checking < 0) throw new Error("Операция создаёт отрицательный баланс.");
  return s;
}
/** Scenario sensitivity range, NOT a calibrated confidence interval. No investment return assumed. */
export function projectNavigator(
  s: NavigatorState,
  months: number,
  lostMonths = 0,
  extraExpense = 0,
) {
  const capital = navMetrics(s).capital;
  return Array.from({ length: months + 1 }, (_, i) => {
    const median =
      capital + Math.max(0, i - lostMonths) * s.income - i * (s.essential + extraExpense);
    return {
      month: i,
      median,
      low: median - i * s.essential * 0.2,
      high: median + i * s.essential * 0.2,
    };
  });
}
export function goalMonths(s: NavigatorState, g: NavGoal) {
  if (g.saved >= g.target) return 0;
  const pool = s.goals.reduce((a, g) => a + g.monthly, 0);
  const reserve = s.goals.find((g) => g.kind === "reserve");
  const reserveMonths = reserve ? Math.ceil((reserve.target - reserve.saved) / pool) : 0;
  return s.strategy === "reserve"
    ? g.kind === "reserve"
      ? reserveMonths
      : reserveMonths + Math.ceil((g.target - g.saved) / g.monthly)
    : Math.ceil((g.target - g.saved) / g.monthly);
}
