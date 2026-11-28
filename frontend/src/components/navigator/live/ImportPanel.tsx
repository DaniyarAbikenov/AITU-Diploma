import { useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileUp, Lock } from "lucide-react";
import { api } from "@/api/client";
import type { ImportPreview, ImportReport } from "@/api/types";
import { bankName, ru } from "@/i18n/ru";
import { formatDay } from "@/lib/navigator-live";
import { moneyIn } from "../model";
import { Panel, Progress } from "../shared";
import { confirmed } from "./hooks";

const t = ru.imp;
const BANKS = ["Kaspi Bank", "Halyk Bank", "Freedom Bank"];

/** PDF statement import: read → preview with the target account (number from the header or the user's choice) →
 * confirm → report. Nothing is written before the confirmation. */
export function ImportPanel({ onDone }: { onDone?: (r: ImportReport) => void }) {
  const qc = useQueryClient();
  const [bank, setBank] = useState(BANKS[0]),
    [file, setFile] = useState<File | null>(null),
    [drag, setDrag] = useState(false),
    [preview, setPreview] = useState<ImportPreview | null>(null),
    [target, setTarget] = useState("new"),
    [report, setReport] = useState<ImportReport | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const read = useMutation({
    mutationFn: (f: File) => api.previewStatement(bank, f),
    onSuccess: (p) => {
      setPreview(p);
      setTarget(p.suggestedAccountId ?? "new");
    },
  });
  const run = useMutation({
    mutationFn: (v: { f: File | null; target: string }) =>
      api.importStatement(bank, v.f ?? undefined, v.target),
    onSuccess: (r) => {
      setReport(r);
      setPreview(null);
      qc.invalidateQueries();
      onDone?.(r);
    },
  });
  const start = (f: File) => {
    run.reset();
    read.reset();
    setReport(null);
    setFile(f);
    read.mutate(f);
  };
  const busy = read.isPending || run.isPending;
  return (
    <Panel title={t.title}>
      <p className="nav-small">{t.text}</p>
      <label className="nav-field">
        {t.bank}
        <select value={bank} onChange={(e) => setBank(e.target.value)}>
          {BANKS.map((b) => (
            <option key={b} value={b}>
              {bankName(b)}
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
            {report.accountName && <p className="nav-small">{t.linkedTo(report.accountName)}</p>}
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
      ) : preview ? (
        <div className="nav-note">
          <div>
            <p>
              <strong>{t.previewTitle}</strong>
            </p>
            <p className="nav-small">
              {t.inStatement(bankName(preview.bank), preview.accountName, preview.numberMask ?? "")}
            </p>
            <p className="nav-small">
              {t.summary(
                preview.operations,
                preview.periodFrom ? formatDay(preview.periodFrom) : "—",
                preview.periodTo ? formatDay(preview.periodTo) : "—",
              )}
            </p>
            {preview.closingBalance != null && (
              <p className="nav-small">
                {t.closing(moneyIn(preview.closingBalance, preview.currency))}
              </p>
            )}
            <label className="nav-field">
              {t.target}
              <select value={target} onChange={(e) => setTarget(e.target.value)}>
                {preview.accounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {bankName(a.bank)} · {a.name}
                    {a.numberMask ? ` ${a.numberMask}` : ""} ({a.currency})
                  </option>
                ))}
                <option value="new">{t.newAccount}</option>
              </select>
            </label>
            <p className={preview.matchedBy === "number" ? "nav-small" : "nav-warning"}>
              {preview.matchedBy === "number"
                ? t.byNumber
                : preview.matchedBy === "name"
                  ? t.byName
                  : t.noMatch}
            </p>
            {preview.warnings?.map((w) => (
              <p key={w} className="nav-small nav-danger">
                {w}
              </p>
            ))}
            <div className="nav-actions">
              <button
                className="nav-primary"
                disabled={busy}
                onClick={() => run.mutate({ f: file, target })}
              >
                {t.confirm}
              </button>
              <button className="nav-secondary" disabled={busy} onClick={() => setPreview(null)}>
                {t.cancel}
              </button>
            </div>
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
          {busy ? (
            <>
              <p>{file?.name}</p>
              <Progress value={60} label="Прогресс разбора" />
              <p className="nav-small">{read.isPending ? t.reading2 : t.categorizing}</p>
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
                onClick={() =>
                  confirmed(t.syntheticConfirm) && run.mutate({ f: null, target: "auto" })
                }
              >
                {t.synthetic}
              </button>
            </>
          )}
        </div>
      )}
      {(read.isError || run.isError) && (
        <p className="nav-error" role="alert">
          {(read.error ?? run.error)?.message}
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
