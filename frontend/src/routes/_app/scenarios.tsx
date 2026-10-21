import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api, q } from "@/api/client";
import type { Shock } from "@/api/types";
import { Card, EmptyState, ErrorState, EstimateNote, Loading, PageHeader, StatusPill, SourceNote } from "@/components/kit";
import { FanChart } from "@/components/charts";
import { Slider } from "@/components/ui/slider";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { pageHead } from "@/lib/seo";
import { formatDate } from "@/lib/format";

export const Route = createFileRoute("/_app/scenarios")({
  head: pageHead("Сценарии", "Стресс-тесты: что будет с вашим бюджетом при падении тенге, инфляции или потере дохода."),
  component: Scenarios,
});

const SHOCKS: { type: Shock["type"]; label: string; max: number; unit: string }[] = [
  { type: "fx", label: "Ослабление тенге", max: 40, unit: "%" },
  { type: "inflation", label: "Инфляция за год", max: 30, unit: "%" },
  { type: "income", label: "Снижение дохода", max: 60, unit: "%" },
  { type: "jobloss", label: "Без работы", max: 6, unit: " мес." },
];

function Scenarios() {
  const presets = useQuery(q.presets);
  const saved = useQuery(q.savedScenarios);
  const qc = useQueryClient();
  const [vals, setVals] = useState<Record<Shock["type"], number>>({ fx: 15, inflation: 0, income: 0, jobloss: 0 });
  const [active, setActive] = useState<string | null>("fx15");
  const [name, setName] = useState("");
  const shocks: Shock[] = (Object.entries(vals) as [Shock["type"], number][]).filter(([, v]) => v > 0).map(([type, value]) => ({ type, value }));
  const run = useMutation({ mutationFn: api.runScenario });
  const save = useMutation({ mutationFn: () => api.saveScenario(name || "Мой сценарий", shocks), onSuccess: () => { qc.invalidateQueries({ queryKey: ["savedScenarios"] }); setName(""); toast.success("Сценарий сохранён"); } });
  const key = JSON.stringify(shocks);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { const t = setTimeout(() => run.mutate(shocks), 250); return () => clearTimeout(t); }, [key]);

  const apply = (s: Shock[], id: string | null) => { const v = { fx: 0, inflation: 0, income: 0, jobloss: 0 }; s.forEach((x) => (v[x.type] = x.value)); setVals(v); setActive(id); };
  const r = run.data;

  return (
    <>
      <PageHeader eyebrow="Сценарии" headline="Что будет, если… Проверьте бюджет на прочность до того, как это случится." >
        <p className="max-w-2xl text-sm text-muted-foreground">Это не предсказание, а «что если»: мы применяем шок к вашим реальным доходам и расходам и пересчитываем прогноз.</p>
        <SourceNote kind="forecast" from="базовый прогноз по вашим выпискам плюс заданные вами шоки" how="сценарий меняет доходы или расходы в симуляции и сравнивается с базовой траекторией на 90 дней." />
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        {presets.isLoading ? <Loading rows={1} className="w-full" /> : presets.data?.map((p) => (
          <button key={p.id} onClick={() => apply(p.shocks, p.id)} className={cn("rounded-full border px-4 py-2 text-left text-sm transition-colors", active === p.id ? "border-primary bg-primary text-primary-foreground" : "bg-card text-foreground hover:border-primary/60")}>
            <span className="font-semibold">{p.name}</span><span className={cn("ml-2 hidden text-xs md:inline", active === p.id ? "opacity-80" : "text-muted-foreground")}>{p.description}</span>
          </button>
        ))}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Конструктор шоков">
          <div className="space-y-6">
            {SHOCKS.map((s) => (
              <div key={s.type}>
                <div className="mb-2 flex justify-between text-sm"><label className="text-foreground" id={`l-${s.type}`}>{s.label}</label><span className="num font-semibold text-foreground">{vals[s.type]}{s.unit}</span></div>
                <Slider aria-labelledby={`l-${s.type}`} max={s.max} step={1} value={[vals[s.type]]} onValueChange={([v]) => { setVals((o) => ({ ...o, [s.type]: v })); setActive(null); }} />
              </div>
            ))}
            <div className="flex gap-2 border-t pt-4"><Input placeholder="Название сценария" value={name} onChange={(e) => setName(e.target.value)} aria-label="Название сценария" /><Button onClick={() => save.mutate()} disabled={!shocks.length}>Сохранить</Button></div>
          </div>
        </Card>
        <Card title="База vs сценарий, 90 дней" className="lg:col-span-2" aside={r && <EstimateNote asOf={r.as_of} model={r.model_version} />}>
          {run.isError ? <ErrorState onRetry={() => run.mutate(shocks)} /> : !r ? <Loading rows={8} /> : !shocks.length ? <EmptyState title="Шоков нет" text="Выберите пресет или сдвиньте ползунок, чтобы увидеть разницу с базовым прогнозом." /> : (
            <div className={cn("transition-opacity", run.isPending && "opacity-60")}>
              <FanChart points={r.scenario} compareWith={r.base} height={300} />
              <p className="mt-1 text-xs text-muted-foreground">Пунктир — базовый прогноз. Цветная зона — сценарий с диапазоном 50% и 80%.</p>
            </div>
          )}
        </Card>
      </div>
      {r && shocks.length > 0 && (
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {r.deltas.map((d) => (
            <div key={d.label} className="surface p-4">
              <p className="text-xs text-muted-foreground">{d.label}</p>
              <p className="num mt-2 text-sm text-muted-foreground line-through decoration-muted-foreground/40">{d.base}</p>
              <p className="num text-xl font-semibold text-foreground">{d.scenario}</p>
              <div className="mt-2"><StatusPill status={d.status} /></div>
            </div>
          ))}
        </div>
      )}
      <Card title="Сохранённые сценарии" className="mt-4">
        {saved.isLoading ? <Loading /> : !saved.data?.length ? <p className="text-sm text-muted-foreground">Пока пусто. Настройте шоки и нажмите «Сохранить».</p> : (
          <ul className="divide-y">{saved.data.map((s) => (
            <li key={s.id} className="flex items-center justify-between py-2 text-sm"><span className="text-foreground">{s.name} <span className="text-xs text-muted-foreground">· {formatDate(s.createdAt)}</span></span><Button size="sm" variant="ghost" onClick={() => apply(s.shocks, null)}>Открыть</Button></li>
          ))}</ul>
        )}
      </Card>
    </>
  );
}
