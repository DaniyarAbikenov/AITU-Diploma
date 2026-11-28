import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, Compass, Leaf, Plus } from "lucide-react";
import { ru } from "@/i18n/ru";
import { api, q } from "@/api/client";
import { Loading } from "@/components/kit";
import { NAV_QUESTS, navMetrics, type NavigatorAction } from "@/lib/navigator";
import { NavigatorDialog } from "./NavigatorDialog";
import { NavigatorFrame, type NavMode } from "./NavigatorFrame";
import { Progress } from "./shared";
import type { Modal, Tab } from "./model";
import { CalendarTab } from "./tabs/CalendarTab";
import { ForecastTab } from "./tabs/ForecastTab";
import { GoalsTab } from "./tabs/GoalsTab";
import { HomeTab } from "./tabs/HomeTab";
import { ProfileTab } from "./tabs/ProfileTab";
import { QuestsTab } from "./tabs/QuestsTab";
import { TransactionsTab } from "./tabs/TransactionsTab";
import "./navigator.css";

/** Demo mode: the fictional user from localStorage on a fixed date. Never mixed with real data. */
export function DemoNavigator({ onMode }: { onMode: (m: NavMode) => void }) {
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
  return (
    <NavigatorFrame
      mode="demo"
      onMode={onMode}
      tab={tab}
      go={go}
      name={s.name}
      questCount={NAV_QUESTS.length - s.completed.length}
      sidebarExtra={
        <div className="nav-level">
          <div className="nav-between">
            <Leaf size={21} />
            <span>Уровень {m.level}</span>
            <small>{m.levelXP}/300 XP</small>
          </div>
          <Progress value={m.levelXP / 3} label="Опыт до следующего уровня" />
          <p>Каждый шаг имеет значение</p>
        </div>
      }
      action={
        <button className="nav-primary" onClick={() => open({ type: "transaction" })}>
          <Plus size={18} /> Добавить операцию
        </button>
      }
      error={
        formError &&
        !modal && (
          <p className="nav-error" role="alert">
            {formError}
          </p>
        )
      }
      footer={ru.footer.demo}
      overlay={
        <>
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
        </>
      }
    >
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
    </NavigatorFrame>
  );
}
