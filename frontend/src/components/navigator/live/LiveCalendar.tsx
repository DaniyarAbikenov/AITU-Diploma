import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus } from "lucide-react";
import { api } from "@/api/client";
import type { Decision, IncomeIn, IncomeSource, Obligation } from "@/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ru } from "@/i18n/ru";
import { formatMonth } from "@/lib/navigator-live";
import { daysInMonth, monthlyDate } from "@/lib/safe-to-spend";
import { compact, money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import type { LiveProps } from "./types";

const t = ru.live.calendar;
type Event = { type: "income"; row: IncomeSource } | { type: "payment"; row: Obligation };

const status = (r: { confirmed: boolean; rejected?: boolean }) =>
  r.rejected ? "rejected" : r.confirmed ? "confirmed" : "pending";

function StatusPill({ r }: { r: { confirmed: boolean; rejected?: boolean } }) {
  const s = status(r);
  return (
    <span className={`nav-pill ${s === "confirmed" ? "ok" : s === "rejected" ? "off" : "warn"}`}>
      {t[s]}
    </span>
  );
}

const incomeAmount = (i: IncomeSource) =>
  i.amountMin != null && i.amountMax != null
    ? t.range(compact(i.amountMin), compact(i.amountMax))
    : money(i.amount);

export function LiveCalendar({ obligations, incomes, today, notify }: LiveProps) {
  const qc = useQueryClient();
  const [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<IncomeSource | "new" | null>(null),
    [showRejected, setShowRejected] = useState(false);
  const decide = useMutation({
    mutationFn: ({ e, d }: { e: Event; d: Decision }): Promise<unknown> =>
      e.type === "income" ? api.decideIncome(e.row.id, d) : api.decideObligation(e.row.id, d),
    onSuccess: (_, { e }) => {
      qc.invalidateQueries({ queryKey: [e.type === "income" ? "income" : "obligations"] });
      qc.invalidateQueries({ queryKey: ["resilience"] });
      notify(ru.live.profile.saved);
    },
  });
  let y = +today.slice(0, 4),
    m = +today.slice(5, 7) + offset;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const days = daysInMonth(y, m),
    first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  const events: Event[] = [
    ...incomes.map((row) => ({ type: "income" as const, row })),
    ...obligations.map((row) => ({ type: "payment" as const, row })),
  ];
  const active = events.filter((e) => !e.row.rejected);
  const inMonth = active.filter(
    (e) => e.type === "income" || !e.row.endsAt || monthKey <= e.row.endsAt,
  );
  const byDay = (day: number) =>
    inMonth.filter((e) => +monthlyDate(y, m, e.row.dayOfMonth).slice(8) === day);
  const rejected = events.filter((e) => e.row.rejected);
  const row = (e: Event) => (
    <div className="nav-live-row" key={e.type + e.row.id}>
      <div>
        <strong>{e.row.name}</strong> <StatusPill r={e.row} />
        <p className="nav-small">
          {e.type === "income" ? "Доход" : ru.obligationKind[e.row.kind]} ·{" "}
          {t.monthly(e.row.dayOfMonth)}
          {e.type === "payment" && e.row.endsAt ? ` · до ${e.row.endsAt}` : ""}
        </p>
      </div>
      <strong className={e.type === "income" ? "nav-positive" : ""}>
        {e.type === "income" ? "+" + incomeAmount(e.row) : "−" + money(e.row.amount)}
      </strong>
      <div className="nav-actions">
        {!e.row.confirmed && (
          <button
            className="nav-primary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ e, d: { confirmed: true } })}
          >
            {ru.common.confirm}
          </button>
        )}
        {e.row.rejected ? (
          <button
            className="nav-secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ e, d: { rejected: false } })}
          >
            {ru.common.restore}
          </button>
        ) : (
          <button
            className="nav-secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ e, d: { rejected: true } })}
          >
            {ru.common.reject}
          </button>
        )}
        {e.type === "income" && (
          <button className="nav-text-button" onClick={() => setEditing(e.row)}>
            Изменить
          </button>
        )}
      </div>
    </div>
  );
  return (
    <>
      <Panel
        title={formatMonth(monthKey)}
        action={
          <div className="nav-actions">
            <button
              aria-label="Предыдущий месяц"
              disabled={offset <= 0}
              onClick={() => setOffset(offset - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              aria-label="Следующий месяц"
              disabled={offset >= 11}
              onClick={() => setOffset(offset + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        }
      >
        <p className="nav-small">{t.gridNote}</p>
        <div className="nav-calendar">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <strong key={d}>{d}</strong>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <span key={`blank${i}`} />
          ))}
          {Array.from({ length: days }, (_, i) => {
            const list = byDay(i + 1);
            return (
              <div
                key={i}
                className={`${list.length ? "has-event" : ""} ${list.some((e) => !e.row.confirmed) ? "pending-event" : ""}`}
              >
                <span>{i + 1}</span>
                {list.slice(0, 2).map((e) => (
                  <small key={e.type + e.row.id}>
                    {e.row.confirmed ? "" : "? "}
                    {e.row.name}
                  </small>
                ))}
                {list.length > 2 && <small>+{list.length - 2}</small>}
              </div>
            );
          })}
        </div>
      </Panel>
      <Panel
        title={t.title}
        action={
          <button className="nav-primary" onClick={() => setEditing("new")}>
            <Plus size={16} /> {t.addIncome}
          </button>
        }
      >
        <p className="nav-small">{t.hint}</p>
        {active.length ? (
          <div className="nav-live-list">{active.map(row)}</div>
        ) : (
          <Missing action={t.addIncome} onAction={() => setEditing("new")}>
            {t.empty}
          </Missing>
        )}
        {rejected.length > 0 && (
          <>
            <button className="nav-text-button" onClick={() => setShowRejected(!showRejected)}>
              {t.showRejected(rejected.length)}
            </button>
            {showRejected && <div className="nav-live-list">{rejected.map(row)}</div>}
          </>
        )}
      </Panel>
      <IncomeDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          notify(ru.live.profile.saved);
        }}
      />
    </>
  );
}

const num = (v: FormDataEntryValue | null) => (v === null || v === "" ? null : Number(v));

function IncomeDialog({
  value,
  onClose,
  onSaved,
}: {
  value: IncomeSource | "new" | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc = useQueryClient();
  const current = value && value !== "new" ? value : null;
  const save = useMutation({
    mutationFn: (v: IncomeIn) => (current ? api.updateIncome(current.id, v) : api.addIncome(v)),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["income"] });
      onSaved();
    },
  });
  const [error, setError] = useState("");
  return (
    <Dialog open={!!value} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="navigator nav-dialog">
        <DialogHeader>
          <DialogTitle>{current ? t.editIncome : t.addIncome}</DialogTitle>
          <DialogDescription>{t.incomeHint}</DialogDescription>
        </DialogHeader>
        <form
          className="nav-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const v: IncomeIn = {
              name: String(f.get("name")).trim(),
              dayOfMonth: Number(f.get("day")),
              amount: Number(f.get("amount")),
              amountMin: num(f.get("min")),
              amountMax: num(f.get("max")),
            };
            if (v.amountMin != null && v.amountMax != null && v.amountMin > v.amountMax) {
              setError("Минимум больше максимума.");
              return;
            }
            setError("");
            save.mutate(v);
          }}
        >
          <label className="nav-field">
            {t.incomeName}
            <input
              name="name"
              required
              maxLength={200}
              defaultValue={current?.name ?? "Зарплата"}
            />
          </label>
          <label className="nav-field">
            {t.incomeDay}
            <input
              name="day"
              type="number"
              min={1}
              max={31}
              required
              defaultValue={current?.dayOfMonth}
            />
          </label>
          <label className="nav-field">
            {t.incomeAmount}
            <input
              name="amount"
              type="number"
              min={1}
              step={1}
              required
              defaultValue={current?.amount}
            />
          </label>
          <label className="nav-field">
            {t.incomeMin}
            <input
              name="min"
              type="number"
              min={1}
              step={1}
              defaultValue={current?.amountMin ?? ""}
            />
          </label>
          <label className="nav-field">
            {t.incomeMax}
            <input
              name="max"
              type="number"
              min={1}
              step={1}
              defaultValue={current?.amountMax ?? ""}
            />
          </label>
          <button className="nav-primary" disabled={save.isPending}>
            {ru.common.save}
          </button>
          {(error || save.isError) && (
            <p className="nav-error" role="alert">
              {error || save.error?.message}
            </p>
          )}
        </form>
      </DialogContent>
    </Dialog>
  );
}
