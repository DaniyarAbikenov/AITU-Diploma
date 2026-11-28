import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/client";
import { Chart, baseAxis } from "@/components/charts";
import { EstimateNote } from "@/components/kit";
import { ru } from "@/i18n/ru";
import { compact, money } from "../model";
import { Panel } from "../shared";
import { Missing, Preliminary } from "./common";
import type { LiveProps } from "./types";

const t = ru.live.forecast;

/** Balance forecast from the server (Monte Carlo on the user's own spending) with its P10–P90 range. */
export function LiveForecast({ snap, go }: LiveProps) {
  const ready = snap.usable.length > 0;
  const fc = useQuery({ ...q.balance(60), enabled: ready });
  if (!ready)
    return (
      <Panel title={t.title}>
        <Missing action={ru.live.home.noAccountsAction} onAction={() => go("profile")}>
          {t.empty}
        </Missing>
      </Panel>
    );
  const days = fc.data?.days ?? [];
  const last = days.at(-1);
  return (
    <Panel title={t.title} action={<Preliminary />}>
      {fc.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : fc.isError ? (
        <p className="nav-error" role="alert">
          {fc.error.message}
        </p>
      ) : !days.length ? (
        <Missing>{t.empty}</Missing>
      ) : (
        <>
          {last && (
            <p className="nav-large">
              {compact(last.p50)}{" "}
              <span className="nav-small">
                ({money(last.p10)} – {money(last.p90)})
              </span>
            </p>
          )}
          <Chart
            paletteScope=".navigator"
            height={300}
            label={t.title}
            option={(p) => ({
              ...baseAxis(p),
              grid: { left: 2, right: 10, top: 25, bottom: 5, containLabel: true },
              xAxis: {
                type: "category",
                data: days.map((d) => d.date.slice(5)),
                boundaryGap: false,
              },
              yAxis: { type: "value", axisLabel: { formatter: (v: number) => compact(v) } },
              series: [
                {
                  name: "P10",
                  type: "line",
                  data: days.map((d) => d.p10),
                  symbol: "none",
                  lineStyle: { type: "dotted", color: p["muted-foreground"] },
                },
                {
                  name: "P50",
                  type: "line",
                  data: days.map((d) => d.p50),
                  symbol: "none",
                  lineStyle: { width: 3, color: p.primary },
                },
                {
                  name: "P90",
                  type: "line",
                  data: days.map((d) => d.p90),
                  symbol: "none",
                  lineStyle: { type: "dotted", color: p["muted-foreground"] },
                },
              ],
            })}
          />
          <p className="nav-small">{t.range}</p>
          {fc.data && <EstimateNote asOf={fc.data.as_of} model={fc.data.model_version} />}
        </>
      )}
    </Panel>
  );
}
