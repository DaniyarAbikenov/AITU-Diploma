import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Trash2 } from "lucide-react";
import { api, q } from "@/api/client";
import { Card, EmptyState, ErrorState, Loading, PageHeader, StatusPill, SourceNote } from "@/components/kit";
import { Progress } from "@/components/ui/progress";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { formatMoney, formatMonth } from "@/lib/format";
import { pageHead } from "@/lib/seo";

export const Route = createFileRoute("/_app/goals")({
  head: pageHead("Цели", "Финансовые цели с прогнозом срока достижения и необходимым ежемесячным взносом."),
  component: Goals,
});

export const goalSchema = z.object({
  name: z.string().min(2, "Назовите цель"),
  target: z.coerce.number().positive("Сумма больше нуля"),
  saved: z.coerce.number().min(0, "Не может быть меньше нуля"),
  monthly: z.coerce.number().min(0, "Не может быть меньше нуля"),
  deadline: z.string().regex(/^\d{4}-\d{2}$/, "Укажите месяц"),
});

function Goals() {
  const goals = useQuery(q.goals);
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const del = useMutation({ mutationFn: api.deleteGoal, onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }) });
  const add = useMutation({ mutationFn: api.addGoal, onSuccess: () => { qc.invalidateQueries({ queryKey: ["goals"] }); setOpen(false); reset(); } });
  const { register, handleSubmit, reset, formState: { errors } } = useForm({ resolver: zodResolver(goalSchema), defaultValues: { name: "", target: 1_000_000, saved: 0, monthly: 50_000, deadline: "2027-12" } });
  const first = goals.data?.[0];
  return (
    <>
      <PageHeader eyebrow="Цели" headline={first ? <>«{first.name}»: при текущем темпе — к {formatMonth(first.projection.etaMonth)}.</> : "Ваши цели"}>
        <SourceNote kind="calc" from="цели, которые вы задали, и ваш текущий темп накоплений из выписок" how="срок достижения = (цель − накоплено) ÷ средний месячный взнос." />
      </PageHeader>
      {goals.isLoading ? <Card><Loading rows={5} /></Card> : goals.isError ? <ErrorState onRetry={() => goals.refetch()} /> : (
        <div className="grid gap-4 md:grid-cols-2">
          {goals.data?.length === 0 && <div className="md:col-span-2"><EmptyState title="Целей пока нет" text="Добавьте цель — посчитаем, когда вы её достигнете и сколько откладывать." /></div>}
          {goals.data?.map((g) => {
            const pct = Math.min(100, (g.saved / g.target) * 100);
            return (
              <Card key={g.id} title={g.name} aside={<button aria-label={`Удалить цель ${g.name}`} onClick={() => del.mutate(g.id)} className="text-muted-foreground hover:text-risk"><Trash2 className="size-4" /></button>}>
                <div className="flex items-baseline justify-between"><span className="num text-2xl font-semibold text-foreground">{formatMoney(g.saved)}</span><span className="num text-sm text-muted-foreground">из {formatMoney(g.target)}</span></div>
                <Progress value={pct} className="mt-3" aria-label={`Накоплено ${Math.round(pct)}%`} />
                <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                  <div><p className="text-xs text-muted-foreground">Срок при текущем темпе</p><p className="font-semibold text-foreground">{formatMonth(g.projection.etaMonth)}</p></div>
                  <div><p className="text-xs text-muted-foreground">Нужно к {formatMonth(g.deadline)}</p><p className="num font-semibold text-foreground">{formatMoney(g.projection.requiredMonthly)}/мес.</p></div>
                </div>
                <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground"><StatusPill status={g.projection.onTrack ? "ok" : "warn"} label={g.projection.onTrack ? "Успеваете" : "Не успеваете"} />сейчас откладываете {formatMoney(g.monthly)}/мес.</div>
              </Card>
            );
          })}
          <Card title="Новая цель">
            {!open ? <Button variant="outline" onClick={() => setOpen(true)}>Добавить цель</Button> : (
              <form className="grid grid-cols-2 gap-3" onSubmit={handleSubmit((v) => add.mutate(v))}>
                {([["name", "Название", "text"], ["target", "Сумма, ₸", "number"], ["saved", "Уже есть, ₸", "number"], ["monthly", "Откладываю в мес., ₸", "number"], ["deadline", "Желаемый срок", "month"]] as const).map(([f, l, t]) => (
                  <div key={f} className={f === "name" ? "col-span-2 space-y-1" : "space-y-1"}><Label htmlFor={f}>{l}</Label><Input id={f} type={t} {...register(f)} aria-invalid={!!errors[f]} />{errors[f] && <p className="text-xs text-risk">{errors[f]?.message as string}</p>}</div>
                ))}
                <div className="col-span-2 flex gap-2"><Button type="submit">Сохранить</Button><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Отмена</Button></div>
              </form>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
