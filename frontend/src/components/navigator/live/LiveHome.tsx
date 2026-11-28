import { useQuery } from "@tanstack/react-query";
import { Activity, ShieldCheck, Wallet } from "lucide-react";
import { q } from "@/api/client";
import { EstimateNote } from "@/components/kit";
import { bankName, ru } from "@/i18n/ru";
import { formatDate, formatPercent } from "@/lib/format";
import { accountNow, formatDay } from "@/lib/navigator-live";
import { addDays } from "@/lib/safe-to-spend";
import { money, moneyIn } from "../model";
import { Panel } from "../shared";
import { KztHint, Missing, Preliminary } from "./common";
import { InsightsPanel, MonthEndPanel } from "./LiveInsights";
import { IncomeSplitPanel, SetAsidePanel, SpendingLimit } from "./MoneyPlan";
import { TxList } from "./LiveTransactions";
import type { LiveProps } from "./types";

const t = ru.live.home;

export function LiveHome(props: LiveProps) {
  const { snap, go, today, obligations } = props;
  const recent = useQuery(q.transactionsFor({ from: addDays(today, -60), to: today }));
  const hasOps = (recent.data?.length ?? 0) > 0;
  const resilience = useQuery({ ...q.resilience, enabled: hasOps && snap.usable.length > 0 });
  const credits = obligations.filter(
    (o) => !o.rejected && (o.kind === "credit" || o.kind === "installment"),
  );
  return (
    <>
      <div className="nav-top-grid">
        <SpendingLimit {...props} />
        <Panel title={t.capitalTitle}>
          {snap.usable.length ? (
            <>
              {snap.usable.map((a) => (
                <div className="nav-account" key={a.id}>
                  <span>
                    {bankName(a.bank)} · {a.name}{" "}
                    <small className="nav-small">({ru.accountKind[a.kind!]})</small>
                  </span>
                  <strong>
                    {moneyIn(accountNow(a), a.currency)}
                    <br />
                    <KztHint a={a} />
                  </strong>
                </div>
              ))}
              <div className="nav-account">
                <span>
                  Итого <small className="nav-small">{ru.fx.inTenge}</small>
                </span>
                <strong>{money(snap.total ?? 0)}</strong>
              </div>
              {snap.frozen > 0 && (
                <>
                  <div className="nav-account">
                    <span>{ru.dep.available}</span>
                    <strong>{money((snap.total ?? 0) - snap.frozen)}</strong>
                  </div>
                  <div className="nav-account">
                    <span>{ru.dep.frozen}</span>
                    <strong>
                      {ru.dep.frozenUntil(
                        money(snap.frozen),
                        formatDate(snap.unlocks[0].date, true),
                      )}
                    </strong>
                  </div>
                  <p className="nav-small">{ru.dep.capitalHint}</p>
                </>
              )}
            </>
          ) : (
            <Missing action={t.noAccountsAction} onAction={() => go("profile")}>
              {t.noAccounts}
            </Missing>
          )}
          {snap.needsAttention.length > 0 && (
            <p className="nav-small">
              Ждут подтверждения: {snap.needsAttention.map((a) => bankName(a.bank)).join(", ")}.
            </p>
          )}
          {credits.length > 0 && <p className="nav-small">{t.debtUnknown}</p>}
        </Panel>
      </div>
      <IncomeSplitPanel notify={props.notify} />
      <SetAsidePanel go={go} />
      <div className="nav-kpis">
        <button onClick={() => go("profile")}>
          <span className="nav-kpi-icon">
            <ShieldCheck />
          </span>
          <span>
            <small>{t.scoreTitle}</small>
            {resilience.data ? (
              <>
                <strong>
                  {resilience.data.score}
                  <em> / 100</em>
                </strong>
                <small>{t.scoreShortfall(formatPercent(resilience.data.pShortfall))}</small>
              </>
            ) : (
              <small>{resilience.isFetching ? ru.common.loading : t.scoreEmpty}</small>
            )}
          </span>
        </button>
        <button onClick={() => go("profile")}>
          <span className="nav-kpi-icon warm">
            <Activity />
          </span>
          <span>
            <small>
              {t.reserveTitle} <Preliminary />
            </small>
            {snap.reserveDays !== null ? (
              <>
                <strong>{t.reserveDays(snap.reserveDays)}</strong>
                {snap.reserveDaysWithEarly !== null && (
                  <small>{ru.dep.early(t.reserveDays(snap.reserveDaysWithEarly))}</small>
                )}
              </>
            ) : (
              <small>{snap.savings === null ? t.reserveNoSavings : t.reserveNoExpenses}</small>
            )}
          </span>
        </button>
        <button onClick={() => go("transactions")}>
          <span className="nav-kpi-icon">
            <Wallet />
          </span>
          <span>
            <small>{t.recent}</small>
            <strong>{recent.data?.length ?? "…"}</strong>
            <small>за 60 дней</small>
          </span>
        </button>
      </div>
      {resilience.data && (
        <EstimateNote asOf={resilience.data.as_of} model={resilience.data.model_version} />
      )}
      <div className="nav-profile-grid">
        <MonthEndPanel />
        <InsightsPanel go={go} />
      </div>
      <Panel
        title={t.recent}
        action={
          <button className="nav-text-button" onClick={() => go("transactions")}>
            {ru.common.all}
          </button>
        }
      >
        {recent.isPending ? (
          <p className="nav-small">{ru.common.loading}</p>
        ) : hasOps ? (
          <TxList rows={recent.data!.slice(0, 6)} accounts={props.accounts} />
        ) : (
          <Missing action={t.importAction} onAction={() => go("transactions")}>
            {t.noOperations}
          </Missing>
        )}
      </Panel>
    </>
  );
}
