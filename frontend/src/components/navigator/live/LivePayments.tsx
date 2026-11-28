import { useState } from "react";
import { Plus } from "lucide-react";
import { api } from "@/api/client";
import type { Account, Decision, IncomeSource, Obligation, PlannedPayment } from "@/api/types";
import { ru } from "@/i18n/ru";
import { formatDay } from "@/lib/navigator-live";
import { todayIn } from "@/lib/safe-to-spend";
import { compact, money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { ObligationDialog, PlannedDialog, SettleDialog, FormError } from "./forms";
import { confirmed, useWrite } from "./hooks";
import { RuleLine } from "./RuleEditor";

const t = ru.live.calendar;
const p = ru.crud.payments;

const status = (r: { confirmed: boolean; rejected?: boolean }) =>
  r.rejected ? "rejected" : r.confirmed ? "confirmed" : "pending";

function DecisionPill({ r }: { r: { confirmed: boolean; rejected?: boolean } }) {
  const s = status(r);
  return (
    <span className={`nav-pill ${s === "confirmed" ? "ok" : s === "rejected" ? "off" : "warn"}`}>
      {t[s]}
    </span>
  );
}

function DecisionButtons({
  r,
  busy,
  decide,
}: {
  r: { confirmed: boolean; rejected?: boolean };
  busy: boolean;
  decide: (d: Decision) => void;
}) {
  return (
    <>
      {!r.confirmed && (
        <button className="nav-primary" disabled={busy} onClick={() => decide({ confirmed: true })}>
          {ru.common.confirm}
        </button>
      )}
      {r.rejected ? (
        <button
          className="nav-secondary"
          disabled={busy}
          onClick={() => decide({ rejected: false })}
        >
          {ru.common.restore}
        </button>
      ) : (
        <button
          className="nav-secondary"
          disabled={busy}
          onClick={() => decide({ rejected: true })}
        >
          {ru.common.reject}
        </button>
      )}
    </>
  );
}

/** The user's own amount for the current month, over the rule (empty = back to the rule). */
function MonthOverride({ id, notify }: { id: string; notify: (m: string) => void }) {
  const month = todayIn().slice(0, 7);
  const save = useWrite(
    (amount: number | null) => api.setOverride("obligation", id, month, amount),
    () => notify(ru.crud.saved),
  );
  return (
    <details className="nav-small">
      <summary>{ru.rules.monthAmount}</summary>
      <form
        className="nav-actions"
        onSubmit={(e) => {
          e.preventDefault();
          const v = String(new FormData(e.currentTarget).get("amount") ?? "").trim();
          save.mutate(v === "" ? null : Number(v));
        }}
      >
        <label className="nav-field">
          {ru.rules.monthAmountField(month)}
          <input name="amount" type="number" min={0} step={1} />
        </label>
        <button className="nav-secondary" disabled={save.isPending}>
          {ru.common.save}
        </button>
      </form>
      <FormError error={save.error} />
    </details>
  );
}

/** Monthly obligations: confirm / reject detected ones, add, edit and delete (Calendar and Profile). */
export function ObligationsPanel({
  obligations,
  notify,
}: {
  obligations: Obligation[];
  notify: (m: string) => void;
}) {
  const [editing, setEditing] = useState<Obligation | "new" | null>(null),
    [showRejected, setShowRejected] = useState(false);
  const decide = useWrite(
    ({ id, d }: { id: string; d: Decision }) => api.decideObligation(id, d),
    () => notify(ru.crud.saved),
  );
  const remove = useWrite(
    (id: string) => api.deleteObligation(id),
    () => notify(ru.crud.deleted),
  );
  const active = obligations.filter((o) => !o.rejected),
    rejected = obligations.filter((o) => o.rejected);
  const row = (o: Obligation) => (
    <div className="nav-live-row" key={o.id}>
      <div>
        <strong>{o.name}</strong> <DecisionPill r={o} />
        <p className="nav-small">
          {ru.obligationKind[o.kind]} · {t.monthly(o.dayOfMonth)}
          {o.endsAt ? ` · до ${o.endsAt}` : ""}
          {o.debtLeft != null ? ` · остаток долга ${money(o.debtLeft)}` : ""}
        </p>
        <RuleLine rule={o.rule} />
        {o.rule && <MonthOverride id={o.id} notify={notify} />}
      </div>
      <strong>
        {o.rule && o.rule.amountThisMonth == null
          ? "—"
          : `−${money(o.rule?.amountThisMonth ?? o.amount)}`}
      </strong>
      <div className="nav-actions">
        <DecisionButtons
          r={o}
          busy={decide.isPending}
          decide={(d) => decide.mutate({ id: o.id, d })}
        />
        <button className="nav-text-button" onClick={() => setEditing(o)}>
          Изменить
        </button>
        <button
          className="nav-text-button"
          disabled={remove.isPending}
          onClick={() => confirmed(p.deleteConfirm(o.name)) && remove.mutate(o.id)}
        >
          {p.delete}
        </button>
      </div>
    </div>
  );
  return (
    <Panel
      title={p.obligationsTitle}
      action={
        <button className="nav-primary" onClick={() => setEditing("new")}>
          <Plus size={16} /> {p.add}
        </button>
      }
    >
      <p className="nav-small">{t.hint}</p>
      {active.length ? (
        <div className="nav-live-list">{active.map(row)}</div>
      ) : (
        <Missing action={p.add} onAction={() => setEditing("new")}>
          {p.emptyObligations}
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
      <FormError error={decide.error || remove.error} />
      <ObligationDialog value={editing} onClose={() => setEditing(null)} notify={notify} />
    </Panel>
  );
}

const incomeAmount = (i: IncomeSource) =>
  i.amountMin != null && i.amountMax != null
    ? t.range(compact(i.amountMin), compact(i.amountMax))
    : money(i.amount);

/** Income payouts (two a month and an amount range are allowed). */
export function IncomesPanel({
  incomes,
  onEdit,
  notify,
}: {
  incomes: IncomeSource[];
  onEdit: (i: IncomeSource | "new") => void;
  notify: (m: string) => void;
}) {
  const decide = useWrite(
    ({ id, d }: { id: string; d: Decision }) => api.decideIncome(id, d),
    () => notify(ru.crud.saved),
  );
  const remove = useWrite(
    (id: string) => api.deleteIncome(id),
    () => notify(ru.crud.deleted),
  );
  return (
    <Panel
      title="Доходы"
      action={
        <button className="nav-primary" onClick={() => onEdit("new")}>
          <Plus size={16} /> {t.addIncome}
        </button>
      }
    >
      <p className="nav-small">{t.incomeHint}</p>
      {incomes.length ? (
        <div className="nav-live-list">
          {incomes.map((i) => (
            <div className="nav-live-row" key={i.id}>
              <div>
                <strong>{i.name}</strong> <DecisionPill r={i} />
                <p className="nav-small">{t.monthly(i.dayOfMonth)}</p>
              </div>
              <strong className="nav-positive">+{incomeAmount(i)}</strong>
              <div className="nav-actions">
                <DecisionButtons
                  r={i}
                  busy={decide.isPending}
                  decide={(d) => decide.mutate({ id: i.id, d })}
                />
                <button className="nav-text-button" onClick={() => onEdit(i)}>
                  Изменить
                </button>
                <button
                  className="nav-text-button"
                  disabled={remove.isPending}
                  onClick={() => confirmed(p.deleteIncomeConfirm(i.name)) && remove.mutate(i.id)}
                >
                  {p.delete}
                </button>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <Missing action={t.addIncome} onAction={() => onEdit("new")}>
          {t.empty}
        </Missing>
      )}
      <FormError error={decide.error || remove.error} />
    </Panel>
  );
}

/** One-off and yearly planned items with partial payment. */
export function PlannedPanel({
  planned,
  accounts,
  today,
  notify,
}: {
  planned: PlannedPayment[];
  accounts: Account[];
  today: string;
  notify: (m: string) => void;
}) {
  const [editing, setEditing] = useState<PlannedPayment | "new" | null>(null),
    [paying, setPaying] = useState<PlannedPayment | null>(null);
  const update = useWrite(
    ({ id, cancelled }: { id: string; cancelled: boolean }) => api.updatePlanned(id, { cancelled }),
    () => notify(ru.crud.saved),
  );
  const remove = useWrite(
    (id: string) => api.deletePlanned(id),
    () => notify(ru.crud.deleted),
  );
  return (
    <Panel
      title={p.plannedTitle}
      action={
        <button className="nav-primary" onClick={() => setEditing("new")}>
          <Plus size={16} /> {p.addPlanned}
        </button>
      }
    >
      <p className="nav-small">{p.plannedHint}</p>
      {planned.length ? (
        <div className="nav-live-list">
          {planned.map((x) => {
            const overdue = x.status !== "cancelled" && x.left > 0 && (x.dueTo ?? x.dueOn) < today;
            return (
              <div className="nav-live-row" key={x.id}>
                <div>
                  <strong>{x.name}</strong>{" "}
                  <span
                    className={`nav-pill ${x.status === "paid" ? "ok" : x.status === "cancelled" ? "off" : "warn"}`}
                  >
                    {p.status[x.status]}
                  </span>
                  <p className="nav-small">
                    {formatDay(x.dueOn)}
                    {x.dueTo ? ` – ${formatDay(x.dueTo)}` : ""} ·{" "}
                    {x.repeat === "yearly" ? p.yearly : p.once}
                    {x.mandatory ? ` · ${p.mandatory.toLowerCase()}` : ""}
                    {x.movable ? ` · ${p.movable.toLowerCase()}` : ""}
                    {x.status === "partial" ? ` · ${p.left(money(x.left))}` : ""}
                  </p>
                  <RuleLine rule={x.rule} />
                  {overdue && <p className="nav-small nav-danger">{p.overdue}</p>}
                </div>
                <strong className={x.direction === "income" ? "nav-positive" : ""}>
                  {x.direction === "income" ? "+" : "−"}
                  {money(x.amount)}
                </strong>
                <div className="nav-actions">
                  {x.status !== "paid" && x.status !== "cancelled" && (
                    <button className="nav-primary" onClick={() => setPaying(x)}>
                      {p.pay}
                    </button>
                  )}
                  <button className="nav-text-button" onClick={() => setEditing(x)}>
                    Изменить
                  </button>
                  {x.status !== "paid" && (
                    <button
                      className="nav-text-button"
                      disabled={update.isPending}
                      onClick={() =>
                        update.mutate({ id: x.id, cancelled: x.status !== "cancelled" })
                      }
                    >
                      {x.status === "cancelled" ? p.uncancel : p.cancel}
                    </button>
                  )}
                  <button
                    className="nav-text-button"
                    disabled={remove.isPending}
                    onClick={() => confirmed(p.deletePlannedConfirm(x.name)) && remove.mutate(x.id)}
                  >
                    {p.delete}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <Missing action={p.addPlanned} onAction={() => setEditing("new")}>
          {p.emptyPlanned}
        </Missing>
      )}
      <FormError error={update.error || remove.error} />
      <PlannedDialog
        value={editing}
        accounts={accounts}
        onClose={() => setEditing(null)}
        notify={notify}
      />
      <SettleDialog
        item={paying}
        accounts={accounts}
        today={today}
        onClose={() => setPaying(null)}
        notify={notify}
      />
    </Panel>
  );
}
