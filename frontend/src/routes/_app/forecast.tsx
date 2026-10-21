import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/client";
import { Card, ErrorState, EstimateNote, Loading, PageHeader, StatusPill } from "@/components/kit";
import { FanChart } from "@/components/charts";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_app/forecast")({
  head: pageHead("Прогноз баланса", "Прогноз остатка на счетах на 30, 60 или 90 дней с диапазоном неопределённости и днями риска."),
  component: Forecast,
});

function Forecast() {
  const [days, setDays] = useState(60);
  const bal = useQuery(q.balance(days));
  const d = bal.data;
  const firstRisk = d?.riskDays[0];
  return (
    <>
      <PageHeader eyebrow="Прогноз" headline={!d ? "Считаем траектории баланса…" : firstRisk ? <>Самый напряжённый момент — <b className="font-medium text-risk">{formatDate(firstRisk.date)}</b>: вероятность уйти в минус около {formatPercent(firstRisk.pBelowZero)}.</> : <>В ближайшие {days} дней разрыва не ожидается.</>}>
        {d && <EstimateNote asOf={d.as_of} model={d.model_version} />}
      </PageHeader>
      <Card title="Остаток на всех счетах" aside={
        <ToggleGroup type="single" value={String(days)} onValueChange={(v) => v && setDays(Number(v))} variant="outline" size="sm" aria-label="Горизонт">
          {[30, 60, 90].map((n) => <ToggleGroupItem key={n} value={String(n)}>{n} дн.</ToggleGroupItem>)}
        </ToggleGroup>}>
        {bal.isLoading ? <Loading rows={8} /> : bal.isError ? <ErrorState onRetry={() => bal.refetch()} /> : d && (
          <>
            <FanChart points={d.days} riskDates={d.riskDays.map((r) => r.date)} payments={d.payments} height={360} />
            <div className="mt-4 grid gap-3 text-xs text-muted-foreground md:grid-cols-3">
              <p><span className="mr-1.5 inline-block h-2 w-5 rounded bg-primary align-middle" />Самый вероятный остаток</p>
              <p><span className="mr-1.5 inline-block h-2 w-5 rounded bg-primary/30 align-middle" />Тёмная зона: 5 из 10 вариантов развития. Светлая: 8 из 10.</p>
              <p><span className="mr-1.5 inline-block size-2.5 rounded-full bg-risk align-middle" />Дни, когда остаток может опуститься ниже 50 000 ₸. Пунктир — плановые платежи.</p>
            </div>
          </>
        )}
      </Card>
      <div className="mt-4 grid gap-4 md:grid-cols-2">
        <Card title="Дни риска">
          {bal.isLoading ? <Loading /> : !d?.riskDays.length ? <p className="text-sm text-muted-foreground">Рисковых дней нет.</p> : (
            <ul className="space-y-3">{d.riskDays.map((r) => (
              <li key={r.date} className="flex items-start gap-3"><StatusPill status={r.pBelowZero > 0.2 ? "risk" : "warn"} label={formatDate(r.date)} /><div className="text-sm"><p className="text-foreground">{r.reason}</p><p className="text-xs text-muted-foreground">Шанс уйти в минус ≈ {formatPercent(r.pBelowZero)}. Что делать: перенести крупные покупки после зарплаты.</p></div></li>
            ))}</ul>
          )}
        </Card>
        <Card title="Регулярные платежи на горизонте">
          {bal.isLoading ? <Loading /> : (
            <ul className="divide-y">{d?.payments.map((p, i) => <li key={i} className="flex justify-between py-2 text-sm"><span className="text-foreground"><span className="mr-3 inline-block w-20 text-muted-foreground">{formatDate(p.date)}</span>{p.name}</span><span className="num font-semibold text-foreground">{formatMoney(-p.amount)}</span></li>)}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
