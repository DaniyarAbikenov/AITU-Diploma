import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Lock } from "lucide-react";
import { api } from "@/api/client";
import type { ImportReport } from "@/api/types";
import { ru } from "@/i18n/ru";
import { formatDay } from "@/lib/navigator-live";
import { Panel, Progress } from "../shared";
import { confirmed } from "./hooks";

const t = ru.imp;
const BANKS = ["Kaspi Bank", "Halyk Bank", "Freedom Bank"];

/** PDF statement import with progress and a report (parsed, to review, period, warnings). */
export function ImportPanel({ onDone }: { onDone?: (r: ImportReport) => void }) {
  const qc = useQueryClient();
  const [bank, setBank] = useState(BANKS[0]),
    [file, setFile] = useState<File | null>(null),
    [drag, setDrag] = useState(false),
    [progress, setProgress] = useState(0),
    [report, setReport] = useState<ImportReport | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const run = useMutation({
    mutationFn: (f: File | null) => api.importStatement(bank, f ?? undefined),
    onSuccess: (r) => {
      setReport(r);
      qc.invalidateQueries();
      onDone?.(r);
    },
    onSettled: () => setProgress(100),
  });
  const start = (f: File | null) => {
    run.reset();
    setReport(null);
    setFile(f);
    setProgress(10);
    const id = setInterval(() => setProgress((v) => (v >= 90 ? 90 : v + 10)), 150);
    run.mutate(f, { onSettled: () => clearInterval(id) });
  };
  return (
    <Panel title={t.title}>
      <p className="nav-small">{t.text}</p>
      <label className="nav-field">
        {t.bank}
        <select value={bank} onChange={(e) => setBank(e.target.value)}>
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {ru.banks[b] ?? b}
            </option>
          ))}
        </select>
      </label>
      {report ? (
        <div className="nav-note" role="status">
          <div>
            <p>
              <strong>{report.parsed ? t.added(report.parsed) : t.none}</strong>
            </p>
            <p className="nav-small">
              {t.review(report.needsReview)} ·{" "}
              {t.period(formatDay(report.period.from), formatDay(report.period.to))}
            </p>
            {report.warnings?.map((w) => (
              <p key={w} className="nav-small nav-danger">
                {w}
              </p>
            ))}
            <p className="nav-small">{t.nextStep}</p>
            <button className="nav-secondary" onClick={() => setReport(null)}>
              {t.again}
            </button>
          </div>
        </div>
      ) : (
        <div
          className={`nav-dropzone ${drag ? "drag" : ""}`}
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            const f = e.dataTransfer.files[0];
            if (f) start(f);
          }}
        >
          <FileUp size={30} aria-hidden />
          {run.isPending ? (
            <>
              <p>{file?.name}</p>
              <Progress value={progress} label="Прогресс разбора" />
              <p className="nav-small">{progress < 60 ? t.reading : t.categorizing}</p>
            </>
          ) : (
            <>
              <p>{t.drop}</p>
              <button
                className="nav-secondary"
                type="button"
                onClick={() => input.current?.click()}
              >
                {t.choose}
              </button>
              <input
                ref={input}
                type="file"
                accept="application/pdf"
                aria-label={t.choose}
                style={{ position: "absolute", width: 1, height: 1, opacity: 0 }}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  if (f) start(f);
                  e.target.value = "";
                }}
              />
              <button
                className="nav-text-button"
                type="button"
                onClick={() => confirmed(t.syntheticConfirm) && start(null)}
              >
                {t.synthetic}
              </button>
            </>
          )}
        </div>
      )}
      {run.isError && (
        <p className="nav-error" role="alert">
          {run.error.message}
        </p>
      )}
      <details className="nav-small">
        <summary>{t.howTo}</summary>
        <ol>
          {t.howSteps.map((s) => (
            <li key={s}>{s}</li>
          ))}
        </ol>
      </details>
      <p className="nav-small">
        <Lock size={13} /> {t.privacy}
      </p>
    </Panel>
  );
}
