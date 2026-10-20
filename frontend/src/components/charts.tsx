import { lazy, Suspense, useEffect, useState } from "react";
import type { EChartsOption } from "echarts";
import { Skeleton } from "@/components/ui/skeleton";
import type { BalancePoint } from "@/api/types";
import { formatDayShort, formatMoneyShort } from "@/lib/format";

// echarts touches the DOM: load it only in the browser.
const ReactECharts = lazy(() => import("echarts-for-react"));

/** Chart colors: read the design tokens and convert to rgb through the browser so canvas understands them. */
export function useChartPalette() {
  const [p, setP] = useState<Record<string, string> | null>(null);
  useEffect(() => {
    const resolve = () => {
      const el = document.createElement("div"); document.body.appendChild(el);
      const get = (v: string) => { el.style.color = `var(${v})`; return getComputedStyle(el).color; };
      const toRgb = (c: string) => { const cv = document.createElement("canvas"); cv.width = cv.height = 1; const ctx = cv.getContext("2d")!; ctx.fillStyle = c; ctx.fillRect(0, 0, 1, 1); const d = ctx.getImageData(0, 0, 1, 1).data; return `rgb(${d[0]},${d[1]},${d[2]})`; };
      const keys = ["--primary", "--accent", "--ok", "--warn", "--risk", "--muted-foreground", "--border", "--foreground", "--card", "--chart-5"];
      const out: Record<string, string> = {}; keys.forEach((k) => (out[k.slice(2)] = toRgb(get(k))));
      el.remove(); setP(out);
    };
    resolve();
    const mo = new MutationObserver(resolve); mo.observe(document.documentElement, { attributes: true, attributeFilter: ["class"] });
    return () => mo.disconnect();
  }, []);
  return p;
}
export const alpha = (rgb: string, a: number) => rgb.replace("rgb(", "rgba(").replace(")", `,${a})`);

export function Chart({ option, height = 280, label }: { option: (p: Record<string, string>) => object; height?: number; label: string }) {
  const p = useChartPalette();
  if (!p) return <Skeleton style={{ height }} className="w-full" />;
  return (
    <figure role="img" aria-label={label}>
      <Suspense fallback={<Skeleton style={{ height }} className="w-full" />}>
        <ReactECharts option={option(p) as EChartsOption} style={{ height }} notMerge opts={{ renderer: "svg" }} />
      </Suspense>
    </figure>
  );
}

export function baseAxis(p: Record<string, string>) {
  return {
    grid: { left: 8, right: 12, top: 16, bottom: 8, containLabel: true },
    textStyle: { fontFamily: "Manrope", color: p["muted-foreground"] },
    tooltip: { trigger: "axis" as const, backgroundColor: p.card, borderColor: p.border, textStyle: { color: p.foreground, fontFamily: "Manrope" } },
  };
}

/** Fan chart: 80% band (p10–p90), 50% band (p25–p75), median line, optional risk markers. */
export function fanSeries(points: BalancePoint[], color: string, name: string, p: Record<string, string>, riskDates: string[] = []) {
  const lo = points.map((d) => d.p10), b80 = points.map((d) => d.p90 - d.p10);
  const lo50 = points.map((d) => d.p25), b50 = points.map((d) => d.p75 - d.p25);
  const stackA = name + "a", stackB = name + "b";
  return [
    { type: "line" as const, data: lo, stack: stackA, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    { type: "line" as const, data: b80, stack: stackA, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: alpha(color, 0.14) }, tooltip: { show: false }, silent: true },
    { type: "line" as const, data: lo50, stack: stackB, symbol: "none", lineStyle: { opacity: 0 }, tooltip: { show: false }, silent: true },
    { type: "line" as const, data: b50, stack: stackB, symbol: "none", lineStyle: { opacity: 0 }, areaStyle: { color: alpha(color, 0.26) }, tooltip: { show: false }, silent: true },
    {
      type: "line" as const, name, data: points.map((d) => d.p50), symbol: "none", lineStyle: { color, width: 2.5 },
      markPoint: riskDates.length ? { symbol: "pin", symbolSize: 34, itemStyle: { color: p.risk }, label: { formatter: "!", color: "#fff", fontWeight: "bold" },
        data: riskDates.map((dt) => { const i = points.findIndex((x) => x.date === dt); return { name: "Риск", coord: [i, points[i]?.p10 ?? 0] }; }).filter((x) => x.coord[0] >= 0) } : undefined,
    },
  ];
}

export function FanChart({ points, riskDates = [], height = 300, payments = [], compareWith }: {
  points: BalancePoint[]; riskDates?: string[]; height?: number; payments?: { date: string; name: string }[]; compareWith?: BalancePoint[];
}) {
  const first = points[0], last = points[points.length - 1];
  return (
    <Chart
      height={height}
      label={`Прогноз баланса с ${first?.date} по ${last?.date}: медиана к концу ${formatMoneyShort(last?.p50 ?? 0)}, диапазон 80% от ${formatMoneyShort(last?.p10 ?? 0)} до ${formatMoneyShort(last?.p90 ?? 0)}.`}
      option={(p) => ({
        ...baseAxis(p),
        tooltip: {
          ...baseAxis(p).tooltip,
          formatter: (params: unknown) => {
            const arr = params as { dataIndex: number }[]; const d = points[arr[0]?.dataIndex ?? 0]; if (!d) return "";
            const c = compareWith?.[arr[0].dataIndex];
            return `<b>${formatDayShort(d.date)}</b><br/>Скорее всего: <b>${formatMoneyShort(d.p50)}</b><br/>8 из 10 случаев: ${formatMoneyShort(d.p10)} … ${formatMoneyShort(d.p90)}` + (c ? `<br/><span style="opacity:.7">База: ${formatMoneyShort(c.p50)}</span>` : "");
          },
        },
        xAxis: { type: "category", data: points.map((d) => formatDayShort(d.date)), boundaryGap: false, axisLine: { lineStyle: { color: p.border } }, axisTick: { show: false }, axisLabel: { interval: Math.ceil(points.length / 7) } },
        yAxis: { type: "value", splitLine: { lineStyle: { color: p.border, type: "dashed" } }, axisLabel: { formatter: (v: number) => formatMoneyShort(v).replace(" ₸", "") } },
        series: [
          ...(compareWith ? [{ type: "line" as const, name: "База", data: compareWith.map((d) => d.p50), symbol: "none", lineStyle: { color: p["muted-foreground"], width: 1.5, type: "dashed" as const } }] : []),
          ...fanSeries(points, compareWith ? p.risk : p.primary, "Прогноз", p, riskDates),
          { type: "line" as const, data: [], markLine: { silent: true, symbol: "none", lineStyle: { color: p.risk, type: "solid", width: 1 }, label: { formatter: "0 ₸", color: p.risk }, data: [{ yAxis: 0 }] } },
          ...(payments.length ? [{ type: "line" as const, data: [], markLine: { silent: true, symbol: "none", lineStyle: { color: alpha(p["muted-foreground"], 0.35), type: "dotted" as const }, label: { show: false }, data: payments.map((pm) => ({ xAxis: formatDayShort(pm.date) })) } }] : []),
        ],
      })}
    />
  );
}

export function Sparkline({ data, height = 48, color }: { data: number[]; height?: number; color?: string }) {
  return (
    <Chart height={height} label={`Динамика: от ${data[0]} до ${data[data.length - 1]}`} option={(p) => ({
      grid: { left: 0, right: 0, top: 4, bottom: 4 }, xAxis: { type: "category", show: false, data: data.map((_, i) => i) }, yAxis: { type: "value", show: false, scale: true },
      series: [{ type: "line", data, symbol: "none", smooth: true, lineStyle: { color: color ? p[color] : p.primary, width: 2 }, areaStyle: { color: alpha(color ? p[color] : p.primary, 0.12) } }],
    })} />
  );
}
