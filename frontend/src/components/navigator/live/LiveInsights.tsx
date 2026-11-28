import { useQuery } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { api, q } from "@/api/client";
import { EstimateNote } from "@/components/kit";
import { ru } from "@/i18n/ru";
import type { Tab } from "../model";
import { money } from "../model";
import { Panel } from "../shared";
import { Missing, Preliminary } from "./common";
import { useWrite } from "./hooks";

const t = ru.insights;
/** Insight links from the server still use the old page paths: map them to Navigator tabs. */
const TAB: Record<string, Tab> = {
  "/expenses": "transactions",
  "/debts": "debts",
  "/forecast": "forecast",
  "/resilience": "forecast",
  "/scenarios": "forecast",
  "/macro": "macro",
  "/goals": "goals",
  "/settings": "profile",
};

export function MonthEndPanel() {
  const me = useQuery(q.monthEnd);
  const f = me.data;
  return (
    <Panel title={t.monthTitle} action={<Preliminary />}>
      {me.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : me.isError || !f ? (
        <Missing>{t.monthEmpty}</Missing>
      ) : (
        <>
          <p className="nav-large">
            {t.monthLine(money(f.median), `${money(f.low)} – ${money(f.high)}`)}
          </p>
          <div className="nav-formula">
            <div>
              <span>{t.spent}</span>
              <strong>{money(f.spentSoFar)}</strong>
            </div>
            <div>
              <span>{t.pace}</span>
              <strong>{money(f.pacePerDay)}</strong>
            </div>
            <div>
              <span>{t.prev}</span>
              <strong>{money(f.prevMonth)}</strong>
            </div>
          </div>
          <div className="nav-actions">
            {f.drivers.map((d) => (
              <span key={d.label} className="nav-pill">
                {d.label} {d.delta > 0 ? "+" : ""}
                {money(d.delta)}
              </span>
            ))}
          </div>
          <EstimateNote asOf={f.as_of} model={f.model_version} />
        </>
      )}
    </Panel>
  );
}

export function InsightsPanel({ go }: { go: (t: Tab) => void }) {
  const ins = useQuery(q.insights);
  const dismiss = useWrite(
    (id: string) => api.dismissInsight(id),
    () => undefined,
  );
  return (
    <Panel title={t.title}>
      {ins.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : !ins.data?.length ? (
        <p className="nav-small">{t.empty}</p>
      ) : (
        <div className="nav-live-list">
          {ins.data.slice(0, 4).map((i) => (
            <div className="nav-live-row" key={i.id}>
              <div>
                <span
                  className={`nav-pill ${i.status === "ok" ? "ok" : i.status === "warn" ? "warn" : "off"}`}
                >
                  {ru.debts.dtiStatus[i.status]}
                </span>{" "}
                <strong>{i.title}</strong>
                <p className="nav-small">{i.why}</p>
                <button className="nav-text-button" onClick={() => go(TAB[i.to] ?? "home")}>
                  {i.action} <ArrowRight size={14} />
                </button>
              </div>
              <button
                className="nav-text-button"
                aria-label={t.hide}
                disabled={dismiss.isPending}
                onClick={() => dismiss.mutate(i.id)}
              >
                <X size={16} />
              </button>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
