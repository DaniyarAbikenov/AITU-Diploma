import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, q } from "@/api/client";
import { Chart, baseAxis } from "@/components/charts";
import { ru } from "@/i18n/ru";
import { dtiStatus, monthlyPayment } from "@/lib/finance";
import { formatPercent } from "@/lib/format";
import { cautiousIncome, formatDay, formatMonth } from "@/lib/navigator-live";
import { compact, money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { ObligationsPanel } from "./LivePayments";
import { FormError } from "./forms";
import { useWrite } from "./hooks";
import type { LiveProps } from "./types";

const t = ru.debts;

const pill = (s: string) => (s === "ok" ? "ok" : s === "warn" ? "warn" : "off");

/** Operations counted as debt payments in a month; a wrong one can be re-typed right here. */
function DtiPayments({
  month,
  count,
  notify,
}: {
  month: string;
  count: number;
  notify: (m: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const list = useQuery({ ...q.dtiPayments(month), enabled: open });
  const fix = useWrite(
    (id: string) => api.recategorize(id, "other"),
    () => notify(ru.crud.saved),
  );
  if (!count) return null;
  return (
    <details className="nav-small" onToggle={(e) => setOpen((e.target as HTMLDetailsElement).open)}>
      <summary>{t.dtiPayments(count)}</summary>
      {(list.data ?? []).map((x) => (
        <div className="nav-live-row" key={x.id}>
          <div>
            {formatDay(x.date)} · {x.merchant}
          </div>
          <strong>{money(x.amount)}</strong>
          <button
            className="nav-text-button"
            disabled={fix.isPending}
            onClick={() => fix.mutate(x.id)}
          >
            {t.notDebt}
          </button>
        </div>
      ))}
      <FormError error={fix.error} />
    </details>
  );
}

/** Debts: 12-month payment calendar, debt-to-income, installment simulator and the obligations list. */
export function LiveDebts({ obligations, incomes, notify }: LiveProps) {
  const cal = useQuery(q.calendar);
  const dti = useQuery(q.dti);
  const [sim, setSim] = useState<{ pay: number; months: number; price: number } | null>(null);
  const income = cautiousIncome(incomes);
  const last = dti.data?.at(-1);
  const current = last?.dti ?? null;
  const newDti = current !== null && sim && income > 0 ? current + sim.pay / income : current;
  const credits = obligations.filter(
    (o) => !o.rejected && (o.kind === "credit" || o.kind === "installment"),
  );
  const known = credits.filter((o) => o.debtLeft != null);
  const fixed = obligations
    .filter((o) => o.confirmed && !o.rejected)
    .reduce((a, o) => a + o.amount, 0);
  const months = cal.data?.months ?? [];
  const empty = months.every((m) => m.credit + m.installment + m.regular === 0);
  return (
    <>
      <Panel title={t.calendarTitle}>
        {cal.isPending ? (
          <p className="nav-small">{ru.common.loading}</p>
        ) : cal.isError ? (
          <p className="nav-error" role="alert">
            {cal.error.message}
          </p>
        ) : empty && !sim ? (
          <Missing>{t.calendarEmpty}</Missing>
        ) : (
          <Chart
            height={280}
            label={t.calendarTitle}
            option={(p) => {
              const series = (
                name: string,
                key: "credit" | "installment" | "regular",
                color: string,
              ) => ({
                name,
                type: "bar" as const,
                stack: "s",
                data: months.map((m, i) =>
                  sim && key === "installment" && i < sim.months ? m[key] + sim.pay : m[key],
                ),
                itemStyle: { color },
              });
              return {
                ...baseAxis(p),
                legend: { top: 0, textStyle: { color: p["muted-foreground"] } },
                grid: { left: 4, right: 8, top: 34, bottom: 4, containLabel: true },
                xAxis: {
                  type: "category",
                  data: months.map((m) => formatMonth(m.month).slice(0, 3)),
                },
                yAxis: { type: "value", axisLabel: { formatter: (v: number) => compact(v) } },
                series: [
                  series(t.regular, "regular", p["chart-5"]),
                  series(t.credit, "credit", p.primary),
                  series(sim ? t.installmentNew : t.installment, "installment", p.accent),
                ],
              };
            }}
          />
        )}
        <p className="nav-small">
          {known.length
            ? t.debtLeft(
                money(known.reduce((a, o) => a + (o.debtLeft ?? 0), 0)),
                known.length,
                credits.length,
              )
            : credits.length
              ? t.debtUnknown
              : ""}
        </p>
      </Panel>
      <div className="nav-profile-grid">
        <Panel title={t.dtiTitle}>
          {dti.isPending ? (
            <p className="nav-small">{ru.common.loading}</p>
          ) : !last ? (
            <Missing>{t.dtiEmpty}</Missing>
          ) : (
            <>
              {last.dti != null ? (
                <p className="nav-large">
                  {formatPercent(last.dti)}{" "}
                  <span className={`nav-pill ${pill(dtiStatus(last.dti))}`}>
                    {t.dtiStatus[dtiStatus(last.dti)]}
                  </span>{" "}
                  {last.status === "check" && <span className="nav-pill warn">{t.dtiCheck}</span>}
                </p>
              ) : (
                <Missing>
                  {last.status === "incomplete_income"
                    ? t.dtiIncomplete(
                        formatMonth(last.month),
                        money(last.income ?? 0),
                        money(last.expectedIncome ?? 0),
                      )
                    : t.dtiNoIncome(formatMonth(last.month))}
                </Missing>
              )}
              <p className="nav-small">
                {t.dtiBreakdown(
                  formatMonth(last.month),
                  money(last.debt ?? 0),
                  money(last.income ?? 0),
                )}
              </p>
              {last.status === "check" && <p className="nav-warning">{t.dtiCheckHint}</p>}
              <DtiPayments month={last.month} count={last.payments ?? 0} notify={notify} />
              <Chart
                height={140}
                label={`${t.dtiTitle}: ${dti.data!.map((d) => (d.dti == null ? "—" : formatPercent(d.dti))).join(", ")}`}
                option={(p) => ({
                  grid: { left: 0, right: 0, top: 10, bottom: 18 },
                  xAxis: {
                    type: "category",
                    data: dti.data!.map((d) => formatMonth(d.month).slice(0, 3)),
                    axisLine: { show: false },
                    axisTick: { show: false },
                  },
                  yAxis: { type: "value", show: false },
                  series: [
                    {
                      type: "line",
                      data: dti.data!.map((d) => d.dti),
                      connectNulls: false,
                      symbol: "circle",
                      symbolSize: 5,
                      lineStyle: { color: p.primary, width: 2 },
                      itemStyle: { color: p.primary },
                      markLine: {
                        silent: true,
                        symbol: "none",
                        data: [{ yAxis: 0.3 }, { yAxis: 0.5 }],
                        lineStyle: { color: p.risk, type: "dashed" },
                        label: { formatter: (x: { value: number }) => formatPercent(x.value) },
                      },
                    },
                  ],
                })}
              />
              <p className="nav-small">{t.dtiGaps}</p>
            </>
          )}
          <p className="nav-small">{t.dtiHint}</p>
        </Panel>
        <Panel title={t.simTitle}>
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              const price = Number(f.get("price")),
                m = Number(f.get("months")),
                rate = Number(f.get("rate") || 0);
              setSim({ pay: monthlyPayment(price, m, rate / 100), months: m, price });
            }}
          >
            <label className="nav-field">
              {t.price}
              <input
                name="price"
                type="number"
                min={1000}
                step={1}
                required
                defaultValue={450000}
              />
            </label>
            <label className="nav-field">
              {t.months}
              <input
                name="months"
                type="number"
                min={1}
                max={60}
                step={1}
                required
                defaultValue={12}
              />
            </label>
            <label className="nav-field">
              {t.rate}
              <input name="rate" type="number" min={0} max={60} step={0.1} defaultValue={0} />
            </label>
            <div className="nav-actions">
              <button className="nav-primary">{t.calc}</button>
              {sim && (
                <button type="button" className="nav-secondary" onClick={() => setSim(null)}>
                  {t.reset}
                </button>
              )}
            </div>
          </form>
          {!sim ? (
            <p className="nav-small">{t.simEmpty}</p>
          ) : (
            <div className="nav-formula">
              <div>
                <span>{t.payment}</span>
                <strong>{money(sim.pay)}</strong>
              </div>
              <p className="nav-small">
                {t.overpay(sim.months, money(sim.pay * sim.months - sim.price))}
              </p>
              <div>
                <span>{t.dtiNowAfter}</span>
                <strong>
                  {current === null || newDti === null
                    ? "—"
                    : `${formatPercent(current)} → ${formatPercent(newDti)}`}
                </strong>
              </div>
              <div>
                <span>{t.freeAfter}</span>
                <strong>{income > 0 ? money(income - fixed - sim.pay) : "—"}</strong>
              </div>
              <p className="nav-small">{income > 0 ? t.freeAfterHint : t.freeUnknown}</p>
            </div>
          )}
        </Panel>
      </div>
      <ObligationsPanel obligations={obligations} notify={notify} />
    </>
  );
}
