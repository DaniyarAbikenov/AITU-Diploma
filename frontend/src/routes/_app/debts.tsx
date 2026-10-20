import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/client";
import { Card, ErrorState, Loading, PageHeader, Stat, StatusPill } from "@/components/kit";
import { Chart, baseAxis } from "@/components/charts";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { formatMoney, formatMoneyShort, formatMonth, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { dtiStatus, monthlyPayment } from "@/lib/finance";

export const Route = createFileRoute("/_app/debts")({
  head: pageHead("Долги и обязательства", "Календарь платежей на 12 месяцев, долговая нагрузка и симулятор новой рассрочки."),
  component: Debts,
});

const KIND: Record<string, string> = { credit: "Кредит", installment: "Рассрочка", rent: "Аренда", utility: "ЖКУ", subscription: "Подписка" };
function Debts() {
  const obl = useQuery(q.obligations);
  const cal = useQuery(q.calendar);
  const dti = useQuery(q.dti);
  const [price, setPrice] = useState(450_000);
  const [months, setMonths] = useState(12);
  const [rate, setRate] = useState(0);
  const [sim, setSim] = useState<{ pay: number; months: number } | null>(null);

  const current = dti.data?.[dti.data.length - 1]?.dti ?? 0;
  const income = cal.data?.income ?? 800_000;
  const newDti = sim ? current + sim.pay / income : current;

  return (
    <>
      <PageHeader eyebrow="Обязательства" headline={dti.data ? <>Кредиты и рассрочки забирают <span className="num">{formatPercent(current)}</span> вашего дохода. В апреле, после iPhone, станет ~20%.</> : "Загружаем обязательства…"} />
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Платежи на 12 месяцев" className="lg:col-span-2">
          {cal.isLoading ? <Loading rows={8} /> : cal.isError ? <ErrorState onRetry={() => cal.refetch()} /> : (
            <Chart height={300} label="Ежемесячные обязательные платежи на 12 месяцев: кредиты, рассрочки и регулярные расходы" option={(p) => {
              const ms = cal.data!.months;
              const series = (name: string, key: "credit" | "installment" | "regular", color: string) => ({
                name, type: "bar" as const, stack: "s", data: ms.map((m) => sim && key === "installment" ? m[key] + (ms.indexOf(m) < sim.months ? sim.pay : 0) : m[key]), itemStyle: { color },
              });
              return {
                ...baseAxis(p), legend: { top: 0, textStyle: { color: p["muted-foreground"] } }, grid: { ...baseAxis(p).grid, top: 32 },
                xAxis: { type: "category", data: ms.map((m) => formatMonth(m.month, true)), axisTick: { show: false }, axisLine: { lineStyle: { color: p.border } } },
                yAxis: { type: "value", splitLine: { lineStyle: { color: p.border, type: "dashed" } }, axisLabel: { formatter: (v: number) => formatMoneyShort(v).replace(" ₸", "") } },
                series: [series("Регулярные", "regular", p["chart-5"]), series("Кредиты", "credit", p.primary), series(sim ? "Рассрочки (с новой)" : "Рассрочки", "installment", p.accent)],
              };
            }} />
          )}
        </Card>
        <Card title="КДН — доля дохода на долги">
          {dti.isLoading ? <Loading rows={5} /> : dti.data && (
            <>
              <div className="flex items-center gap-3"><span className="num font-display text-4xl text-foreground">{formatPercent(current)}</span><StatusPill status={dtiStatus(current)} /></div>
              <Chart height={140} label="Тренд долговой нагрузки за 12 месяцев" option={(p) => ({
                grid: { left: 0, right: 0, top: 10, bottom: 18 }, xAxis: { type: "category", data: dti.data.map((d) => formatMonth(d.month, true)), axisLabel: { color: p["muted-foreground"], fontSize: 10, interval: 3 }, axisLine: { show: false }, axisTick: { show: false } },
                yAxis: { type: "value", show: false, max: 0.55 },
                series: [{ type: "line", data: dti.data.map((d) => d.dti), smooth: true, symbol: "none", lineStyle: { color: p.primary, width: 2 }, markLine: { silent: true, symbol: "none", data: [{ yAxis: 0.3 }, { yAxis: 0.5 }], lineStyle: { color: p.risk, type: "dashed" }, label: { formatter: (x: { value: number }) => formatPercent(x.value), color: p["muted-foreground"], fontSize: 10 } } }],
              })} />
              <p className="text-xs text-muted-foreground">До 30% — комфортно. Выше 50% банки обычно отказывают в новых кредитах.</p>
            </>
          )}
        </Card>

        <Card title="А что если взять рассрочку?" className="lg:col-span-1">
          <form className="space-y-3" onSubmit={(e) => { e.preventDefault(); setSim({ pay: monthlyPayment(price, months, rate / 100), months }); }}>
            <div className="space-y-1"><Label htmlFor="price">Стоимость покупки, ₸</Label><Input id="price" type="number" min={1000} value={price} onChange={(e) => setPrice(Number(e.target.value))} /></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1"><Label htmlFor="months">Срок, мес.</Label><Input id="months" type="number" min={1} max={60} value={months} onChange={(e) => setMonths(Number(e.target.value))} /></div>
              <div className="space-y-1"><Label htmlFor="rate">Ставка, % год.</Label><Input id="rate" type="number" min={0} max={60} value={rate} onChange={(e) => setRate(Number(e.target.value))} /></div>
            </div>
            <div className="flex gap-2"><Button type="submit">Посчитать</Button>{sim && <Button type="button" variant="ghost" onClick={() => setSim(null)}>Сбросить</Button>}</div>
          </form>
        </Card>
        <Card title="Сейчас и после" className="lg:col-span-2">
          {!sim ? <p className="text-sm text-muted-foreground">Введите параметры покупки — покажем, как изменится нагрузка. На графике выше новая рассрочка добавится к платежам.</p> : (
            <div className="grid grid-cols-2 gap-6 md:grid-cols-3">
              <Stat label="Платёж в месяц" value={formatMoney(sim.pay)} sub={`${sim.months} мес., переплата ${formatMoney(sim.pay * sim.months - price)}`} />
              <Stat label="КДН сейчас → после" value={<>{formatPercent(current)} → <span className={newDti >= 0.3 ? "text-risk" : ""}>{formatPercent(newDti)}</span></>} sub={<StatusPill status={dtiStatus(newDti)} />} />
              <Stat label="Свободно после обязательств" value={formatMoney(income - income * newDti - 248_400)} sub="доход минус долги и аренда/ЖКУ" />
            </div>
          )}
        </Card>

        <Card title="Все обязательства" className="lg:col-span-3">
          {obl.isLoading ? <Loading /> : (
            <div className="divide-y">{obl.data?.map((o) => (
              <div key={o.id} className="flex flex-wrap items-center gap-3 py-2.5 text-sm">
                <span className="w-24 text-xs text-muted-foreground">{KIND[o.kind]}</span>
                <span className="flex-1 text-foreground">{o.name}</span>
                <span className="text-xs text-muted-foreground">{o.dayOfMonth} числа{o.endsAt ? ` · до ${formatMonth(o.endsAt)}` : ""}</span>
                <span className="num w-32 text-right font-semibold text-foreground">{formatMoney(o.amount)}</span>
              </div>
            ))}</div>
          )}
        </Card>
      </div>
    </>
  );
}
