import { useEffect, useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { Check, LogIn, Plus } from "lucide-react";
import { API_MODE, q } from "@/api/client";
import { Loading } from "@/components/kit";
import { ru } from "@/i18n/ru";
import { formatDay, liveSnapshot } from "@/lib/navigator-live";
import { todayIn } from "@/lib/safe-to-spend";
import { NavigatorFrame, type NavMode } from "../NavigatorFrame";
import type { Tab } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { LiveCalendar } from "./LiveCalendar";
import { LiveForecast } from "./LiveForecast";
import { LiveGoals } from "./LiveGoals";
import { LiveHome } from "./LiveHome";
import { LiveProfile } from "./LiveProfile";
import { LiveTransactions } from "./LiveTransactions";
import { TxDialog } from "./forms";
import type { LiveGoal, LiveProps } from "./types";

/** Working mode: the signed-in user's data from /api/v1, "today" in the user's time zone (BR-06). */
export function LiveNavigator({
  onMode,
  signedIn,
}: {
  onMode: (m: NavMode) => void;
  signedIn: boolean;
}) {
  const [tab, setTab] = useState<Tab>("home"),
    [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(""), 4500);
    return () => clearTimeout(timer);
  }, [toast]);
  const go = (t: Tab) => {
    setTab(t);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };
  const on = { enabled: signedIn, retry: false } as const;
  const meQ = useQuery({ ...q.me, ...on }),
    accQ = useQuery({ ...q.accounts, ...on }),
    obQ = useQuery({ ...q.obligations, ...on }),
    incQ = useQuery({ ...q.income, ...on }),
    goalQ = useQuery({ ...q.goals, ...on }),
    planQ = useQuery({ ...q.planned, ...on });
  const results = [meQ, accQ, obQ, incQ, goalQ, planQ];
  const [txOpen, setTxOpen] = useState(false);
  const frame = (name: string, footer: string, body: ReactNode, action?: ReactNode) => (
    <NavigatorFrame
      action={action}
      mode="live"
      onMode={onMode}
      tab={tab}
      go={go}
      name={name}
      footer={footer}
      error={API_MODE === "mock" ? <p className="nav-warning">{ru.mode.mockWarning}</p> : undefined}
      overlay={
        toast && (
          <div className="nav-toast" role="status">
            <Check size={18} />
            {toast}
          </div>
        )
      }
    >
      {body}
    </NavigatorFrame>
  );
  if (!signedIn)
    return frame(
      "",
      ru.footer.live("—"),
      <Panel title={ru.auth.title}>
        <p>{ru.auth.text}</p>
        <div className="nav-actions">
          <a className="nav-primary" href="/login?next=/navigator">
            <LogIn size={17} /> {ru.auth.login}
          </a>
          <button className="nav-secondary" onClick={() => onMode("demo")}>
            {ru.auth.backToDemo}
          </button>
        </div>
      </Panel>,
    );
  if (results.some((r) => r.isPending))
    return frame(
      "",
      ru.footer.live("…"),
      <Panel title={ru.common.loading}>
        <Loading />
      </Panel>,
    );
  const failed = results.find((r) => r.isError);
  if (failed || !meQ.data)
    return frame(
      "",
      ru.footer.live("—"),
      <Panel title={ru.common.loadError}>
        <p role="alert">{failed?.error?.message}</p>
        <button className="nav-secondary" onClick={() => results.forEach((r) => r.refetch())}>
          {ru.common.retry}
        </button>
      </Panel>,
    );
  const me = meQ.data,
    accounts = accQ.data ?? [],
    obligations = obQ.data ?? [],
    incomes = incQ.data ?? [],
    goals: LiveGoal[] = goalQ.data ?? [],
    planned = planQ.data ?? [];
  const today = todayIn(me.timezone || "Asia/Almaty");
  const snap = liveSnapshot({ today, me, accounts, obligations, incomes, planned });
  const props: LiveProps = {
    me,
    accounts,
    obligations,
    incomes,
    goals,
    planned,
    today,
    snap,
    go,
    notify: setToast,
  };
  return frame(
    me.name,
    ru.footer.live(formatDay(today)),
    <>
      {tab === "home" && <LiveHome {...props} />}
      {tab === "goals" && <LiveGoals {...props} />}
      {tab === "transactions" && <LiveTransactions {...props} />}
      {tab === "calendar" && <LiveCalendar {...props} />}
      {tab === "forecast" && <LiveForecast {...props} />}
      {tab === "quests" && (
        <Panel>
          <Missing>{ru.live.quests.empty}</Missing>
        </Panel>
      )}
      {tab === "profile" && <LiveProfile {...props} />}
      <TxDialog
        tx={null}
        open={txOpen}
        accounts={accounts}
        today={today}
        onClose={() => setTxOpen(false)}
        notify={setToast}
      />
    </>,
    <button className="nav-primary" onClick={() => setTxOpen(true)}>
      <Plus size={18} /> {ru.crud.tx.add}
    </button>,
  );
}
