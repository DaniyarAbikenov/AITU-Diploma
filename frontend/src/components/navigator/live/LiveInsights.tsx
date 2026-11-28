import { useQuery } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { api, q } from "@/api/client";
import type { SmartCard } from "@/api/types";
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

/** «Главное сейчас»: smart cards from the knowledge base first, then the older forecast-based insights,
 * at most three cards together (the dashboard limit of the knowledge base). */
export function InsightsPanel({ go }: { go: (t: Tab) => void }) {
  const smart = useQuery(q.smartInsights("dashboard"));
  const ins = useQuery(q.insights);
  const dismiss = useWrite(
    (id: string) => api.dismissInsight(id),
    () => undefined,
  );
  const cards = smart.data ?? [];
  const legacy = (ins.data ?? []).slice(0, Math.max(0, 3 - cards.length));
  return (
    <Panel title={t.title}>
      {smart.isPending && ins.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : !cards.length && !legacy.length ? (
        <p className="nav-small">{t.empty}</p>
      ) : (
        <div className="nav-live-list">
          {cards.map((c) => (
            <SmartCardView key={c.key} card={c} go={go} />
          ))}
          {legacy.map((i) => (
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

const TABS: Tab[] = [
  "home",
  "goals",
  "transactions",
  "calendar",
  "forecast",
  "debts",
  "macro",
  "quests",
  "profile",
];

/** One smart card: fact, one action that opens a view, hide / remind later, and «why I see this». */
export function SmartCardView({ card, go }: { card: SmartCard; go: (t: Tab) => void }) {
  const s = ru.smart;
  const hide = useWrite(
    (key: string) => api.hideSmart(key),
    () => undefined,
  );
  const later = useWrite(
    (key: string) => api.snoozeSmart(key, 3),
    () => undefined,
  );
  return (
    <article className="nav-live-row" aria-label={card.title}>
      <div>
        <span className={`nav-pill ${card.tier <= 1 ? "warn" : ""}`}>{card.tierName}</span>{" "}
        {card.critical && <span className="nav-pill off">{s.critical}</span>}{" "}
        <strong>{card.title}</strong>
        <p className="nav-small">{card.text}</p>
        <div className="nav-actions">
          <button
            className="nav-secondary"
            onClick={() => go(TABS.includes(card.tab as Tab) ? (card.tab as Tab) : "home")}
          >
            {card.actionLabel}
          </button>
          <button
            className="nav-text-button"
            disabled={later.isPending}
            onClick={() => later.mutate(card.key)}
          >
            {s.later}
          </button>
          <button
            className="nav-text-button"
            disabled={hide.isPending}
            onClick={() => hide.mutate(card.key)}
          >
            {s.hide}
          </button>
        </div>
        <details className="nav-small">
          <summary>{s.why}</summary>
          <p>
            {s.formula}: <code>{card.why.formula}</code>
          </p>
          <p>
            {s.inputs}: <code>{JSON.stringify(card.why.inputs)}</code>
          </p>
          <p>{s.dataDate(card.why.asOf)}</p>
          <p>{s.version(card.why.kbVersion, card.why.entryVersion, card.entryId)}</p>
          <p>{s.draft}</p>
          <p>{s.noAuto}</p>
        </details>
      </div>
    </article>
  );
}
