import { useEffect, useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { api, q } from "@/api/client";
import type { Shock } from "@/api/types";
import { Chart, FanChart } from "@/components/charts";
import { EstimateNote } from "@/components/kit";
import { ru } from "@/i18n/ru";
import { formatPercent } from "@/lib/format";
import { formatDay, formatMonth } from "@/lib/navigator-live";
import { money } from "../model";
import { Panel } from "../shared";
import { Missing, Preliminary } from "./common";
import { FormError } from "./forms";
import { confirmed, useWrite } from "./hooks";
import type { LiveProps } from "./types";

const t = ru.live.forecast;
const SHOCKS: { type: Shock["type"]; max: number; unit: string }[] = [
  { type: "fx", max: 40, unit: "%" },
  { type: "inflation", max: 30, unit: "%" },
  { type: "income", max: 60, unit: "%" },
  { type: "jobloss", max: 6, unit: " мес." },
];
const pill = (s: string) => (s === "ok" ? "ok" : s === "warn" ? "warn" : "off");

/** Forecast: balance fan for 30/60/90 days with risk days, resilience details and stress scenarios. */
export function LiveForecast({ snap, go, notify }: LiveProps) {
  const ready = snap.usable.length > 0;
  if (!ready)
    return (
      <Panel title={t.title}>
        <Missing action={ru.live.home.noAccountsAction} onAction={() => go("profile")}>
          {t.empty}
        </Missing>
      </Panel>
    );
  return (
    <>
      <Balance />
      <Resilience />
      <Scenarios notify={notify} />
    </>
  );
}

function Balance() {
  const [days, setDays] = useState(60);
  const fc = useQuery(q.balance(days));
  const d = fc.data;
  return (
    <>
      <Panel
        title={t.balanceTitle(days)}
        action={
          <div className="nav-mode-switch" role="group" aria-label={t.horizon}>
            {[30, 60, 90].map((n) => (
              <button
                key={n}
                type="button"
                className={days === n ? "active" : ""}
                aria-pressed={days === n}
                onClick={() => setDays(n)}
              >
                {t.days(n)}
              </button>
            ))}
          </div>
        }
      >
        {fc.isPending ? (
          <p className="nav-small">{ru.common.loading}</p>
        ) : fc.isError ? (
          <p className="nav-error" role="alert">
            {fc.error.message}
          </p>
        ) : !d?.days.length ? (
          <Missing>{t.empty}</Missing>
        ) : (
          <>
            <Preliminary />
            <FanChart
              points={d.days}
              riskDates={d.riskDays.map((r) => r.date)}
              payments={d.payments}
              height={300}
            />
            <p className="nav-small">{t.legend}</p>
            <EstimateNote asOf={d.as_of} model={d.model_version} />
          </>
        )}
      </Panel>
      {d && (
        <div className="nav-profile-grid">
          <Panel title={t.riskTitle}>
            {!d.riskDays.length ? (
              <p className="nav-small">{t.riskEmpty}</p>
            ) : (
              <div className="nav-live-list">
                {d.riskDays.map((r) => (
                  <div key={r.date}>
                    <span className={`nav-pill ${r.pBelowZero > 0.2 ? "off" : "warn"}`}>
                      {formatDay(r.date)}
                    </span>
                    <p>{r.reason}</p>
                    <p className="nav-small">{t.riskLine(formatPercent(r.pBelowZero))}</p>
                  </div>
                ))}
              </div>
            )}
          </Panel>
          <Panel title={t.paymentsTitle}>
            {d.payments.map((p, i) => (
              <div className="nav-account" key={i}>
                <span>
                  {formatDay(p.date)} · {p.name}
                </span>
                <strong>{money(-p.amount)}</strong>
              </div>
            ))}
          </Panel>
        </div>
      )}
    </>
  );
}

function Resilience() {
  const r = useQuery(q.resilience);
  const h = useQuery(q.resilienceHistory);
  const d = r.data;
  return (
    <Panel title={t.resilienceTitle} action={<Preliminary />}>
      {r.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : r.isError || !d ? (
        <p className="nav-error" role="alert">
          {r.error?.message}
        </p>
      ) : (
        <>
          <div className="nav-formula">
            <div>
              <span>{t.score}</span>
              <strong>{d.score} / 100</strong>
            </div>
            <div>
              <span>{t.pShortfall}</span>
              <strong>{formatPercent(d.pShortfall)}</strong>
            </div>
            <div>
              <span>{t.runway}</span>
              <strong>{t.runwayValue(d.runwayMonths)}</strong>
            </div>
          </div>
          <div className="nav-live-list">
            {d.components.map((c) => (
              <div className="nav-live-row" key={c.key}>
                <div>
                  <strong>{c.name}</strong>{" "}
                  <span className={`nav-pill ${pill(c.status)}`}>{c.value}</span>
                  <p className="nav-small">{c.explain}</p>
                </div>
                <p className="nav-small">→ {c.action}</p>
              </div>
            ))}
          </div>
          {h.data && h.data.length > 1 && (
            <>
              <h3>{t.historyTitle}</h3>
              <Chart
                height={200}
                label={`${t.historyTitle}: ${h.data.map((x) => x.score).join(", ")}`}
                option={(p) => ({
                  grid: { left: 30, right: 10, top: 10, bottom: 24 },
                  tooltip: { trigger: "axis" },
                  xAxis: {
                    type: "category",
                    data: h.data!.map((x) => formatMonth(x.month).slice(0, 3)),
                  },
                  yAxis: { type: "value", min: 0, max: 100 },
                  series: [
                    {
                      type: "line",
                      data: h.data!.map((x) => x.score),
                      smooth: true,
                      lineStyle: { color: p.primary, width: 2.5 },
                      itemStyle: { color: p.primary },
                    },
                  ],
                })}
              />
            </>
          )}
          <EstimateNote asOf={d.as_of} model={d.model_version} />
        </>
      )}
    </Panel>
  );
}

function Scenarios({ notify }: { notify: (m: string) => void }) {
  const presets = useQuery(q.presets);
  const saved = useQuery(q.savedScenarios);
  const [vals, setVals] = useState<Record<Shock["type"], number>>({
    fx: 15,
    inflation: 0,
    income: 0,
    jobloss: 0,
  });
  const [active, setActive] = useState<string | null>("fx15");
  const [name, setName] = useState("");
  const shocks: Shock[] = (Object.entries(vals) as [Shock["type"], number][])
    .filter(([, v]) => v > 0)
    .map(([type, value]) => ({ type, value }));
  const run = useMutation({ mutationFn: api.runScenario });
  const save = useWrite(
    () => api.saveScenario(name.trim() || "Мой сценарий", shocks),
    () => {
      setName("");
      notify(ru.crud.saved);
    },
  );
  const del = useWrite(
    (id: string) => api.deleteScenario(id),
    () => notify(ru.crud.deleted),
  );
  const key = JSON.stringify(shocks);
  useEffect(() => {
    const timer = setTimeout(() => run.mutate(JSON.parse(key)), 250);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const apply = (s: Shock[], id: string | null) => {
    const v = { fx: 0, inflation: 0, income: 0, jobloss: 0 };
    s.forEach((x) => (v[x.type] = x.value));
    setVals(v);
    setActive(id);
  };
  const r = run.data;
  return (
    <>
      <Panel title={t.scenariosTitle}>
        <p className="nav-small">{t.scenariosText}</p>
        <div className="nav-actions">
          {(presets.data ?? []).map((p) => (
            <button
              key={p.id}
              type="button"
              className={active === p.id ? "nav-primary" : "nav-secondary"}
              aria-pressed={active === p.id}
              title={p.description}
              onClick={() => apply(p.shocks, p.id)}
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="nav-simulation">
          <div>
            {SHOCKS.map((s) => (
              <label key={s.type} className="nav-field">
                {t.shocks[s.type]}: {vals[s.type]}
                {s.unit}
                <input
                  type="range"
                  min={0}
                  max={s.max}
                  step={1}
                  value={vals[s.type]}
                  onChange={(e) => {
                    setVals((o) => ({ ...o, [s.type]: Number(e.target.value) }));
                    setActive(null);
                  }}
                />
              </label>
            ))}
            <label className="nav-field">
              {t.scenarioName}
              <input value={name} maxLength={200} onChange={(e) => setName(e.target.value)} />
            </label>
            <button
              className="nav-primary"
              disabled={!shocks.length || save.isPending}
              onClick={() => save.mutate(undefined)}
            >
              {t.save}
            </button>
            <FormError error={save.error} />
          </div>
          <div>
            {run.isError ? (
              <p className="nav-error" role="alert">
                {run.error.message}
              </p>
            ) : !shocks.length ? (
              <Missing>{t.noShocks}</Missing>
            ) : !r ? (
              <p className="nav-small">{ru.common.loading}</p>
            ) : (
              <div style={{ opacity: run.isPending ? 0.6 : 1 }}>
                <FanChart points={r.scenario} compareWith={r.base} height={280} />
                <p className="nav-small">{t.compareLegend}</p>
                <EstimateNote asOf={r.as_of} model={r.model_version} />
              </div>
            )}
          </div>
        </div>
        {r && shocks.length > 0 && (
          <div className="nav-goal-grid">
            {r.deltas.map((d) => (
              <div key={d.label} className="nav-panel">
                <p className="nav-small">{d.label}</p>
                <p className="nav-small" style={{ textDecoration: "line-through" }}>
                  {d.base}
                </p>
                <p className="nav-large">{d.scenario}</p>
                <span className={`nav-pill ${pill(d.status)}`}>{ru.debts.dtiStatus[d.status]}</span>
              </div>
            ))}
          </div>
        )}
      </Panel>
      <Panel title={t.savedTitle}>
        {!saved.data?.length ? (
          <p className="nav-small">{t.savedEmpty}</p>
        ) : (
          <div className="nav-live-list">
            {saved.data.map((s) => (
              <div className="nav-live-row" key={s.id}>
                <div>
                  <strong>{s.name}</strong>
                  <p className="nav-small">{formatDay(s.createdAt)}</p>
                </div>
                <div className="nav-actions">
                  <button className="nav-secondary" onClick={() => apply(s.shocks, null)}>
                    {t.open}
                  </button>
                  <button
                    className="nav-text-button"
                    disabled={del.isPending}
                    onClick={() => confirmed(t.deleteConfirm(s.name)) && del.mutate(s.id)}
                  >
                    {ru.common.delete}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        <FormError error={del.error} />
      </Panel>
    </>
  );
}
