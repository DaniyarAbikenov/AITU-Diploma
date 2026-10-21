import type { ReactNode } from "react";
import { AlertTriangle, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Status } from "@/api/types";
import { formatDate } from "@/lib/format";

export function PageHeader({ eyebrow, headline, children }: { eyebrow: string; headline: ReactNode; children?: ReactNode }) {
  return (
    <header className="mb-6 flex flex-col gap-3 md:mb-8">
      <p className="text-xs font-semibold uppercase tracking-[0.18em] text-muted-foreground">{eyebrow}</p>
      <h1 className="max-w-3xl text-2xl font-medium leading-tight text-foreground md:text-[2rem] [&_.num]:font-display">{headline}</h1>
      {children}
    </header>
  );
}

export function Card({ title, aside, children, className }: { title?: ReactNode; aside?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("surface p-5 md:p-6", className)}>
      {(title || aside) && (
        <div className="mb-4 flex items-start justify-between gap-3">
          {title && <h2 className="font-display text-base font-medium text-card-foreground">{title}</h2>}
          {aside}
        </div>
      )}
      {children}
    </section>
  );
}

const STATUS = {
  ok: { icon: CheckCircle2, label: "В норме", cls: "bg-ok-soft text-ok" },
  warn: { icon: CircleAlert, label: "Внимание", cls: "bg-warn-soft text-foreground" },
  risk: { icon: AlertTriangle, label: "Риск", cls: "bg-risk-soft text-risk" },
} as const;

export function StatusPill({ status, label }: { status: Status; label?: string }) {
  const s = STATUS[status]; const Icon = s.icon;
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold", s.cls)}>
      <Icon className={cn("size-3.5", status === "warn" && "text-warn")} aria-hidden /> {label ?? s.label}
    </span>
  );
}
export function StatusDot({ status }: { status: Status }) {
  return <span aria-hidden className={cn("inline-block size-2.5 shrink-0 rounded-full", status === "ok" ? "bg-ok" : status === "warn" ? "bg-warn" : "bg-risk")} />;
}

/** Mandatory label for every prediction: "оценка · дата · модель". */
export function EstimateNote({ asOf, model }: { asOf: string; model: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5" aria-hidden /> Оценка на {formatDate(asOf, true)} · модель {model}
    </p>
  );
}

export function Loading({ rows = 3, className }: { rows?: number; className?: string }) {
  return <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Загрузка">{Array.from({ length: rows }, (_, i) => <Skeleton key={i} className="h-5 w-full" style={{ width: `${90 - i * 12}%` }} />)}</div>;
}
export function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return (
    <div role="alert" className="flex flex-col items-start gap-3 rounded-lg bg-risk-soft p-4 text-sm text-foreground">
      <p><strong>Не удалось загрузить данные.</strong> Проверьте соединение и попробуйте ещё раз.</p>
      {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Повторить</Button>}
    </div>
  );
}
export function EmptyState({ title, text, action }: { title: string; text: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center">
      <p className="font-display text-base text-foreground">{title}</p>
      <p className="max-w-sm text-sm text-muted-foreground">{text}</p>
      {action}
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="num mt-1 text-xl font-semibold text-foreground">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

const SOURCE = {
  fact: { label: "Факт", cls: "bg-ok-soft text-ok" },
  calc: { label: "Расчёт", cls: "bg-muted text-foreground" },
  forecast: { label: "Прогноз", cls: "bg-warn-soft text-foreground" },
  demo: { label: "Демо-данные", cls: "bg-risk-soft text-risk" },
} as const;

/** Where the numbers on a page come from: a kind badge and a plain-language "how it is computed" note. */
export function SourceNote({ kind, from, how }: { kind: keyof typeof SOURCE; from: string; how: string }) {
  const s = SOURCE[kind];
  return (
    <details className="group text-xs text-muted-foreground">
      <summary className="flex cursor-pointer list-none items-center gap-2">
        <span className={cn("rounded-full px-2 py-0.5 font-semibold", s.cls)}>{s.label}</span>
        <span className="underline decoration-dotted underline-offset-2">Откуда цифры?</span>
      </summary>
      <dl className="mt-2 max-w-2xl space-y-1 rounded-lg border bg-card p-3">
        <div><dt className="inline font-semibold text-foreground">Данные: </dt><dd className="inline">{from}</dd></div>
        <div><dt className="inline font-semibold text-foreground">Как считается: </dt><dd className="inline">{how}</dd></div>
      </dl>
    </details>
  );
}
