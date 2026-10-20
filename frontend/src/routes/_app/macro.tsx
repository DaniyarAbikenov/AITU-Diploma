import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { q } from "@/api/client";
import { Card, ErrorState, EstimateNote, Loading, PageHeader } from "@/components/kit";
import { Chart, Sparkline, baseAxis } from "@/components/charts";
import { useSession } from "@/lib/auth";
import { formatMoney, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_app/macro")({
  head: pageHead("Мир и цены", "Курс тенге, нефть, инфляция и цены в вашем городе — и почему это важно именно вам."),
  component: Macro,
});

function Macro() {
  const city = useSession()?.user.city ?? "Алматы";
  const ind = useQuery(q.macro);
  const pi = useQuery(q.personalInflation);
  const prices = useQuery(q.cityPrices(city));
  const p = pi.data;
  return (
    <>
      <PageHeader eyebrow="Мир и цены" headline={p ? <>Ваша личная инфляция — <span className="num">{formatPercent(p.personal, 1)}</span>, выше официальных {formatPercent(p.official, 1)}: вы больше тратите на то, что дорожает быстрее.</> : "Загружаем индикаторы…"}>
        {p && <EstimateNote asOf={p.as_of} model={p.model_version} />}
      </PageHeader>
      {ind.isError ? <ErrorState onRetry={() => ind.refetch()} /> : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {ind.isLoading ? Array.from({ length: 3 }, (_, i) => <Card key={i}><Loading rows={4} /></Card>) : ind.data?.map((m) => {
            const Icon = m.trend === "up" ? ArrowUpRight : m.trend === "down" ? ArrowDownRight : ArrowRight;
            return (
              <Card key={m.code}>
                <p className="text-xs text-muted-foreground">{m.name}</p>
                <div className="mt-1 flex items-baseline justify-between"><span className="num text-2xl font-semibold text-foreground">{m.value}</span><span className="flex items-center gap-1 text-xs text-muted-foreground"><Icon className="size-3.5" aria-hidden />{m.change}</span></div>
                <Sparkline data={m.series} />
                <p className="mt-2 border-t pt-3 text-sm text-foreground"><span className="font-semibold">Почему важно вам: </span><span className="text-muted-foreground">{m.why}</span></p>
              </Card>
            );
          })}
        </div>
      )}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Из чего складывается ваша инфляция">
          {pi.isLoading ? <Loading rows={6} /> : p && (
            <Chart height={300} label={`Вклад категорий в личную инфляцию: ${p.contributions.map((c) => `${c.category} ${c.pp} п.п.`).join(", ")}`} option={(pal) => {
              let acc = 0; const helper: number[] = [], vals: number[] = [];
              p.contributions.forEach((c) => { helper.push(acc); vals.push(c.pp); acc += c.pp; });
              return {
                ...baseAxis(pal), tooltip: { show: false },
                xAxis: { type: "category", data: [...p.contributions.map((c) => c.category), "Итого"], axisLabel: { interval: 0, rotate: 30, color: pal["muted-foreground"] }, axisTick: { show: false }, axisLine: { lineStyle: { color: pal.border } } },
                yAxis: { type: "value", splitLine: { lineStyle: { color: pal.border, type: "dashed" } }, axisLabel: { formatter: "{value} п.п." } },
                series: [
                  { type: "bar", stack: "w", data: [...helper, 0], itemStyle: { color: "transparent" }, silent: true },
                  { type: "bar", stack: "w", data: [...vals.map((v) => ({ value: v, itemStyle: { color: pal.accent } })), { value: +acc.toFixed(1), itemStyle: { color: pal.primary } }], label: { show: true, position: "top", color: pal.foreground, formatter: (x: { value: number }) => String(x.value).replace(".", ",") }, itemStyle: { borderRadius: 4 } },
                ],
              };
            }} />
          )}
          <p className="text-xs text-muted-foreground">Каждый столбик — сколько процентных пунктов добавила категория, с учётом того, какую долю ваших трат она занимает.</p>
        </Card>
        <Card title={`Цены в городе ${city}`}>
          {prices.isLoading ? <Loading rows={8} /> : prices.isError ? <ErrorState onRetry={() => prices.refetch()} /> : (
            <table className="w-full text-sm">
              <caption className="sr-only">Цены на продукты и услуги, изменение за год</caption>
              <thead><tr className="text-left text-xs text-muted-foreground"><th className="pb-2 font-normal">Товар</th><th className="pb-2 text-right font-normal">Цена</th><th className="pb-2 text-right font-normal">За год</th></tr></thead>
              <tbody className="divide-y">{prices.data?.map((c) => (
                <tr key={c.item}><td className="py-2 text-foreground">{c.item} <span className="text-xs text-muted-foreground">/ {c.unit}</span></td><td className="num py-2 text-right text-foreground">{formatMoney(c.price, "KZT", { withCode: true })}</td>
                  <td className={`num py-2 text-right font-semibold ${c.change > 0.1 ? "text-risk" : c.change < 0 ? "text-ok" : "text-foreground"}`}>{formatPercent(c.change, 0, true)}</td></tr>
              ))}</tbody>
            </table>
          )}
        </Card>
      </div>
    </>
  );
}
