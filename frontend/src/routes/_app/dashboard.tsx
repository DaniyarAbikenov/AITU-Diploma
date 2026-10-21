import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowRight, X } from "lucide-react";
import { api, q } from "@/api/client";
import { AS_OF } from "@/api/mock";
import { Card, EmptyState, ErrorState, EstimateNote, Loading, PageHeader, StatusDot, StatusPill } from "@/components/kit";
import { FanChart } from "@/components/charts";
import { Button } from "@/components/ui/button";
import { formatDate, formatMoney, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { useSession } from "@/lib/auth";
import { scoreStatus } from "@/lib/finance";

export const Route = createFileRoute("/_app/dashboard")({
  head: pageHead("Главная", "Прогноз расходов до конца месяца, индекс устойчивости и главные выводы по вашим финансам."),
  component: Dashboard,
});


function Dashboard() {
  const session = useSession();
  const me = useQuery(q.monthEnd);
  const res = useQuery(q.resilience);
  const ins = useQuery(q.insights);
  const bal = useQuery(q.balance(30));
  const qc = useQueryClient();
  const dismiss = useMutation({ mutationFn: api.dismissInsight, onSuccess: () => qc.invalidateQueries({ queryKey: ["insights"] }) });

  const f = me.data;
  const delta = f ? f.median / f.prevMonth - 1 : 0;
  return (
    <>
      <PageHeader eyebrow={`Добрый день, ${session?.user.name ?? ""}`} headline={f ? <>К {formatDate(`${f.month}-31`)} вы потратите <span className="num whitespace-nowrap">~{formatMoney(f.median)}</span> <span className="num text-muted-foreground">(±{formatMoney((f.high - f.low) / 2)})</span>, на {formatPercent(Math.abs(delta))} {delta > 0 ? "больше" : "меньше"} сентября.</> : "Считаем прогноз…"}>
        {f && <EstimateNote asOf={f.as_of} model={f.model_version} />}
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Расходы до конца месяца" className="lg:col-span-2" aside={<Button asChild variant="ghost" size="sm"><Link to="/expenses">Детали <ArrowRight className="size-4" /></Link></Button>}>
          {me.isLoading ? <Loading rows={4} /> : me.isError ? <ErrorState onRetry={() => me.refetch()} /> : f && (
            <div className="space-y-5">
              <div className="relative h-3 rounded-full bg-muted" aria-label="Шкала расходов">
                {(() => { const max = f.high * 1.08; const pct = (v: number) => `${(v / max) * 100}%`; return (<>
                  <div className="absolute inset-y-0 left-0 rounded-full bg-primary" style={{ width: pct(f.spentSoFar) }} />
                  <div className="absolute inset-y-0 rounded-full bg-primary/25" style={{ left: pct(f.low), width: `calc(${pct(f.high)} - ${pct(f.low)})` }} />
                  <div className="absolute -top-1 h-5 w-0.5 bg-foreground" style={{ left: pct(f.median) }} />
                  <div className="absolute -top-1 h-5 w-0.5 border-l border-dashed border-muted-foreground" style={{ left: pct(f.prevMonth) }} />
                </>); })()}
              </div>
              <div className="grid grid-cols-2 gap-4 text-sm md:grid-cols-4">
                <div><p className="text-xs text-muted-foreground">Уже потрачено</p><p className="num font-semibold text-foreground">{formatMoney(f.spentSoFar)}</p></div>
                <div><p className="text-xs text-muted-foreground">Темп в день</p><p className="num font-semibold text-foreground">{formatMoney(f.pacePerDay)}</p></div>
                <div><p className="text-xs text-muted-foreground">Диапазон (80%)</p><p className="num font-semibold text-foreground">{formatMoney(f.low)} – {formatMoney(f.high).replace(" ₸", "")}</p></div>
                <div><p className="text-xs text-muted-foreground">Сентябрь, факт</p><p className="num font-semibold text-foreground">{formatMoney(f.prevMonth)}</p></div>
              </div>
              <div className="flex flex-wrap gap-2">{f.drivers.map((d) => <span key={d.label} className="rounded-full bg-secondary px-3 py-1 text-xs text-secondary-foreground">{d.label} <span className="num font-semibold">{formatMoney(d.delta, "KZT", { signed: true })}</span></span>)}</div>
              <p className="text-xs text-muted-foreground">Тёмная полоса — уже потрачено, светлая зона — где окажется итог в 8 случаях из 10, вертикальная линия — самый вероятный итог, пунктир — сентябрь.</p>
            </div>
          )}
        </Card>

        <Card title="Устойчивость">
          {res.isLoading ? <Loading rows={4} /> : res.isError ? <ErrorState onRetry={() => res.refetch()} /> : res.data && (
            <Link to="/resilience" className="block">
              <div className="flex items-end gap-3"><span className="num font-display text-5xl text-foreground">{res.data.score}</span><span className="pb-2 text-sm text-muted-foreground">из 100</span></div>
              <div className="mt-2"><StatusPill status={scoreStatus(res.data.score)} label={scoreStatus(res.data.score) === "warn" ? "Есть слабые места" : undefined} /></div>
              <ul className="mt-4 space-y-2 text-sm">{res.data.components.slice(0, 3).map((c) => <li key={c.key} className="flex items-center gap-2 text-foreground"><StatusDot status={c.status} />{c.name}<span className="num ml-auto text-muted-foreground">{c.value}</span></li>)}</ul>
            </Link>
          )}
        </Card>

        <Card title="Главное сейчас" className="lg:col-span-1">
          {ins.isLoading ? <Loading rows={6} /> : ins.isError ? <ErrorState onRetry={() => ins.refetch()} /> : !ins.data?.length ? <EmptyState title="Всё спокойно" text="Новых выводов нет. Загрузите свежую выписку, чтобы обновить картину." /> : (
            <ul className="space-y-4">{ins.data.slice(0, 3).map((i) => (
              <li key={i.id} className="group relative rounded-lg border p-3">
                <div className="flex items-start gap-2"><StatusPill status={i.status} label="" /><p className="flex-1 text-sm font-semibold text-foreground">{i.title}</p>
                  <button aria-label="Скрыть" onClick={() => dismiss.mutate(i.id)} className="text-muted-foreground opacity-60 hover:opacity-100"><X className="size-4" /></button></div>
                <p className="mt-1.5 text-xs text-muted-foreground">{i.why}</p>
                <Link to={i.to} className="mt-2 inline-flex items-center gap-1 text-xs font-semibold text-primary">{i.action} <ArrowRight className="size-3" /></Link>
              </li>
            ))}</ul>
          )}
        </Card>

        <Card title="Баланс на 30 дней" className="lg:col-span-2" aside={<Button asChild variant="ghost" size="sm"><Link to="/forecast">Весь прогноз <ArrowRight className="size-4" /></Link></Button>}>
          {bal.isLoading ? <Loading rows={6} /> : bal.isError ? <ErrorState onRetry={() => bal.refetch()} /> : bal.data && (
            <><FanChart points={bal.data.days} riskDates={bal.data.riskDays.map((r) => r.date)} height={240} />
              <p className="mt-2 text-xs text-muted-foreground">Линия — самый вероятный остаток, тёмная зона — 5 из 10 сценариев, светлая — 8 из 10. Отсчёт от {formatDate(AS_OF)}.</p></>
          )}
        </Card>
      </div>
    </>
  );
}
