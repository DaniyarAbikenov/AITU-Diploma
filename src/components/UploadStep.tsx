import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Lock } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { api } from "@/api/client";
import type { ImportReport } from "@/api/types";
import { formatDate } from "@/lib/format";
import { cn } from "@/lib/utils";

export function UploadStep({ onDone }: { onDone: () => void }) {
  const [bank, setBank] = useState("Kaspi Bank");
  const [file, setFile] = useState<File | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState(0);
  const [report, setReport] = useState<ImportReport | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const qc = useQueryClient();
  const mut = useMutation({ mutationFn: () => api.importStatement(bank), onSuccess: (r) => { setReport(r); qc.invalidateQueries(); } });

  function start(f: File) {
    setFile(f); setProgress(5);
    const id = setInterval(() => setProgress((p) => { if (p >= 95) { clearInterval(id); mut.mutate(); return 100; } return p + 9; }), 120);
  }

  return (
    <section className="surface p-6 md:p-8">
      <h1 className="text-2xl text-foreground">Загрузите выписку</h1>
      <p className="mt-2 text-sm text-muted-foreground">PDF за последние 3–6 месяцев. Мы сами найдём доход, кредиты и регулярные платежи.</p>
      <div className="mt-6 grid gap-3 md:grid-cols-2">
        <Select value={bank} onValueChange={setBank}><SelectTrigger aria-label="Банк"><SelectValue /></SelectTrigger><SelectContent>{["Kaspi Bank", "Halyk Bank", "Freedom Bank", "Jusan Bank", "Bank RBK"].map((b) => <SelectItem key={b} value={b}>{b}</SelectItem>)}</SelectContent></Select>
        <Select defaultValue="new"><SelectTrigger aria-label="Счёт"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="new">Новый счёт</SelectItem><SelectItem value="acc-kaspi">Kaspi Gold</SelectItem><SelectItem value="acc-halyk">Halyk карта</SelectItem></SelectContent></Select>
      </div>
      {!report ? (
        <div
          onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
          onDrop={(e) => { e.preventDefault(); setDrag(false); const f = e.dataTransfer.files[0]; if (f) start(f); }}
          className={cn("mt-4 flex flex-col items-center gap-3 rounded-xl border-2 border-dashed p-10 text-center transition-colors", drag ? "border-primary bg-primary/5" : "border-border")}
        >
          <FileUp className="size-8 text-primary" aria-hidden />
          {file ? (
            <div className="w-full max-w-xs space-y-2"><p className="text-sm text-foreground">{file.name}</p><Progress value={progress} aria-label="Прогресс разбора" /><p className="text-xs text-muted-foreground">{progress < 100 ? "Читаем операции…" : "Определяем категории…"}</p></div>
          ) : (
            <>
              <p className="text-sm text-foreground">Перетащите PDF сюда или</p>
              <Button variant="outline" onClick={() => input.current?.click()}>Выбрать файл</Button>
              <input ref={input} type="file" accept="application/pdf" className="sr-only" onChange={(e) => { const f = e.target.files?.[0]; if (f) start(f); }} />
              <Button variant="link" size="sm" onClick={() => start(new File(["demo"], "kaspi_statement_demo.pdf"))}>Нет выписки под рукой? Взять демо</Button>
            </>
          )}
        </div>
      ) : (
        <div className="mt-4 rounded-xl bg-ok-soft p-5">
          <p className="font-display text-lg text-foreground">Разобрано {report.parsed} операций</p>
          <p className="mt-1 text-sm text-foreground/80">{report.needsReview} требуют проверки категории · период {formatDate(report.period.from)} — {formatDate(report.period.to, true)}</p>
          <Button className="mt-4" onClick={onDone}>Дальше</Button>
        </div>
      )}
      <details className="mt-5 text-sm text-muted-foreground">
        <summary className="cursor-pointer text-primary">Как скачать выписку в Kaspi</summary>
        <ol className="mt-2 list-decimal space-y-1 pl-5"><li>Откройте Kaspi.kz → «Мой банк».</li><li>Выберите карту Kaspi Gold → «Выписка».</li><li>Укажите период (лучше 6 месяцев) и формат PDF.</li><li>Нажмите «Скачать» и загрузите файл сюда.</li></ol>
      </details>
      <p className="mt-4 flex items-start gap-2 text-xs text-muted-foreground"><Lock className="mt-0.5 size-3.5 shrink-0" aria-hidden />Файл разбирается на нашем сервере и удаляется сразу после извлечения операций. Мы не передаём данные третьим лицам и не используем сторонние аналитические сервисы.</p>
    </section>
  );
}

