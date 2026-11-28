import { Info } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import { formatDate } from "@/lib/format";

/** Every estimate shows its date and model version (product honesty requirement). */
export function EstimateNote({ asOf, model }: { asOf: string; model: string }) {
  return (
    <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
      <Info className="size-3.5" aria-hidden /> Оценка на {formatDate(asOf, true)} · модель {model}
    </p>
  );
}

export function Loading({ rows = 3, className }: { rows?: number; className?: string }) {
  return (
    <div className={cn("space-y-3", className)} aria-busy="true" aria-label="Загрузка">
      {Array.from({ length: rows }, (_, i) => (
        <Skeleton key={i} className="h-5 w-full" style={{ width: `${90 - i * 12}%` }} />
      ))}
    </div>
  );
}
