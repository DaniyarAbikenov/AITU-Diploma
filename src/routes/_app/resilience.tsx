import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/client";
import { Card, ErrorState, EstimateNote, Loading, PageHeader, Stat, StatusDot, StatusPill } from "@/components/kit";
import { Chart } from "@/components/charts";
import { formatMonth, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_app/resilience")({
  head: pageHead("Устойчивость", "Индекс финансовой устойчивости: вероятность разрыва, запас прочности и что улучшить."),
  component: ResiliencePage,
});

function ResiliencePage() {
  const r = useQuery(q.resilience);
  const h = useQuery(q.resilienceHistory);
  const d = r.data;
  return (
    <>
      <PageHeader eyebrow="Устойчивость" headline={d ? <>Если доход внезапно пропадёт, денег хватит примерно на <span className="num">{String(d.runwayMonths).replace(".", ",")} месяца</span>. Главное, что стоит укрепить, — подушку.</> : "Оцениваем устойчивость…"}>
        {d && <EstimateNote asOf={d.as_of} model={d.model_version} />}
      </PageHeader>
      {r.isLoading ? <Card><Loading rows={6} /></Card> : r.isError ? <ErrorState onRetry={() => r.refetch()} /> : d && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Card className="lg:col-span-1">
            <div className="grid grid-cols-3 gap-4 lg:grid-cols-1">
              <Stat label="Индекс" value={<span className="font-display text-4xl">{d.score}</span>} sub="из 100" />
              <Stat label="Вероятность разрыва" value={formatPercent(d.pShortfall)} sub="за 60 дней" />
              <Stat label="Запас прочности" value={`${String(d.runwayMonths).replace(".", ",")} мес.`} sub="без дохода" />
            </div>
          </Card>
          <Card title="История индекса" className="lg:col-span-2">
            {h.isLoading ? <Loading rows={5} /> : h.data && (
              <Chart height={220} label={`Индекс устойчивости за 12 месяцев: от ${h.data[0].score} до ${h.data[h.data.length - 1].score}`} option={(p) => ({
                grid: { left: 30, right: 10, top: 10, bottom: 24 }, tooltip: { trigger: "axis" },
                xAxis: { type: "category", data: h.data.map((x) => formatMonth(x.month, true)), axisLabel: { color: p["muted-foreground"] }, axisLine: { lineStyle: { color: p.border } }, axisTick: { show: false } },
                yAxis: { type: "value", min: 0, max: 100, splitLine: { lineStyle: { color: p.border, type: "dashed" } }, axisLabel: { color: p["muted-foreground"] } },
                visualMap: { show: false, pieces: [{ lte: 45, color: p.risk }, { gt: 45, lte: 70, color: p.warn }, { gt: 70, color: p.ok }] },
                series: [{ type: "line", data: h.data.map((x) => x.score), smooth: true, symbolSize: 6, lineStyle: { width: 2.5 } }],
              })} />
            )}
          </Card>
          <div className="space-y-3 lg:col-span-3">
            {d.components.map((c) => (
              <Card key={c.key} className="p-4 md:p-5">
                <div className="flex flex-col gap-3 md:flex-row md:items-center">
                  <div className="flex items-center gap-3 md:w-72"><StatusDot status={c.status} /><div><p className="font-semibold text-foreground">{c.name}</p><p className="num text-sm text-muted-foreground">{c.value}</p></div></div>
                  <p className="flex-1 text-sm text-muted-foreground">{c.explain}</p>
                  <div className="md:w-72"><StatusPill status={c.status} /><p className="mt-1.5 text-sm font-medium text-foreground">→ {c.action}</p></div>
                </div>
              </Card>
            ))}
          </div>
        </div>
      )}
    </>
  );
}
