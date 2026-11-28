import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Compass, Leaf, Plus, ShieldCheck } from "lucide-react";
import { api, q } from "@/api/client";
import { Loading } from "@/components/kit";
import { NAV_QUESTS, navMetrics, type NavigatorAction } from "@/lib/navigator";
import { NavigatorDialog } from "./NavigatorDialog";
import { Progress } from "./shared";
import { tabs, type Modal, type Tab } from "./model";
import { CalendarTab } from "./tabs/CalendarTab";
import { ForecastTab } from "./tabs/ForecastTab";
import { GoalsTab } from "./tabs/GoalsTab";
import { HomeTab } from "./tabs/HomeTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { QuestsTab } from "./tabs/QuestsTab";
import { TransactionsTab } from "./tabs/TransactionsTab";
import "./navigator.css";

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
  const props = { s, m, open, go, change, pending: mutate.isPending };
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
          {tab === "home" && <HomeTab {...props} months={months} lost={lost} extra={extra} />}
          {tab === "goals" && <GoalsTab {...props} />}
          {tab === "transactions" && (
            <TransactionsTab
              {...props}
              search={search}
              setSearch={setSearch}
              filter={filter}
              setFilter={setFilter}
            />
          )}
          {tab === "calendar" && (
            <CalendarTab state={s} offset={monthOffset} onOffset={setMonthOffset} />
          )}
          {tab === "forecast" && (
            <ForecastTab
              {...props}
              months={months}
              setMonths={setMonths}
              lost={lost}
              setLost={setLost}
              extra={extra}
              setExtra={setExtra}
            />
          )}
          {tab === "quests" && <QuestsTab {...props} />}
          {tab === "profile" && <ProfileTab {...props} />}
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
      <NavigatorDialog
        {...props}
        modal={modal}
        setModal={setModal}
        formError={formError}
        lessonChoice={lessonChoice}
        setLessonChoice={setLessonChoice}
        onReset={() => reset.mutate()}
        resetPending={reset.isPending}
      />
    </div>
  );
}
