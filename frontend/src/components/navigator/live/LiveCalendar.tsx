import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { api } from "@/api/client";
import type { IncomeIn, IncomeSource } from "@/api/types";
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
import { Panel } from "../shared";
import { IncomesPanel, ObligationsPanel, PlannedPanel } from "./LivePayments";
import type { LiveProps } from "./types";

const t = ru.live.calendar;
export function LiveCalendar({
  obligations,
  incomes,
  planned,
  accounts,
  today,
  notify,
}: LiveProps) {
  const [offset, setOffset] = useState(0),
    [editing, setEditing] = useState<IncomeSource | "new" | null>(null);
  let y = +today.slice(0, 4),
    m = +today.slice(5, 7) + offset;
  y += Math.floor((m - 1) / 12);
  m = ((m - 1) % 12) + 1;
  const monthKey = `${y}-${String(m).padStart(2, "0")}`;
  const days = daysInMonth(y, m),
    first = (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
  type Cell = { key: string; name: string; pending: boolean };
  const byDay = new Map<number, Cell[]>();
  const put = (day: number, c: Cell) => byDay.set(day, [...(byDay.get(day) ?? []), c]);
  for (const i of incomes.filter((x) => !x.rejected))
    put(+monthlyDate(y, m, i.dayOfMonth).slice(8), {
      key: "i" + i.id,
      name: i.name,
      pending: !i.confirmed,
    });
  for (const o of obligations.filter((x) => !x.rejected && (!x.endsAt || monthKey <= x.endsAt)))
    put(+monthlyDate(y, m, o.dayOfMonth).slice(8), {
      key: "o" + o.id,
      name: o.name,
      pending: !o.confirmed,
    });
  for (const pl of planned.filter(
    (x) => x.status !== "cancelled" && x.dueOn.slice(0, 7) === monthKey,
  ))
    put(+pl.dueOn.slice(8), { key: "p" + pl.id, name: pl.name, pending: pl.status !== "paid" });
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
            const list = byDay.get(i + 1) ?? [];
            return (
              <div
                key={i}
                className={`${list.length ? "has-event" : ""} ${list.some((e) => e.pending) ? "pending-event" : ""}`}
              >
                <span>{i + 1}</span>
                {list.slice(0, 2).map((e) => (
                  <small key={e.key}>
                    {e.pending ? "? " : ""}
                    {e.name}
                  </small>
                ))}
                {list.length > 2 && <small>+{list.length - 2}</small>}
              </div>
            );
          })}
        </div>
      </Panel>
      <IncomesPanel incomes={incomes} onEdit={setEditing} notify={notify} />
      <ObligationsPanel obligations={obligations} notify={notify} />
      <PlannedPanel planned={planned} accounts={accounts} today={today} notify={notify} />
      <IncomeDialog
        value={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          notify(ru.crud.saved);
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
