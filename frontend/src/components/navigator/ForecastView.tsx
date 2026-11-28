import { Chart, baseAxis } from "@/components/charts";
import { EstimateNote } from "@/components/kit";
import { DEMO_DATE, NAV_MODEL, projectNavigator, type NavigatorState } from "@/lib/navigator";
import { compact, money } from "./model";

export function ForecastView({
  s,
  months,
  lost,
  extra,
  detail = false,
}: {
  s: NavigatorState;
  months: number;
  lost: number;
  extra: number;
  detail?: boolean;
}) {
  const series = projectNavigator(s, months, lost, extra),
    base = projectNavigator(s, months),
    last = series.at(-1)!;
  return (
    <>
      <div className="nav-between">
        <div>
          <p className="nav-small">Капитал через {months} мес.</p>
          <p className="nav-large">{compact(last.median)}</p>
        </div>
        <span className="nav-tag">Без учёта доходности</span>
      </div>
      <Chart
        paletteScope=".navigator"
        height={detail ? 310 : 235}
        label={`Прогноз капитала: ${money(last.low)}–${money(last.high)}`}
        option={(p) => ({
          ...baseAxis(p),
          grid: { left: 2, right: 10, top: 25, bottom: 5, containLabel: true },
          legend: { show: detail, bottom: 0 },
          xAxis: {
            type: "category",
            data: series.map((d) =>
              new Date(2026, 10 + d.month, 27).toLocaleDateString("ru-RU", { month: "short" }),
            ),
            boundaryGap: false,
            axisLine: { show: false },
            axisTick: { show: false },
          },
          yAxis: {
            type: "value",
            axisLabel: { formatter: (v: number) => compact(v) },
            splitLine: { lineStyle: { color: p.border, type: "dashed" } },
          },
          series: [
            {
              name: "Нижняя оценка",
              type: "line",
              data: series.map((d) => d.low),
              lineStyle: { color: p["muted-foreground"], type: "dotted", width: 1 },
              symbol: "none",
            },
            {
              name: "Верхняя оценка",
              type: "line",
              data: series.map((d) => d.high),
              lineStyle: { color: p["muted-foreground"], type: "dotted", width: 1 },
              symbol: "none",
            },
            {
              name: "Базовый план",
              type: "line",
              data: base.map((d) => d.median),
              lineStyle: { color: p["muted-foreground"], type: "dashed" },
              symbol: "none",
            },
            {
              name: "Ваш сценарий",
              type: "line",
              data: series.map((d) => d.median),
              lineStyle: { color: p.primary, width: 3 },
              symbol: "none",
              areaStyle: { color: p.primary, opacity: 0.06 },
            },
          ],
        })}
      />
      <p className="nav-small">
        Диапазон: {money(last.low)}–{money(last.high)}. Расходы ±20%; это анализ чувствительности, а
        не вероятность результата.
      </p>
      <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
    </>
  );
}
