import { useEffect, useState, type ReactNode } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  ArrowDownLeft,
  BookOpen,
  CalendarDays,
  Car,
  Check,
  CheckCheck,
  ChevronLeft,
  ChevronRight,
  Coffee,
  Compass,
  Home,
  Info,
  LayoutDashboard,
  Leaf,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  Target,
  Trash2,
  TrendingUp,
  Wallet,
  X,
} from "lucide-react";
import { api, q } from "@/api/client";
import { Chart, baseAxis } from "@/components/charts";
import { EstimateNote, Loading } from "@/components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DEMO_DATE,
  NAV_MODEL,
  NAV_QUESTS,
  goalMonths,
  navMetrics,
  projectNavigator,
  type NavGoal,
  type NavigatorAction,
  type NavigatorState,
  type NavTransaction,
} from "@/lib/navigator";
import "./navigator.css";

const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) + " ₸";
const compact = (n: number) =>
  new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n) +
  " ₸";
const tabs = [
  { id: "home", name: "Обзор", icon: LayoutDashboard },
  { id: "goals", name: "Мои цели", icon: Target },
  { id: "transactions", name: "Операции", icon: Wallet },
  { id: "calendar", name: "Календарь", icon: CalendarDays },
  { id: "forecast", name: "Прогноз", icon: TrendingUp },
  { id: "quests", name: "Мой прогресс", icon: Leaf },
  { id: "profile", name: "Профиль", icon: Settings2 },
] as const;
type Tab = (typeof tabs)[number]["id"];
type Modal =
  | { type: "transaction"; entry?: NavTransaction }
  | { type: "transfer"; goal: NavGoal }
  | { type: "goal" }
  | { type: "strategy" }
  | { type: "safe" }
  | { type: "score" }
  | { type: "lesson" }
  | { type: "delete"; entry: NavTransaction }
  | { type: "reset" }
  | null;
const goalIcon = (kind: NavGoal["kind"]) =>
  kind === "home" ? Home : kind === "car" ? Car : kind === "reserve" ? ShieldCheck : Target;
function Panel({
  title,
  action,
  children,
  className = "",
}: {
  title?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`nav-panel ${className}`}>
      {title && (
        <div className="nav-panel-heading">
          <h2>{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}
function Progress({ value, label }: { value: number; label: string }) {
  return (
    <div
      className="nav-progress"
      role="progressbar"
      aria-label={label}
      aria-valuenow={Math.round(value)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <span style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
    </div>
  );
}
function City() {
  return (
    <svg className="nav-city" viewBox="0 0 450 270" fill="none" aria-hidden="true">
      <defs>
        <linearGradient id="land" x1="100" y1="90" x2="350" y2="270" gradientUnits="userSpaceOnUse">
          <stop stopColor="#e7f4df" />
          <stop offset="1" stopColor="#abcfa8" />
        </linearGradient>
      </defs>
      <ellipse cx="239" cy="230" rx="182" ry="30" fill="#194c3c" opacity=".07" />
      <path d="M33 178 213 87 419 176 242 264Z" fill="#8fb491" />
      <path d="M33 169 213 78 419 167 242 255Z" fill="url(#land)" />
      <path d="m49 176 188-76 17 7-185 79Zm111 45 180-90 19 8-179 91Z" fill="#fff" opacity=".7" />
      <path d="m126 125 225 76 18-9-226-75Z" fill="#fff" opacity=".7" />
      <path d="m190 149 0-81 46-23 0 83Z" fill="#e3eee3" />
      <path d="m236 45 43 22v83l-43-22Z" fill="#9ab8a2" />
      <path d="m190 68 46-23 43 22-45 24Z" fill="#fff" />
      <path
        d="m204 82 18-9v15l-18 9Zm0 28 18-9v15l-18 9Zm42-29 18 9v15l-18-9Zm0 27 18 9v15l-18-9Z"
        fill="#568477"
      />
      <path d="m278 179 0-59 39-20v60Z" fill="#f5f2d7" />
      <path d="m317 100 34 17v60l-34-17Z" fill="#c4c5a3" />
      <path d="m271 122 45-38 43 34-42-14Z" fill="#437e65" />
      <path d="m290 137 15-7v17l-15 7Zm34-4 13 6v18l-13-6Z" fill="#6b9c8c" />
      <path d="m97 175 0-43 37-18v43Z" fill="#faf8e9" />
      <path d="m134 114 39 19v44l-39-20Z" fill="#b7c7ae" />
      <path d="m88 136 44-41 49 40-47-17Z" fill="#3b8065" />
      <path d="m111 144 13-7v16l-13 7Zm35-4 14 7v18l-14-7Z" fill="#6b9c8c" />
      {[
        [80, 177],
        [179, 181],
        [365, 177],
        [285, 215],
        [170, 112],
      ].map(([x, y], i) => (
        <g key={i}>
          <path d={`M${x} ${y}v-25`} stroke="#54765a" strokeWidth="4" />
          <ellipse cx={x} cy={y - 30} rx="13" ry="20" fill={i % 2 ? "#7ca775" : "#4b8c69"} />
          <ellipse cx={x - 4} cy={y - 36} rx="7" ry="12" fill="#93b784" />
        </g>
      ))}
      <circle cx="362" cy="68" r="25" fill="#f2e6b3" opacity=".8" />
      <path
        d="m67 80 8 3 8-3m237-45 8 3 8-3"
        stroke="#82a894"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}

export function Navigator() {
  const query = useQuery(q.navigator),
    qc = useQueryClient();
  const [tab, setTab] = useState<Tab>("home"),
    [modal, setModal] = useState<Modal>(null),
    [toast, setToast] = useState(""),
    [formError, setFormError] = useState("");
  const [search, setSearch] = useState(""),
    [filter, setFilter] = useState("all"),
    [months, setMonths] = useState(12),
    [lost, setLost] = useState(0),
    [extra, setExtra] = useState(0),
    [monthOffset, setMonthOffset] = useState(0),
    [lessonChoice, setLessonChoice] = useState<number | null>(null);
  useEffect(() => {
    const sync = () => qc.invalidateQueries({ queryKey: ["navigator"] });
    window.addEventListener("storage", sync);
    return () => window.removeEventListener("storage", sync);
  }, [qc]);
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const mutate = useMutation({
    mutationFn: api.updateNavigator,
    onSuccess: (state) => {
      qc.setQueryData(["navigator"], state);
      setModal(null);
      setToast("Изменения сохранены");
      setFormError("");
    },
    onError: (e) => setFormError(e.message),
  });
  const reset = useMutation({
    mutationFn: api.resetNavigator,
    onSuccess: (state) => {
      qc.setQueryData(["navigator"], state);
      setModal(null);
      setTab("home");
      setToast("Демо восстановлено");
    },
    onError: (e) => setFormError(e.message),
  });
  const open = (m: Modal) => {
    setFormError("");
    setLessonChoice(null);
    setModal(m);
  };
  const go = (t: Tab) => {
    setTab(t);
    setFormError("");
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const change = (a: NavigatorAction) => mutate.mutate(a);
  if (query.isPending)
    return (
      <div className="navigator">
        <main className="nav-loading">
          <Compass size={38} />
          <h1>Готовим ваш финансовый обзор</h1>
          <Loading />
        </main>
      </div>
    );
  if (query.isError || !query.data)
    return (
      <div className="navigator">
        <main className="nav-loading">
          <h1>Не удалось открыть демо</h1>
          <p role="alert">{query.error?.message}</p>
          <button onClick={() => query.refetch()}>Повторить</button>
          <button
            onClick={() => {
              if (window.confirm("Сбросить сохранённые данные только этого демо?")) reset.mutate();
            }}
          >
            Восстановить демоданные
          </button>
          {formError && <p role="alert">{formError}</p>}
        </main>
      </div>
    );
  const s = query.data,
    m = navMetrics(s);
  const heading = {
    home: "Ваше будущее начинается сегодня",
    goals: "Большие планы. Маленькие шаги.",
    transactions: "Каждая операция на своём месте",
    calendar: "Всё важное — в одном календаре",
    forecast: "А что, если?..",
    quests: "Растите в своём темпе",
    profile: "Ваш план начинается с вас",
  }[tab];
  const subheading = {
    home: "Деньги под контролем. Цели становятся ближе.",
    goals: "Копите на то, что действительно важно для вас.",
    transactions: "Доходы, расходы и переводы между вашими счетами.",
    calendar: "Планируйте платежи и встречайте месяц спокойно.",
    forecast: "Посмотрите, как решения сегодня меняют ваше завтра.",
    quests: "Полезные действия вместо гонки за баллами.",
    profile: "Настройте допущения, чтобы прогноз был ближе к вашей жизни.",
  }[tab];
  const goalCards = (all = false) => (
    <div className="nav-goal-grid">
      {s.goals.slice(0, all ? undefined : 3).map((g) => {
        const Icon = goalIcon(g.kind),
          percent = (g.saved / g.target) * 100;
        return (
          <article className={`nav-goal nav-goal-${g.kind}`} key={g.id}>
            <div className="nav-between">
              <span className="nav-icon">
                <Icon size={22} />
              </span>
              <span className="nav-tag">
                {g.kind === "reserve" ? "Основа спокойствия" : `${Math.round(percent)}% накоплено`}
              </span>
            </div>
            <h3>{g.name}</h3>
            <p className="nav-goal-amount">
              {money(g.saved)} <span>из {compact(g.target)}</span>
            </p>
            <Progress value={percent} label={g.name} />
            <div className="nav-between nav-goal-bottom">
              <span>{money(g.monthly)} / мес.</span>
              <button
                className="nav-text-button"
                onClick={() => open({ type: "transfer", goal: g })}
                disabled={percent >= 100}
              >
                {percent >= 100 ? "Цель достигнута" : "Пополнить"}
              </button>
            </div>
            {all && (
              <p className="nav-small">
                При выбранном плане: ~{goalMonths(s, g)} мес. Диапазон при взносах ±20%:{" "}
                {Math.ceil(goalMonths(s, g) / 1.2)}–{Math.ceil(goalMonths(s, g) / 0.8)} мес.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
  const transactionRows = (rows: NavTransaction[]) =>
    rows.length ? (
      <div className="nav-transaction-list">
        {[...rows]
          .sort((a, b) => b.date.localeCompare(a.date))
          .map((t) => (
            <button
              key={t.id}
              className="nav-transaction"
              onClick={() =>
                t.kind === "transfer"
                  ? open({ type: "delete", entry: t })
                  : open({ type: "transaction", entry: t })
              }
            >
              <span className={`nav-icon ${t.kind === "income" ? "positive" : ""}`}>
                {t.kind === "income" ? (
                  <ArrowDownLeft size={20} />
                ) : t.kind === "transfer" ? (
                  <Target size={20} />
                ) : t.category === "Кафе" ? (
                  <Coffee size={20} />
                ) : (
                  <Wallet size={20} />
                )}
              </span>
              <span className="nav-transaction-name">
                <strong>{t.name}</strong>
                <small>
                  {t.category} ·{" "}
                  {new Date(t.date + "T12:00:00").toLocaleDateString("ru-RU", {
                    day: "numeric",
                    month: "short",
                  })}
                </small>
              </span>
              <strong className={t.kind === "income" ? "nav-positive" : ""}>
                {t.kind === "income" ? "+" : t.kind === "transfer" ? "" : "−"}
                {money(t.amount)}
              </strong>
            </button>
          ))}
      </div>
    ) : (
      <div className="nav-empty">
        <Search />
        <h3>Пока нет операций</h3>
        <p>Измените фильтр или добавьте первую операцию.</p>
      </div>
    );
  const forecast = (detail = false) => {
    const series = projectNavigator(s, months, lost, extra),
      base = projectNavigator(s, months),
      last = series.at(-1)!;
    return (
      <>
        <div className="nav-between">
          <div>
            <p className="nav-small">Капитал через {months} мес.</p>
            <p className="nav-large">{compact(last.median)}</p>
          </div>
          <span className="nav-tag">Без учёта доходности</span>
        </div>
        <Chart
          paletteScope=".navigator"
          height={detail ? 310 : 235}
          label={`Прогноз капитала: ${money(last.low)}–${money(last.high)}`}
          option={(p) => ({
            ...baseAxis(p),
            grid: { left: 2, right: 10, top: 25, bottom: 5, containLabel: true },
            legend: { show: detail, bottom: 0 },
            xAxis: {
              type: "category",
              data: series.map((d) =>
                new Date(2026, 10 + d.month, 27).toLocaleDateString("ru-RU", { month: "short" }),
              ),
              boundaryGap: false,
              axisLine: { show: false },
              axisTick: { show: false },
            },
            yAxis: {
              type: "value",
              axisLabel: { formatter: (v: number) => compact(v) },
              splitLine: { lineStyle: { color: p.border, type: "dashed" } },
            },
            series: [
              {
                name: "Нижняя оценка",
                type: "line",
                data: series.map((d) => d.low),
                lineStyle: { color: p["muted-foreground"], type: "dotted", width: 1 },
                symbol: "none",
              },
              {
                name: "Верхняя оценка",
                type: "line",
                data: series.map((d) => d.high),
                lineStyle: { color: p["muted-foreground"], type: "dotted", width: 1 },
                symbol: "none",
              },
              {
                name: "Базовый план",
                type: "line",
                data: base.map((d) => d.median),
                lineStyle: { color: p["muted-foreground"], type: "dashed" },
                symbol: "none",
              },
              {
                name: "Ваш сценарий",
                type: "line",
                data: series.map((d) => d.median),
                lineStyle: { color: p.primary, width: 3 },
                symbol: "none",
                areaStyle: { color: p.primary, opacity: 0.06 },
              },
            ],
          })}
        />
        <p className="nav-small">
          Диапазон: {money(last.low)}–{money(last.high)}. Расходы ±20%; это анализ чувствительности,
          а не вероятность результата.
        </p>
        <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
      </>
    );
  };
  return (
    <div className="navigator">
      <aside className="nav-sidebar">
        <a href="/navigator" className="nav-brand">
          <span>
            <Compass size={27} />
          </span>
          <div>
            life navigator<small>ВАШ ФИНАНСОВЫЙ МАРШРУТ</small>
          </div>
        </a>
        <p className="nav-sidebar-caption">ЛИЧНОЕ ПРОСТРАНСТВО</p>
        <nav aria-label="Разделы навигатора">
          {tabs.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => go(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={20} />
              {name}
              {id === "quests" && (
                <span className="nav-count">{NAV_QUESTS.length - s.completed.length}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-sidebar-bottom">
          <div className="nav-level">
            <div className="nav-between">
              <Leaf size={21} />
              <span>Уровень {m.level}</span>
              <small>{m.levelXP}/300 XP</small>
            </div>
            <Progress value={m.levelXP / 3} label="Опыт до следующего уровня" />
            <p>Каждый шаг имеет значение</p>
          </div>
          <div className="nav-demo-note">
            <ShieldCheck size={17} />
            <span>Демо · без реальных переводов</span>
          </div>
          <a className="nav-legacy" href="/">
            Основное приложение «Запас»
          </a>
        </div>
      </aside>
      <div className="nav-workspace">
        <header className="nav-topbar">
          <span className="nav-breadcrumb">
            Моё пространство <span>/</span> <strong>{tabs.find((t) => t.id === tab)?.name}</strong>
          </span>
          <div>
            <span className="nav-demo-label">ДЕМО-РЕЖИМ</span>
            <button
              className="nav-avatar"
              onClick={() => go("profile")}
              aria-label="Открыть профиль"
            >
              {s.name.slice(0, 1)}
            </button>
          </div>
        </header>
        <main className="nav-main">
          <div className="nav-page-heading">
            <div>
              <p className="nav-eyebrow">
                {tab === "home"
                  ? `ДОБРЫЙ ДЕНЬ, ${s.name.toUpperCase()}`
                  : "FINANCIAL LIFE NAVIGATOR"}
              </p>
              <h1>{heading}</h1>
              <p>{subheading}</p>
            </div>
            <button className="nav-primary" onClick={() => open({ type: "transaction" })}>
              <Plus size={18} /> Добавить операцию
            </button>
          </div>
          {formError && !modal && (
            <p className="nav-error" role="alert">
              {formError}
            </p>
          )}
          {tab === "home" && (
            <>
              <div className="nav-top-grid">
                <section className="nav-hero">
                  <div className="nav-hero-content">
                    <span className="nav-hero-label">
                      <Leaf size={16} /> ВАШ ФИНАНСОВЫЙ МИР
                    </span>
                    <h2>
                      Строим будущее.
                      <br />В вашем темпе.
                    </h2>
                    <p>
                      Каждое накопление — ещё один
                      <br className="nav-desktop" /> кирпичик в вашу независимость.
                    </p>
                    <button onClick={() => go("goals")}>Посмотреть мои цели</button>
                  </div>
                  <City />
                  <div className="nav-hero-foot">
                    <span className="nav-mini-circle">
                      <Check size={13} />
                    </span>
                    Ваш прогресс сохраняется, даже когда вы отдыхаете
                  </div>
                </section>
                <section className="nav-safe">
                  <div className="nav-between">
                    <span>Свободно сегодня</span>
                    <button
                      aria-label="Как рассчитана свободная сумма"
                      onClick={() => open({ type: "safe" })}
                    >
                      <Info size={19} />
                    </button>
                  </div>
                  <p className="nav-safe-amount">{money(m.daily)}</p>
                  <p>
                    На приятное и повседневное —<br />с учётом ближайших обязательств.
                  </p>
                  <div className="nav-safe-line" />
                  <div className="nav-between">
                    <span>До следующей зарплаты</span>
                    <strong>{s.daysToSalary} дней</strong>
                  </div>
                  <button className="nav-safe-link" onClick={() => open({ type: "safe" })}>
                    Как мы это посчитали?
                  </button>
                </section>
              </div>
              <div className="nav-kpis">
                <button onClick={() => open({ type: "score" })}>
                  <span className="nav-kpi-icon">
                    <ShieldCheck />
                  </span>
                  <span>
                    <small>Финансовая устойчивость</small>
                    <strong>
                      {m.score}
                      <em> / 100</em>
                    </strong>
                    <small>Есть пространство для роста</small>
                  </span>
                  <span
                    className="nav-ring"
                    style={{ background: `conic-gradient(#29966b ${m.score}%, #e8eee9 0)` }}
                  >
                    <span>{m.score}</span>
                  </span>
                </button>
                <button onClick={() => go("profile")}>
                  <span className="nav-kpi-icon">
                    <Wallet />
                  </span>
                  <span>
                    <small>Ваш чистый капитал</small>
                    <strong>{compact(m.capital)}</strong>
                    <small>Счета и накопления · долгов в демо нет</small>
                  </span>
                </button>
                <button onClick={() => go("forecast")}>
                  <span className="nav-kpi-icon warm">
                    <Activity />
                  </span>
                  <span>
                    <small>Запас спокойствия</small>
                    <strong>
                      {m.runway}
                      <em> дней</em>
                    </strong>
                    <small>Резерв на обязательные расходы</small>
                  </span>
                </button>
              </div>
              <div className="nav-section-title">
                <h2>Ближе к вашим целям</h2>
                <button onClick={() => go("goals")}>
                  Все цели <ChevronRight size={16} />
                </button>
              </div>
              {goalCards()}
              {!s.dismissed && (
                <div className="nav-tip">
                  <Sparkles size={22} />
                  <div>
                    <strong>Сначала спокойствие, потом большие планы</strong>
                    <p>Сравните параллельные накопления со стратегией «Сначала резерв».</p>
                  </div>
                  <button onClick={() => open({ type: "strategy" })}>Сравнить стратегии</button>
                  <button
                    aria-label="Скрыть рекомендацию"
                    onClick={() => change({ type: "dismiss" })}
                  >
                    <X size={18} />
                  </button>
                </div>
              )}
              <div className="nav-bottom-grid">
                <Panel
                  title="Взгляд в будущее"
                  action={
                    <button className="nav-text-button" onClick={() => go("forecast")}>
                      Прогноз <ChevronRight size={16} />
                    </button>
                  }
                >
                  {forecast()}
                </Panel>
                <Panel
                  title="Последние операции"
                  action={
                    <button className="nav-text-button" onClick={() => go("transactions")}>
                      Все
                    </button>
                  }
                >
                  {transactionRows(s.transactions.slice(0, 4))}
                  <div className="nav-gentle">
                    <Coffee size={18} />
                    <p>
                      Кофе — часть жизни.
                      <br />
                      <span>План помогает тратить без чувства вины.</span>
                    </p>
                  </div>
                </Panel>
              </div>
            </>
          )}
          {tab === "goals" && (
            <>
              <div className="nav-section-title">
                <p>
                  {s.goals.length} цели · накоплено{" "}
                  {money(s.goals.reduce((a, g) => a + g.saved, 0))}
                </p>
                <div className="nav-actions">
                  <button onClick={() => open({ type: "strategy" })}>Сравнить стратегии</button>
                  <button className="nav-primary" onClick={() => open({ type: "goal" })}>
                    <Plus size={17} /> Новая цель
                  </button>
                </div>
              </div>
              {goalCards(true)}
              <Panel title="Ваш маршрут">
                <p>
                  Стратегия:{" "}
                  <strong>
                    {s.strategy === "parallel" ? "Параллельные накопления" : "Сначала резерв"}
                  </strong>
                  . Суммарный план взносов — {money(s.goals.reduce((a, g) => a + g.monthly, 0))} /
                  мес.
                </p>
                {s.goals.reduce((a, g) => a + g.monthly, 0) > s.income - s.essential && (
                  <p className="nav-warning">
                    План взносов превышает остаток после обязательных расходов. Сроки условны:
                    сократите взносы или пересмотрите доход.
                  </p>
                )}
                <p className="nav-small">
                  Цели — части накопительного счёта. Пополнение перемещает деньги между счетами и не
                  увеличивает общий капитал. Оценка сроков не учитывает инфляцию и доходность.
                </p>
                <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
              </Panel>
            </>
          )}
          {tab === "transactions" && (
            <>
              <div className="nav-kpis compact">
                <Panel>
                  <p>Текущий счёт</p>
                  <h2>{money(m.checking)}</h2>
                </Panel>
                <Panel>
                  <p>Накопительный счёт</p>
                  <h2>{money(m.savings)}</h2>
                </Panel>
                <Panel>
                  <p>Расходы в демо-периоде</p>
                  <h2>{money(m.expenses)}</h2>
                </Panel>
              </div>
              <Panel title="История операций">
                <div className="nav-filters">
                  <label className="nav-search">
                    <Search size={18} />
                    <input
                      placeholder="Найти операцию"
                      aria-label="Найти операцию"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  <select
                    aria-label="Тип операции"
                    value={filter}
                    onChange={(e) => setFilter(e.target.value)}
                  >
                    <option value="all">Все операции</option>
                    <option value="expense">Расходы</option>
                    <option value="income">Доходы</option>
                    <option value="transfer">Переводы в цели</option>
                  </select>
                </div>
                {transactionRows(
                  s.transactions.filter(
                    (t) =>
                      (filter === "all" || t.kind === filter) &&
                      `${t.name} ${t.category}`.toLowerCase().includes(search.toLowerCase()),
                  ),
                )}
              </Panel>
              <Panel title="Расходы по категориям">
                <div className="nav-budget-grid">
                  {["Продукты", "Кафе", "Транспорт", "Дом", "Другое"].map((cat, i) => {
                    const spent = s.transactions
                        .filter((t) => t.kind === "expense" && t.category === cat)
                        .reduce((a, t) => a + t.amount, 0),
                      budget = [80000, 30000, 25000, 180000, 30000][i];
                    return (
                      <div key={cat}>
                        <div className="nav-between">
                          <strong>{cat}</strong>
                          <span className={spent > budget ? "nav-danger" : ""}>
                            {money(spent)} / {compact(budget)}
                          </span>
                        </div>
                        <Progress value={(spent / budget) * 100} label={`Бюджет ${cat}`} />
                        {spent > budget && (
                          <p className="nav-small nav-danger">
                            Выше демонстрационного лимита на {money(spent - budget)}
                          </p>
                        )}
                      </div>
                    );
                  })}
                </div>
                <p className="nav-small">
                  Демонстрационные месячные лимиты. История содержит операции за 24–27 ноября.
                </p>
              </Panel>
            </>
          )}
          {tab === "calendar" && (
            <Cashflow state={s} offset={monthOffset} onOffset={setMonthOffset} />
          )}
          {tab === "forecast" && (
            <>
              <div className="nav-simulation">
                <Panel title="Соберите свой сценарий">
                  <label className="nav-field">
                    Горизонт прогноза
                    <select value={months} onChange={(e) => setMonths(+e.target.value)}>
                      <option value={6}>6 месяцев</option>
                      <option value={12}>12 месяцев</option>
                      <option value={24}>24 месяца</option>
                    </select>
                  </label>
                  <label className="nav-field">
                    Без дохода: {lost} мес.
                    <input
                      type="range"
                      min="0"
                      max="6"
                      value={lost}
                      onChange={(e) => setLost(+e.target.value)}
                    />
                  </label>
                  <label className="nav-field">
                    Дополнительные расходы: {money(extra)} / мес.
                    <input
                      type="range"
                      min="0"
                      max="300000"
                      step="10000"
                      value={extra}
                      onChange={(e) => setExtra(+e.target.value)}
                    />
                  </label>
                  <button
                    className="nav-secondary"
                    onClick={() => {
                      setLost(3);
                      setExtra(0);
                    }}
                  >
                    Стресс-тест: 3 месяца без дохода
                  </button>
                  <button
                    className="nav-text-button"
                    onClick={() => {
                      setLost(0);
                      setExtra(0);
                    }}
                  >
                    Вернуть базовый сценарий
                  </button>
                  <div className="nav-gentle">
                    <ShieldCheck size={22} />
                    <p>
                      Резерва хватит на{" "}
                      <strong>{Math.floor((m.reserve / (s.essential + extra)) * 30)} дней</strong>.
                    </p>
                  </div>
                  <p className="nav-small">
                    В резерв входят только средства цели «Подушка спокойствия». Остальные цели не
                    считаются доступным резервом.
                  </p>
                </Panel>
                <Panel title="Возможная траектория капитала">{forecast(true)}</Panel>
              </div>
              <Panel title="Что лежит в основе прогноза">
                <p>
                  Начальный капитал {money(m.capital)} + доход {money(s.income)} / мес. −
                  обязательные расходы {money(s.essential)} / мес. − дополнительные расходы. Потеря
                  дохода применяется к первым {lost} месяцам.
                </p>
                <p className="nav-small">
                  Взносы в цели не вычитаются из капитала: это внутреннее распределение денег.
                  Налоги, инфляция, проценты и непредвиденные расходы не моделируются. Это
                  демонстрационный расчёт.
                </p>
              </Panel>
            </>
          )}
          {tab === "quests" && (
            <>
              <section className="nav-progress-hero">
                <Leaf size={40} />
                <div>
                  <p>ВАШ ФИНАНСОВЫЙ ОПЫТ</p>
                  <h2>Уровень {m.level} · уверенный старт</h2>
                  <p>{m.levelXP} из 300 XP до следующего уровня</p>
                  <Progress value={m.levelXP / 3} label="Ваш опыт" />
                </div>
                <span>
                  Без стриков.
                  <br />
                  Без штрафов.
                  <br />В своём темпе.
                </span>
              </section>
              <div className="nav-quest-grid">
                {NAV_QUESTS.map((quest) => (
                  <Panel key={quest.id}>
                    <div className="nav-between">
                      <span className="nav-icon">
                        {s.completed.includes(quest.id) ? <CheckCheck /> : <BookOpen />}
                      </span>
                      <span className="nav-tag">+{quest.xp} XP</span>
                    </div>
                    <h2>{quest.title}</h2>
                    <p>{quest.text}</p>
                    <button
                      disabled={s.completed.includes(quest.id) || mutate.isPending}
                      className={s.completed.includes(quest.id) ? "nav-secondary" : "nav-primary"}
                      onClick={() =>
                        quest.id === "lesson"
                          ? open({ type: "lesson" })
                          : change({ type: "quest", id: quest.id })
                      }
                    >
                      {s.completed.includes(quest.id)
                        ? "Выполнено"
                        : quest.id === "lesson"
                          ? "Пройти урок"
                          : "Отметить выполнение"}
                    </button>
                  </Panel>
                ))}
              </div>
              <Panel title="Ваши навыки">
                <div className="nav-skills">
                  {[
                    "Планирование",
                    "Осознанные расходы",
                    "Финансовый резерв",
                    "Финансовые знания",
                  ].map((name, i) => (
                    <div key={name}>
                      <span
                        className={`nav-icon ${s.completed.includes(NAV_QUESTS[i].id) ? "positive" : ""}`}
                      >
                        {s.completed.includes(NAV_QUESTS[i].id) ? <Check /> : <Leaf />}
                      </span>
                      <strong>{name}</strong>
                      <small>
                        {s.completed.includes(NAV_QUESTS[i].id)
                          ? "Первый шаг пройден"
                          : "Первый шаг впереди"}
                      </small>
                    </div>
                  ))}
                </div>
                <p className="nav-small">
                  XP начисляется один раз за задание. Отметки не создают доход и не подтверждают
                  отмену подписок в банке.
                </p>
              </Panel>
            </>
          )}
          {tab === "profile" && (
            <>
              <div className="nav-profile-grid">
                <Panel title="Параметры вашего плана">
                  <form
                    className="nav-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      const f = new FormData(e.currentTarget);
                      change({
                        type: "settings",
                        name: String(f.get("name")),
                        income: Number(f.get("income")),
                        essential: Number(f.get("essential")),
                        hours: Number(f.get("hours")),
                      });
                    }}
                  >
                    <Field
                      name="name"
                      label="Как к вам обращаться"
                      defaultValue={s.name}
                      type="text"
                    />
                    <Field name="income" label="Чистый доход в месяц, ₸" defaultValue={s.income} />
                    <Field
                      name="essential"
                      label="Обязательные расходы в месяц, ₸"
                      defaultValue={s.essential}
                    />
                    <Field name="hours" label="Рабочие часы в месяц" defaultValue={s.hours} />
                    <button className="nav-primary" disabled={mutate.isPending}>
                      Сохранить параметры
                    </button>
                  </form>
                </Panel>
                <div>
                  <Panel title="Деньги — это ваше время">
                    <span className="nav-icon">
                      <Activity />
                    </span>
                    <p className="nav-large">
                      {money(s.income / s.hours)} <span className="nav-small">/ час</span>
                    </p>
                    <p>Стоимость часа = чистый месячный доход ÷ рабочие часы.</p>
                    <p className="nav-small">
                      Покупка за 10 000 ₸ — примерно {(10000 / (s.income / s.hours)).toFixed(1)} ч.
                      работы. Это способ сравнения, а не оценка ваших решений.
                    </p>
                  </Panel>
                  <Panel title="Ваши счета">
                    <div className="nav-account">
                      <span>Текущий счёт</span>
                      <strong>{money(m.checking)}</strong>
                    </div>
                    <div className="nav-account">
                      <span>Накопления, включая все цели</span>
                      <strong>{money(m.savings)}</strong>
                    </div>
                    <div className="nav-account">
                      <span>Чистый капитал</span>
                      <strong>{money(m.capital)}</strong>
                    </div>
                  </Panel>
                </div>
              </div>
              <Panel title="Демонстрационные данные">
                <p>
                  Изменения сохраняются в этом браузере. Прототип не подключён к банкам, не
                  выполняет платежи и не использует данные основного приложения.
                </p>
                <p className="nav-small">
                  Дата модели зафиксирована: 27 ноября 2026. Сброс затронет только Financial Life
                  Navigator.
                </p>
                <button className="nav-secondary" onClick={() => open({ type: "reset" })}>
                  Восстановить исходное демо
                </button>
              </Panel>
            </>
          )}
          <footer className="nav-footer">
            <span>
              <Compass size={15} /> Financial Life Navigator
            </span>
            <span>Демо на 27 ноября 2026 · Валюта KZT</span>
            <span>Маленькие шаги. Большое будущее.</span>
          </footer>
        </main>
      </div>
      <nav className="nav-mobile" aria-label="Мобильная навигация">
        {tabs.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => go(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {toast && (
        <div className="nav-toast" role="status">
          <Check size={18} />
          {toast}
        </div>
      )}
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent className="navigator nav-dialog">
          <DialogHeader>
            <DialogTitle>
              {modal?.type === "transaction"
                ? modal.entry
                  ? "Изменить операцию"
                  : "Новая операция"
                : modal?.type === "transfer"
                  ? `Пополнить: ${modal.goal.name}`
                  : modal?.type === "goal"
                    ? "Новая финансовая цель"
                    : modal?.type === "strategy"
                      ? "Выберите маршрут к целям"
                      : modal?.type === "safe"
                        ? "Свободно сегодня — как это работает"
                        : modal?.type === "score"
                          ? "Из чего складывается устойчивость"
                          : modal?.type === "lesson"
                            ? "Коротко о финансовой подушке"
                            : modal?.type === "delete"
                              ? "Отменить операцию?"
                              : "Восстановить демо?"}
            </DialogTitle>
            <DialogDescription>Демонстрация · реальные деньги не перемещаются</DialogDescription>
          </DialogHeader>
          {modal?.type === "transaction" && (
            <form
              className="nav-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                change({
                  type: "transaction",
                  id: modal.entry?.id,
                  entry: {
                    name: String(f.get("name")),
                    amount: Number(f.get("amount")),
                    kind: String(f.get("kind")) as "income" | "expense",
                    date: String(f.get("date")),
                    category: String(f.get("category")),
                  },
                });
              }}
            >
              <label className="nav-field">
                Тип
                <select name="kind" defaultValue={modal.entry?.kind ?? "expense"}>
                  <option value="expense">Расход</option>
                  <option value="income">Доход</option>
                </select>
              </label>
              <Field
                name="name"
                label="Название"
                type="text"
                defaultValue={modal.entry?.name}
                placeholder="Например, продукты"
              />
              <Field name="amount" label="Сумма, ₸" defaultValue={modal.entry?.amount} />
              <label className="nav-field">
                Категория
                <select name="category" defaultValue={modal.entry?.category ?? "Продукты"}>
                  {["Продукты", "Кафе", "Транспорт", "Дом", "Другое", "Доход"].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </select>
              </label>
              <label className="nav-field">
                Дата
                <input
                  name="date"
                  type="date"
                  required
                  max={DEMO_DATE}
                  defaultValue={modal.entry?.date ?? DEMO_DATE}
                />
              </label>
              <p className="nav-small">
                Доступно на текущем счёте: {money(m.checking)}. Расход уменьшает баланс счёта;
                накопленные цели сохраняются.
              </p>
              <div className="nav-actions">
                <button className="nav-primary" disabled={mutate.isPending}>
                  Сохранить
                </button>
                {modal.entry && (
                  <button
                    type="button"
                    className="nav-danger nav-secondary"
                    onClick={() => open({ type: "delete", entry: modal.entry! })}
                  >
                    <Trash2 size={16} /> Удалить
                  </button>
                )}
              </div>
            </form>
          )}
          {modal?.type === "transfer" && (
            <form
              className="nav-form"
              onSubmit={(e) => {
                e.preventDefault();
                change({
                  type: "transfer",
                  goalId: modal.goal.id,
                  amount: Number(new FormData(e.currentTarget).get("amount")),
                });
              }}
            >
              <p>
                С текущего счёта на накопительный. Доступно: <strong>{money(m.checking)}</strong>.
              </p>
              <Field
                name="amount"
                label="Сумма пополнения, ₸"
                defaultValue={Math.min(10000, m.checking, modal.goal.target - modal.goal.saved)}
              />
              <p className="nav-small">
                До цели осталось {money(modal.goal.target - modal.goal.saved)}. Капитал не
                изменится, свободная сумма уменьшится.
              </p>
              <button className="nav-primary" disabled={mutate.isPending}>
                Подтвердить демоперевод
              </button>
            </form>
          )}
          {modal?.type === "goal" && (
            <form
              className="nav-form"
              onSubmit={(e) => {
                e.preventDefault();
                const f = new FormData(e.currentTarget);
                change({
                  type: "goal",
                  name: String(f.get("name")),
                  target: Number(f.get("target")),
                  monthly: Number(f.get("monthly")),
                });
              }}
            >
              <Field
                name="name"
                label="На что копим?"
                type="text"
                placeholder="Например, путешествие"
              />
              <Field name="target" label="Нужная сумма, ₸" />
              <Field name="monthly" label="План взноса в месяц, ₸" defaultValue={30000} />
              <button className="nav-primary" disabled={mutate.isPending}>
                Создать цель
              </button>
            </form>
          )}
          {modal?.type === "safe" && (
            <>
              <div className="nav-formula">
                <div>
                  <span>На текущем счёте</span>
                  <strong>{money(m.checking)}</strong>
                </div>
                <div>
                  <span>Ближайшие обязательства</span>
                  <strong>−{money(s.committed)}</strong>
                </div>
                <div>
                  <span>Осталось до зарплаты</span>
                  <strong>{s.daysToSalary} дней</strong>
                </div>
                <div>
                  <span>Свободно на день</span>
                  <strong>{money(m.daily)}</strong>
                </div>
              </div>
              <p className="nav-small">
                max(0, текущий счёт − обязательства) ÷ дни до зарплаты. Цели и резерв уже находятся
                на отдельном накопительном счёте, поэтому повторно не вычитаются. Будущие
                добровольные взносы здесь не зарезервированы. Обязательства и дата зарплаты
                зафиксированы для демо.
              </p>
            </>
          )}
          {modal?.type === "score" && (
            <>
              <p className="nav-large">{m.score} / 100</p>
              <p>
                Резерв: до 60 баллов за покрытие 90 дней расходов. Положительный остаток дохода: до
                25 баллов. Покрытие ближайших платежей текущим счётом: 15 баллов.
              </p>
              <p className="nav-small">
                Это объяснимая демонстрационная шкала, не кредитный рейтинг и не валидированная
                финансовая оценка. XP в расчёт не входит.
              </p>
              <button
                className="nav-primary"
                onClick={() => {
                  setModal(null);
                  go("goals");
                }}
              >
                Перейти к резерву
              </button>
            </>
          )}
          {modal?.type === "strategy" && (
            <>
              <p>
                Общий план взносов: {money(s.goals.reduce((a, g) => a + g.monthly, 0))} / мес.
                Сравнение без инфляции и доходности.
              </p>
              <div className="nav-strategies">
                {(["parallel", "reserve"] as const).map((strategy) => (
                  <div key={strategy}>
                    <h3>{strategy === "parallel" ? "Параллельно" : "Сначала резерв"}</h3>
                    <p>
                      {strategy === "parallel"
                        ? "Все цели получают свой ежемесячный взнос."
                        : "Все взносы идут в резерв до его заполнения; затем цели получают обычный взнос. Остаток остаётся свободным."}
                    </p>
                    {s.goals.slice(0, 3).map((g) => (
                      <p key={g.id} className="nav-small">
                        {g.name}: ~{goalMonths({ ...s, strategy }, g)} мес.
                      </p>
                    ))}
                    <button
                      className={s.strategy === strategy ? "nav-secondary" : "nav-primary"}
                      disabled={mutate.isPending || s.strategy === strategy}
                      onClick={() => change({ type: "strategy", value: strategy })}
                    >
                      {s.strategy === strategy ? "Текущий план" : "Выбрать"}
                    </button>
                  </div>
                ))}
              </div>
              <p className="nav-small">
                При изменении взносов на ±20% сроки составят примерно от 0,83 до 1,25 указанного
                срока. Стратегия меняет план, но не переводит деньги автоматически.
              </p>
              <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
            </>
          )}
          {modal?.type === "lesson" && (
            <>
              <p>
                Резерв помогает покрывать обязательные расходы, когда доход прерывается. Его полезно
                хранить отдельно от повседневного счёта и иметь возможность быстро использовать.
              </p>
              <h3>Какие средства подходят для резерва лучше?</h3>
              {[
                "Деньги на доступном накопительном счёте",
                "Вся стоимость квартиры",
                "Ожидаемая премия в следующем году",
              ].map((answer, i) => (
                <button
                  key={answer}
                  className={`nav-answer ${lessonChoice === i ? "selected" : ""}`}
                  onClick={() => setLessonChoice(i)}
                >
                  {answer}
                </button>
              ))}
              {lessonChoice !== null && (
                <p role="status">
                  {lessonChoice === 0
                    ? "Верно: резерв должен быть доступен, когда он понадобится."
                    : "Попробуйте ещё: продать квартиру или дождаться премии быстро может не получиться."}
                </p>
              )}
              <button
                className="nav-primary"
                disabled={lessonChoice !== 0 || mutate.isPending}
                onClick={() => change({ type: "quest", id: "lesson" })}
              >
                Завершить урок · +15 XP
              </button>
            </>
          )}
          {modal?.type === "delete" && (
            <>
              <p>
                «{modal.entry.name}» — {money(modal.entry.amount)}. Балансы будут пересчитаны. Для
                перевода деньги вернутся из цели на текущий счёт.
              </p>
              <button
                className="nav-primary"
                disabled={mutate.isPending}
                onClick={() => change({ type: "delete", id: modal.entry.id })}
              >
                Подтвердить отмену
              </button>
            </>
          )}
          {modal?.type === "reset" && (
            <>
              <p>
                Ваши добавленные операции, цели, параметры и XP этого демо будут заменены исходным
                примером Алии.
              </p>
              <button
                className="nav-primary"
                disabled={reset.isPending}
                onClick={() => reset.mutate()}
              >
                Сбросить только это демо
              </button>
            </>
          )}
          {formError && (
            <p className="nav-error" role="alert">
              {formError}
            </p>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
function Field({
  label,
  name,
  type = "number",
  defaultValue,
  placeholder,
}: {
  label: string;
  name: string;
  type?: string;
  defaultValue?: string | number;
  placeholder?: string;
}) {
  return (
    <label className="nav-field">
      {label}
      <input
        name={name}
        type={type}
        defaultValue={defaultValue}
        placeholder={placeholder}
        required
        min={type === "number" ? 1 : undefined}
        step={type === "number" ? 1 : undefined}
        maxLength={type === "text" ? 80 : undefined}
      />
    </label>
  );
}
function Cashflow({
  state: s,
  offset,
  onOffset,
}: {
  state: NavigatorState;
  offset: number;
  onOffset: (n: number) => void;
}) {
  const date = new Date(2026, 11 + offset, 1),
    year = date.getFullYear(),
    month = date.getMonth(),
    days = new Date(year, month + 1, 0).getDate(),
    first = (date.getDay() + 6) % 7;
  const events = [
    { day: 5, name: "Аренда", amount: -145000 },
    { day: 10, name: "Коммунальные услуги", amount: -32900 },
    { day: 25, name: "Зарплата", amount: s.income },
  ];
  let balance = navMetrics(s).checking;
  const rows = Array.from({ length: days }, (_, i) => {
    const day = i + 1,
      event = events.find((e) => e.day === day);
    balance += event?.amount ?? 0;
    return { day, event, balance };
  });
  return (
    <>
      <Panel
        title={date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
        action={
          <div className="nav-actions">
            <button
              aria-label="Предыдущий месяц"
              disabled={offset <= 0}
              onClick={() => onOffset(offset - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              aria-label="Следующий месяц"
              disabled={offset >= 11}
              onClick={() => onOffset(offset + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        }
      >
        <p className="nav-small">
          Демонстрационный план. Каждый месяц рассчитывается отдельно от текущего баланса;
          повседневные расходы не включены.
        </p>
        <div className="nav-calendar">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <strong key={d}>{d}</strong>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <span key={`blank${i}`} />
          ))}
          {rows.map((r) => (
            <div
              key={r.day}
              className={`${r.event ? "has-event" : ""} ${r.balance < 0 ? "risk-day" : ""}`}
            >
              <span>{r.day}</span>
              {r.event && (
                <>
                  <small>{r.event.name}</small>
                  <b className={r.event.amount > 0 ? "nav-positive" : ""}>
                    {r.event.amount > 0 ? "+" : ""}
                    {compact(r.event.amount)}
                  </b>
                </>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Ближайшие события">
        {rows
          .filter((r) => r.event)
          .map((r) => (
            <div key={r.day} className="nav-event">
              <span className="nav-icon">{r.day}</span>
              <div>
                <strong>{r.event!.name}</strong>
                <p className="nav-small">Остаток после платежа: {money(r.balance)}</p>
              </div>
              <strong className={r.event!.amount > 0 ? "nav-positive" : ""}>
                {money(r.event!.amount)}
              </strong>
            </div>
          ))}
        <p className={rows.some((r) => r.balance < 0) ? "nav-warning" : "nav-small"}>
          {rows.some((r) => r.balance < 0)
            ? "При таком плане возникает кассовый разрыв. Проверьте даты платежей и доступный остаток."
            : "По перечисленным событиям отрицательного остатка нет. Повседневные расходы могут изменить результат."}
        </p>
        <p className="nav-small">
          Диапазон доступного остатка: от расчётного остатка минус {money(s.essential * 0.2)} до
          расчётного остатка; учитывает возможные дополнительные расходы до 20% месячных
          обязательств.
        </p>
        <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
      </Panel>
    </>
  );
}
