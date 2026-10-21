import { createFileRoute } from "@tanstack/react-router";
import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Search } from "lucide-react";
import { api, q } from "@/api/client";
import { AS_OF } from "@/api/mock";
import type { Category, Transaction } from "@/api/types";
import { Card, EmptyState, ErrorState, Loading, PageHeader, SourceNote } from "@/components/kit";
import { Chart, baseAxis } from "@/components/charts";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDayShort, formatMoney, formatMoneyShort, formatMonth, formatPercent } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_app/expenses")({
  head: pageHead("Расходы", "Все операции из выписки с категориями, очередь проверки и сравнение месяц к месяцу."),
  component: Expenses,
});

const MONTH = AS_OF.slice(0, 7);

function Expenses() {
  const tx = useQuery(q.transactions);
  const cats = useQuery(q.categories);
  const sum = useQuery(q.summary(MONTH));
  const review = tx.data?.filter((t) => t.needsReview) ?? [];
  const s = sum.data;
  const d = s ? s.expense / s.prevExpense - 1 : 0;

  return (
    <>
      <PageHeader eyebrow={`Расходы · ${formatMonth(MONTH)}`} headline={s ? <>За {Number(AS_OF.slice(8))} дн. месяца — <span className="num">{formatMoney(s.expense)}</span>. Это {formatPercent(Math.abs(d))} {d > 0 ? "больше" : "меньше"}, чем за весь прошлый месяц.</> : "Загружаем расходы…"}>
        <SourceNote kind="fact" from="операции из загруженных выписок; внутренние переводы между своими счетами не считаются расходом" how="суммы по категориям складываются по операциям. Категория определяется по ключевым словам названия получателя и вашим правилам; сомнительные попадают в очередь проверки." />
      </PageHeader>
      <Tabs defaultValue="list">
        <TabsList className="mb-4">
          <TabsTrigger value="list">Операции</TabsTrigger>
          <TabsTrigger value="review">Проверьте категории {review.length > 0 && <span className="ml-1.5 rounded-full bg-accent px-1.5 text-xs text-accent-foreground">{review.length}</span>}</TabsTrigger>
          <TabsTrigger value="compare">Месяц к месяцу</TabsTrigger>
        </TabsList>
        <TabsContent value="list">{tx.isLoading || cats.isLoading ? <Card><Loading rows={8} /></Card> : tx.isError ? <ErrorState onRetry={() => tx.refetch()} /> : <TxTable rows={tx.data!} cats={cats.data!} />}</TabsContent>
        <TabsContent value="review">
          {tx.isLoading ? <Card><Loading /></Card> : review.length === 0 ? <EmptyState title="Всё проверено" text="Новые сомнительные операции появятся здесь после следующей выписки." /> : <TxTable rows={review} cats={cats.data!} compact />}
        </TabsContent>
        <TabsContent value="compare"><Compare /></TabsContent>
      </Tabs>
    </>
  );
}

function CategorySelect({ t, cats }: { t: Transaction; cats: Category[] }) {
  const qc = useQueryClient();
  const bulk = useMutation({ mutationFn: (c: string) => api.bulkCategorize(t.merchant, c), onSuccess: () => { qc.invalidateQueries(); toast.success(`Правило создано: «${t.merchant}» всегда в этой категории`); } });
  const one = useMutation({
    mutationFn: (c: string) => api.recategorize(t.id, c),
    onSuccess: (_, c) => {
      qc.invalidateQueries({ queryKey: ["transactions"] });
      toast("Категория изменена", { description: `Применить ко всем операциям «${t.merchant}»?`, action: { label: "Применить ко всем", onClick: () => bulk.mutate(c) } });
    },
  });
  return (
    <Select value={t.categoryId} onValueChange={(v) => one.mutate(v)}>
      <SelectTrigger className="h-8 w-44 text-xs" aria-label={`Категория для ${t.merchant}`}><SelectValue /></SelectTrigger>
      <SelectContent>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent>
    </Select>
  );
}

function TxTable({ rows, cats, compact }: { rows: Transaction[]; cats: Category[]; compact?: boolean }) {
  const [qText, setQ] = useState("");
  const [cat, setCat] = useState("all");
  const [acc, setAcc] = useState("all");
  const [limit, setLimit] = useState(40);
  const filtered = useMemo(() => rows.filter((t) => (cat === "all" || t.categoryId === cat) && (acc === "all" || t.accountId === acc) && t.merchant.toLowerCase().includes(qText.toLowerCase())), [rows, cat, acc, qText]);
  return (
    <Card>
      {!compact && (
        <div className="mb-4 flex flex-col gap-2 md:flex-row">
          <div className="relative flex-1"><Search className="absolute left-3 top-2.5 size-4 text-muted-foreground" aria-hidden /><Input placeholder="Поиск по получателю" className="pl-9" value={qText} onChange={(e) => setQ(e.target.value)} aria-label="Поиск" /></div>
          <Select value={cat} onValueChange={setCat}><SelectTrigger className="md:w-52" aria-label="Категория"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все категории</SelectItem>{cats.map((c) => <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>)}</SelectContent></Select>
          <Select value={acc} onValueChange={setAcc}><SelectTrigger className="md:w-44" aria-label="Счёт"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="all">Все счета</SelectItem><SelectItem value="acc-kaspi">Kaspi Gold</SelectItem><SelectItem value="acc-halyk">Halyk карта</SelectItem></SelectContent></Select>
        </div>
      )}
      {compact && <p className="mb-4 text-sm text-muted-foreground">Мы не уверены в категории этих операций. Выберите правильную — и предложим запомнить правило для получателя.</p>}
      {filtered.length === 0 ? <EmptyState title="Ничего не нашли" text="Попробуйте изменить фильтры или поисковый запрос." /> : (
        <div className="divide-y">
          {filtered.slice(0, limit).map((t) => (
            <div key={t.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 py-2.5">
              <span className="w-14 text-xs text-muted-foreground">{formatDayShort(t.date)}</span>
              <span className="min-w-0 flex-1 truncate text-sm text-foreground">{t.merchant}</span>
              <CategorySelect t={t} cats={cats} />
              <span className={`num w-36 text-right text-sm font-semibold ${t.amount > 0 ? "text-ok" : "text-foreground"}`}>{formatMoney(t.amount, t.currency, { withCode: true, signed: true })}</span>
            </div>
          ))}
        </div>
      )}
      {filtered.length > limit && <Button variant="outline" className="mt-4 w-full" onClick={() => setLimit((l) => l + 40)}>Показать ещё ({filtered.length - limit})</Button>}
    </Card>
  );
}

function Compare() {
  const cur = useQuery(q.summary(MONTH));
  const cats = useQuery(q.categories);
  if (cur.isLoading || cats.isLoading) return <Card><Loading rows={6} /></Card>;
  if (cur.isError) return <ErrorState onRetry={() => cur.refetch()} />;
  const rows = cur.data!.topCategories;
  const name = (id: string) => cats.data!.find((c) => c.id === id)?.name ?? id;
  return (
    <Card title={`${formatMonth(MONTH)} ({Number(AS_OF.slice(8))} дн.) против прошлого месяца`}>
      <Chart height={Math.max(260, rows.length * 36)} label={`Сравнение расходов по категориям: ${rows.map((r) => `${name(r.categoryId)} ${formatMoneyShort(r.amount)} против ${formatMoneyShort(r.prev)}`).join("; ")}`} option={(p) => ({
        ...baseAxis(p), legend: { data: ["Прошлый месяц", "Этот месяц"], textStyle: { color: p["muted-foreground"] }, top: 0 }, grid: { ...baseAxis(p).grid, top: 30 },
        xAxis: { type: "value", splitLine: { lineStyle: { color: p.border, type: "dashed" } }, axisLabel: { formatter: (v: number) => formatMoneyShort(v).replace(" ₸", "") } },
        yAxis: { type: "category", inverse: true, data: rows.map((r) => name(r.categoryId)), axisLine: { show: false }, axisTick: { show: false } },
        series: [
          { name: "Прошлый месяц", type: "bar", data: rows.map((r) => r.prev), itemStyle: { color: p.border, borderRadius: 4 }, barGap: "10%" },
          { name: "Этот месяц", type: "bar", data: rows.map((r) => r.amount), itemStyle: { color: p.primary, borderRadius: 4 } },
        ],
      })} />
    </Card>
  );
}
