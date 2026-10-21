import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, FileUp, Lock, MapPin } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { api, q } from "@/api/client";
import type { ImportReport } from "@/api/types";
import { UploadStep } from "@/components/UploadStep";
import { updateSession, useSession } from "@/lib/auth";
import { formatDate, formatMoney } from "@/lib/format";
import { Loading } from "@/components/kit";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/onboarding")({
  head: () => ({ meta: [
    { title: "Настройка — Запас" }, { name: "description", content: "Город, выписка банка и подтверждение найденных доходов и обязательств." },
    { property: "og:title", content: "Настройка — Запас" }, { property: "og:description", content: "Три шага до первого прогноза." },
  ] }),
  component: Onboarding,
});

const CITIES = ["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Атырау", "Усть-Каменогорск", "Павлодар"];
const STEPS = ["Город", "Выписка", "Подтверждение"];

function Onboarding() {
  const session = useSession();
  const navigate = useNavigate();
  const [step, setStep] = useState(0);
  const [city, setCity] = useState("Алматы");
  useEffect(() => { if (session === null) navigate({ to: "/register" }); }, [session, navigate]);

  return (
    <div className="min-h-screen bg-background px-4 py-10">
      <div className="mx-auto max-w-2xl">
        <ol className="mb-10 flex items-center gap-3" aria-label="Шаги">
          {STEPS.map((s, i) => (
            <li key={s} className="flex flex-1 items-center gap-2 text-sm">
              <span className={cn("grid size-7 place-items-center rounded-full border text-xs font-semibold", i < step ? "border-primary bg-primary text-primary-foreground" : i === step ? "border-primary text-primary" : "text-muted-foreground")}>{i < step ? <Check className="size-4" /> : i + 1}</span>
              <span className={i === step ? "font-semibold text-foreground" : "text-muted-foreground"}>{s}</span>
              {i < STEPS.length - 1 && <span className="h-px flex-1 bg-border" />}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <section className="surface p-6 md:p-8">
            <MapPin className="mb-3 size-6 text-primary" aria-hidden />
            <h1 className="text-2xl text-foreground">{session?.user.name ? `${session.user.name}, где вы живёте?` : "Где вы живёте?"}</h1>
            <p className="mt-2 text-sm text-muted-foreground">Город нужен, чтобы сравнить ваши траты с реальными ценами рядом с вами.</p>
            <div className="mt-6 grid grid-cols-2 gap-2 md:grid-cols-4">
              {CITIES.map((c) => <button key={c} onClick={() => setCity(c)} className={cn("rounded-lg border px-3 py-2.5 text-sm transition-colors", city === c ? "border-primary bg-primary/10 font-semibold text-foreground" : "text-muted-foreground hover:border-primary/50")}>{c}</button>)}
            </div>
            <Button className="mt-8" onClick={() => { updateSession({ user: { city } }); setStep(1); }}>Дальше</Button>
          </section>
        )}
        {step === 1 && <UploadStep onDone={() => setStep(2)} />}
        {step === 2 && <ConfirmStep onDone={() => { updateSession({ onboarded: true }); navigate({ to: "/dashboard" }); }} />}
      </div>
    </div>
  );
}

function ConfirmStep({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const income = useQuery(q.income);
  const obl = useQuery(q.obligations);
  const ci = useMutation({ mutationFn: (v: { id: string; c: boolean }) => api.confirmIncome(v.id, v.c), onSuccess: () => qc.invalidateQueries({ queryKey: ["income"] }) });
  const co = useMutation({ mutationFn: (v: { id: string; c: boolean }) => api.confirmObligation(v.id, v.c), onSuccess: () => qc.invalidateQueries({ queryKey: ["obligations"] }) });

  const Row = ({ id, name, amount, day, checked, on }: { id: string; name: string; amount: number; day: number; checked: boolean; on: (c: boolean) => void }) => (
    <label htmlFor={id} className="flex cursor-pointer items-center gap-3 rounded-lg border p-3">
      <Checkbox id={id} checked={checked} onCheckedChange={(c) => on(!!c)} />
      <span className="flex-1 text-sm text-foreground">{name}<span className="block text-xs text-muted-foreground">каждое {day} число</span></span>
      <span className="num text-sm font-semibold text-foreground">{formatMoney(amount)}</span>
    </label>
  );
  return (
    <section className="surface p-6 md:p-8">
      <h1 className="text-2xl text-foreground">Нашли в выписке — подтвердите</h1>
      <p className="mt-2 text-sm text-muted-foreground">Отметьте то, что действительно повторяется каждый месяц. Это основа прогноза.</p>
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">Доход</h2>
      {income.isLoading ? <Loading /> : <div className="space-y-2">{income.data?.map((i) => <Row key={i.id} id={i.id} name={i.name} amount={i.amount} day={i.dayOfMonth} checked={i.confirmed} on={(c) => ci.mutate({ id: i.id, c })} />)}</div>}
      <h2 className="mb-2 mt-6 text-sm font-semibold text-foreground">Обязательные платежи</h2>
      {obl.isLoading ? <Loading /> : <div className="space-y-2">{obl.data?.map((o) => <Row key={o.id} id={o.id} name={o.name} amount={o.amount} day={o.dayOfMonth} checked={o.confirmed} on={(c) => co.mutate({ id: o.id, c })} />)}</div>}
      <Button className="mt-8" onClick={onDone}>Показать мой прогноз</Button>
    </section>
  );
}
