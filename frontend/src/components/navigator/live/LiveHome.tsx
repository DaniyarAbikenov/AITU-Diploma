import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Info, ShieldCheck, Wallet } from "lucide-react";
import { q } from "@/api/client";
import { EstimateNote } from "@/components/kit";
import { bankName, ru } from "@/i18n/ru";
import { formatPercent } from "@/lib/format";
import { accountNow, formatDay } from "@/lib/navigator-live";
import { addDays } from "@/lib/safe-to-spend";
import { money } from "../model";
import { Panel } from "../shared";
import { Missing, Preliminary } from "./common";
import { InsightsPanel, MonthEndPanel } from "./LiveInsights";
import { TxList } from "./LiveTransactions";
import type { LiveProps } from "./types";

const t = ru.live.home;

export function LiveHome(props: LiveProps) {
  const { snap, go, today, obligations } = props;
  const [how, setHow] = useState(false);
  const recent = useQuery(q.transactionsFor({ from: addDays(today, -60), to: today }));
  const hasOps = (recent.data?.length ?? 0) > 0;
  const resilience = useQuery({ ...q.resilience, enabled: hasOps && snap.usable.length > 0 });
  const credits = obligations.filter(
    (o) => !o.rejected && (o.kind === "credit" || o.kind === "installment"),
  );
  const sts = snap.sts;
  return (
    <>
      <div className="nav-top-grid">
        <section className="nav-safe" aria-label={t.safeTitle}>
          <div className="nav-between">
            <span>
              {t.safeTitle} <Preliminary />
            </span>
            <button aria-label={t.howTitle} onClick={() => setHow(!how)}>
              <Info size={19} />
            </button>
          </div>
          {sts ? (
            <>
              <p className="nav-safe-amount">{money(sts.safeDaily)}</p>
              <p>{t.safeUntil(formatDay(sts.until))}</p>
              {sts.deficit > 0 && <p className="nav-warning">{t.deficit(money(sts.deficit))}</p>}
              <div className="nav-safe-line" />
              <div className="nav-formula">
                <div>
                  <span>Текущие счета и наличные</span>
                  <strong>{money(snap.liquid ?? 0)}</strong>
                </div>
                <div>
                  <span>Подтверждённые платежи в горизонте</span>
                  <strong>−{money(sts.committed)}</strong>
                </div>
                <div>
                  <span>Дней в горизонте</span>
                  <strong>{ru.common.days(sts.days)}</strong>
                </div>
              </div>
              <p className="nav-small">
                {sts.horizon === "income" ? t.safeIncome : t.safeMonthEnd}
              </p>
              {snap.confirmedPayments.length === 0 && (
                <Missing action="Открыть календарь" onAction={() => go("calendar")}>
                  {t.noPayments}
                </Missing>
              )}
            </>
          ) : (
            <Missing action={t.noAccountsAction} onAction={() => go("profile")}>
              {t.noAccounts}
            </Missing>
          )}
          {how && <p className="nav-small">{t.formula}</p>}
        </section>
        <Panel title={t.capitalTitle}>
          {snap.usable.length ? (
            <>
              {snap.usable.map((a) => (
                <div className="nav-account" key={a.id}>
                  <span>
                    {bankName(a.bank)} · {a.name}{" "}
                    <small className="nav-small">({ru.accountKind[a.kind!]})</small>
                  </span>
                  <strong>{money(accountNow(a))}</strong>
                </div>
              ))}
              <div className="nav-account">
                <span>Итого</span>
                <strong>{money(snap.total ?? 0)}</strong>
              </div>
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
              <strong>{t.reserveDays(snap.reserveDays)}</strong>
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
