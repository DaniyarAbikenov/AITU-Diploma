import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { q } from "@/api/client";
import { Chart, Sparkline, baseAxis } from "@/components/charts";
import { EstimateNote } from "@/components/kit";
import { ru } from "@/i18n/ru";
import { formatPercent } from "@/lib/format";
import { money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { RatesPanel } from "./RatesPanel";
import type { LiveProps } from "./types";

const t = ru.macro;

/** Macro context: indicators, personal inflation and its contributions, city prices. */
export function LiveMacro({ me }: LiveProps) {
  const city = me.city || "Алматы";
  const ind = useQuery(q.macro);
  const pi = useQuery(q.personalInflation);
  const prices = useQuery(q.cityPrices(city));
  const p = pi.data;
  return (
    <>
      <RatesPanel />
      <Panel title={t.inflationTitle}>
        {pi.isPending ? (
          <p className="nav-small">{ru.common.loading}</p>
        ) : !p || pi.isError ? (
          <Missing>{t.noData}</Missing>
        ) : (
          <>
            <p className="nav-large">
              {t.inflationLine(formatPercent(p.personal, 1), formatPercent(p.official, 1))}
            </p>
            <EstimateNote asOf={p.as_of} model={p.model_version} />
          </>
        )}
        <p className="nav-small">{t.source}</p>
      </Panel>
      {ind.isError ? (
        <p className="nav-error" role="alert">
          {ind.error.message}
        </p>
      ) : (
        <div className="nav-goal-grid">
          {(ind.data ?? []).map((m) => {
            const Icon =
              m.trend === "up" ? ArrowUpRight : m.trend === "down" ? ArrowDownRight : ArrowRight;
            return (
              <article className="nav-panel" key={m.code}>
                <p className="nav-small">{m.name}</p>
                <div className="nav-between">
                  <strong className="nav-large">{m.value}</strong>
                  <span className="nav-small">
                    <Icon size={14} aria-hidden /> {m.change}
                  </span>
                </div>
                <Sparkline data={m.series} />
                <p className="nav-small">
                  <strong>{t.why}</strong>
                  {m.why}
                </p>
              </article>
            );
          })}
        </div>
      )}
      <div className="nav-profile-grid">
        <Panel title={t.contributionsTitle}>
          {p && p.contributions.length ? (
            <Chart
              height={280}
              label={`${t.contributionsTitle}: ${p.contributions.map((c) => `${c.category} ${c.pp} п.п.`).join(", ")}`}
              option={(pal) => {
                let acc = 0;
                const helper: number[] = [],
                  vals: number[] = [];
                p.contributions.forEach((c) => {
                  helper.push(acc);
                  vals.push(c.pp);
                  acc += c.pp;
                });
                return {
                  ...baseAxis(pal),
                  tooltip: { show: false },
                  grid: { left: 4, right: 8, top: 20, bottom: 4, containLabel: true },
                  xAxis: {
                    type: "category",
                    data: [...p.contributions.map((c) => c.category), t.total],
                    axisLabel: { interval: 0, rotate: 30 },
                  },
                  yAxis: { type: "value", axisLabel: { formatter: "{value} п.п." } },
                  series: [
                    {
                      type: "bar",
                      stack: "w",
                      data: [...helper, 0],
                      itemStyle: { color: "transparent" },
                      silent: true,
                    },
                    {
                      type: "bar",
                      stack: "w",
                      data: [
                        ...vals.map((v) => ({ value: v, itemStyle: { color: pal.accent } })),
                        { value: +acc.toFixed(1), itemStyle: { color: pal.primary } },
                      ],
                      label: {
                        show: true,
                        position: "top",
                        formatter: (x: { value: number }) => String(x.value).replace(".", ","),
                      },
                    },
                  ],
                };
              }}
            />
          ) : (
            <Missing>{t.noData}</Missing>
          )}
          <p className="nav-small">{t.contributionsHint}</p>
        </Panel>
        <Panel title={t.pricesTitle(city)}>
          {prices.isPending ? (
            <p className="nav-small">{ru.common.loading}</p>
          ) : prices.isError ? (
            <p className="nav-error" role="alert">
              {prices.error.message}
            </p>
          ) : (
            <div className="nav-live-list">
              {prices.data!.map((c) => (
                <div className="nav-account" key={c.item}>
                  <span>
                    {c.item} <small className="nav-small">/ {c.unit}</small>
                  </span>
                  <span>
                    <strong>{money(c.price)}</strong>{" "}
                    <small className={c.change > 0.1 ? "nav-danger" : ""}>
                      {formatPercent(c.change, 0, true)}
                    </small>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Panel>
      </div>
    </>
  );
}
