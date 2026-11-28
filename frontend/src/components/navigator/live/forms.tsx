import { useState, type ReactNode } from "react";
import { useQuery } from "@tanstack/react-query";
import { confirmed, useWrite } from "./hooks";
import { api, q } from "@/api/client";
import type {
  Account,
  Obligation,
  ObligationIn,
  PlannedIn,
  PlannedPayment,
  Transaction,
  TxKind,
} from "@/api/types";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { bankName, ru } from "@/i18n/ru";
import { formatDay, txKind } from "@/lib/navigator-live";
import { addDays } from "@/lib/safe-to-spend";
import { money } from "../model";

const c = ru.crud;
const KINDS = Object.keys(ru.txKind) as TxKind[];
const OB_KINDS = Object.keys(ru.obligationKind) as Obligation["kind"][];
const num = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === "" ? null : Number(v);
const str = (v: FormDataEntryValue | null) => (v === null ? "" : String(v).trim());

export function FormError({ error }: { error: Error | null | undefined | string }) {
  if (!error) return null;
  return (
    <p className="nav-error" role="alert">
      {typeof error === "string" ? error : `${error.message}. ${c.networkKeep}`}
    </p>
  );
}

function Shell({
  open,
  title,
  hint,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  hint: string;
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="navigator nav-dialog">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{hint}</DialogDescription>
        </DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  );
}

function CategorySelect({ value, name = "category" }: { value?: string | null; name?: string }) {
  const cats = useQuery(q.categories);
  return (
    <label className="nav-field">
      {c.tx.category}
      <select name={name} defaultValue={value ?? ""}>
        <option value="">—</option>
        {(cats.data ?? []).map((x) => (
          <option key={x.id} value={x.id}>
            {x.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function AccountSelect({
  accounts,
  value,
  optional = false,
}: {
  accounts: Account[];
  value?: string | null;
  optional?: boolean;
}) {
  return (
    <label className="nav-field">
      {c.tx.account}
      <select
        name="account"
        defaultValue={value ?? (optional ? "" : accounts[0]?.id)}
        required={!optional}
      >
        {optional && <option value="">{c.payments.noAccount}</option>}
        {accounts.map((a) => (
          <option key={a.id} value={a.id}>
            {bankName(a.bank)} · {a.name}
          </option>
        ))}
      </select>
    </label>
  );
}

/** Add a manual operation or edit one (manual: directly; imported: as a correction with history). */
export function TxDialog({
  tx,
  open,
  accounts,
  today,
  onClose,
  notify,
}: {
  tx: Transaction | null;
  open: boolean;
  accounts: Account[];
  today: string;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const [error, setError] = useState("");
  const [showHistory, setShowHistory] = useState(false);
  const done = (msg: string) => () => {
    setError("");
    onClose();
    notify(msg);
  };
  const manual = !tx || tx.source === "manual";
  const save = useWrite(async (f: FormData) => {
    const kind = str(f.get("kind")) as TxKind;
    const abs = Number(f.get("amount"));
    const sign = tx && !manual ? Math.sign(tx.amount) || -1 : kind.startsWith("income") ? 1 : -1;
    const fields = {
      amount: sign * abs,
      date: str(f.get("date")),
      category: str(f.get("category")) || undefined,
      note: str(f.get("note")) || null,
    };
    if (!tx)
      return api.createTx({
        ...fields,
        accountId: str(f.get("account")),
        merchant: str(f.get("merchant")),
        kind,
      });
    const out = await api.updateTx(tx.id, {
      ...fields,
      ...(manual ? { merchant: str(f.get("merchant")), accountId: str(f.get("account")) } : {}),
    });
    const rule = f.get("rule") === "on";
    if (kind !== txKind(tx) || rule) return api.setTxKind(tx.id, kind, rule);
    return out;
  }, done(c.saved));
  const remove = useWrite((id: string) => api.deleteTx(id), done(c.deleted));
  const voiding = useWrite(
    (v: { id: string; voided: boolean }) => api.voidTx(v.id, v.voided),
    done(c.saved),
  );
  const history = useQuery({ ...q.txHistory(tx?.id ?? ""), enabled: !!tx && showHistory });
  const busy = save.isPending || remove.isPending || voiding.isPending;
  return (
    <Shell
      open={open}
      title={tx ? c.tx.editTitle : c.tx.addTitle}
      hint={tx ? (manual ? c.tx.hintManual : c.tx.hintImport) : c.tx.futureHint}
      onClose={onClose}
    >
      {!accounts.length ? (
        <p className="nav-warning">{c.tx.accountRequired}</p>
      ) : (
        <form
          className="nav-form"
          key={tx?.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            if (!(Number(f.get("amount")) > 0)) return setError(c.tx.amountZero);
            setError("");
            save.mutate(f);
          }}
        >
          {tx?.original && (
            <p className="nav-small">
              {c.tx.original(money(tx.original.amount), formatDay(tx.original.date))}
            </p>
          )}
          <label className="nav-field">
            {ru.live.transactions.kind}
            <select name="kind" defaultValue={tx ? txKind(tx) : "expense"}>
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {ru.txKind[k]}
                </option>
              ))}
            </select>
          </label>
          <label className="nav-field">
            {ru.fx.amountInAccount}
            <input
              name="amount"
              type="number"
              min={1}
              step={1}
              required
              inputMode="numeric"
              defaultValue={tx ? Math.abs(tx.amount) : ""}
            />
          </label>
          <label className="nav-field">
            {c.tx.date}
            <input name="date" type="date" required max={today} defaultValue={tx?.date ?? today} />
          </label>
          {manual && <AccountSelect accounts={accounts} value={tx?.accountId} />}
          {manual ? (
            <label className="nav-field">
              {c.tx.description}
              <input
                name="merchant"
                required
                maxLength={200}
                defaultValue={tx?.merchant ?? ""}
                placeholder={c.tx.descriptionHint}
              />
            </label>
          ) : (
            <p>
              <strong>{tx!.merchant}</strong>
            </p>
          )}
          <CategorySelect value={tx?.categoryId} />
          <label className="nav-field">
            {c.tx.note}
            <input name="note" maxLength={200} defaultValue={tx?.note ?? ""} />
          </label>
          {tx && (
            <label className="nav-checkbox">
              <input type="checkbox" name="rule" />
              {ru.live.transactions.saveRule(tx.merchant)}
            </label>
          )}
          <div className="nav-actions">
            <button className="nav-primary" disabled={busy}>
              {ru.common.save}
            </button>
            {tx && manual && (
              <button
                type="button"
                className="nav-secondary nav-danger"
                disabled={busy}
                onClick={() => confirmed(c.tx.deleteConfirm(tx.merchant)) && remove.mutate(tx.id)}
              >
                {c.tx.delete}
              </button>
            )}
            {tx && !manual && (
              <button
                type="button"
                className="nav-secondary"
                disabled={busy}
                onClick={() =>
                  (tx.voided || confirmed(c.tx.voidConfirm(tx.merchant))) &&
                  voiding.mutate({ id: tx.id, voided: !tx.voided })
                }
              >
                {tx.voided ? c.tx.restore : c.tx.void}
              </button>
            )}
            {tx && (
              <button
                type="button"
                className="nav-text-button"
                onClick={() => setShowHistory(!showHistory)}
              >
                {c.tx.history}
              </button>
            )}
          </div>
          <FormError error={error || save.error || remove.error || voiding.error} />
          {showHistory && (
            <div className="nav-live-list">
              {(history.data ?? []).length === 0 ? (
                <p className="nav-small">
                  {history.isPending ? ru.common.loading : c.tx.historyEmpty}
                </p>
              ) : (
                history.data!.map((h, i) => (
                  <p key={i} className="nav-small">
                    {new Date(h.at).toLocaleString("ru-RU")} ·{" "}
                    {c.tx.historyAction[h.action] ?? h.action}
                    {h.before && h.after ? `: ${diff(h.before, h.after)}` : ""}
                  </p>
                ))
              )}
            </div>
          )}
        </form>
      )}
    </Shell>
  );
}

function diff(a: Record<string, unknown>, b: Record<string, unknown>) {
  return Object.keys(b)
    .filter((k) => JSON.stringify(a[k]) !== JSON.stringify(b[k]))
    .map((k) => `${k}: ${a[k] ?? "—"} → ${b[k] ?? "—"}`)
    .join(", ");
}

/** A regular monthly payment, or (on create) a one-off / yearly mandatory item stored as a planned item. */
export function ObligationDialog({
  value,
  onClose,
  notify,
}: {
  value: Obligation | "new" | null;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const p = c.payments;
  const current = value && value !== "new" ? value : null;
  const [period, setPeriod] = useState<"monthly" | "once" | "yearly">("monthly");
  const save = useWrite(
    (f: FormData): Promise<unknown> => {
      const category = str(f.get("category")) || null;
      if (!current && period !== "monthly") {
        const item: PlannedIn = {
          name: str(f.get("name")),
          direction: "expense",
          amount: Number(f.get("amount")),
          dueOn: str(f.get("dueOn")),
          repeat: period,
          mandatory: true,
          movable: false,
          category,
        };
        return api.addPlanned(item);
      }
      const o: ObligationIn = {
        name: str(f.get("name")),
        kind: str(f.get("kind")) as Obligation["kind"],
        amount: Number(f.get("amount")),
        dayOfMonth: Number(f.get("day")),
        endsAt: str(f.get("endsAt")) || null,
        category,
        debtLeft: num(f.get("debtLeft")),
      };
      return current ? api.updateObligation(current.id, o) : api.addObligation(o);
    },
    () => {
      onClose();
      notify(c.saved);
    },
  );
  const monthly = !!current || period === "monthly";
  return (
    <Shell
      open={!!value}
      title={current ? p.editObligation : p.add}
      hint={p.dayHint}
      onClose={onClose}
    >
      <form
        className="nav-form"
        key={current?.id ?? "new"}
        onSubmit={(e) => {
          e.preventDefault();
          save.mutate(new FormData(e.currentTarget));
        }}
      >
        {!current && (
          <label className="nav-field">
            {p.periodicity}
            <select value={period} onChange={(e) => setPeriod(e.target.value as typeof period)}>
              <option value="monthly">{p.monthly}</option>
              <option value="once">{p.once}</option>
              <option value="yearly">{p.yearly}</option>
            </select>
          </label>
        )}
        <label className="nav-field">
          {p.name}
          <input name="name" required maxLength={200} defaultValue={current?.name ?? ""} />
        </label>
        <label className="nav-field">
          {c.tx.amount}
          <input
            name="amount"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={current?.amount ?? ""}
          />
        </label>
        {monthly ? (
          <>
            <label className="nav-field">
              {p.kind}
              <select name="kind" defaultValue={current?.kind ?? "rent"}>
                {OB_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {ru.obligationKind[k]}
                  </option>
                ))}
              </select>
            </label>
            <label className="nav-field">
              {p.day}
              <input
                name="day"
                type="number"
                min={1}
                max={31}
                required
                defaultValue={current?.dayOfMonth ?? ""}
              />
            </label>
            <label className="nav-field">
              {p.endsAt}
              <input name="endsAt" type="month" defaultValue={current?.endsAt ?? ""} />
            </label>
            <label className="nav-field">
              {p.debtLeft}
              <input
                name="debtLeft"
                type="number"
                min={0}
                step={1}
                defaultValue={current?.debtLeft ?? ""}
              />
            </label>
          </>
        ) : (
          <label className="nav-field">
            {p.dueOn}
            <input name="dueOn" type="date" required />
          </label>
        )}
        <CategorySelect value={current?.categoryId} />
        <button className="nav-primary" disabled={save.isPending}>
          {ru.common.save}
        </button>
        <FormError error={save.error} />
      </form>
    </Shell>
  );
}

export function PlannedDialog({
  value,
  accounts,
  onClose,
  notify,
}: {
  value: PlannedPayment | "new" | null;
  accounts: Account[];
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const p = c.payments;
  const current = value && value !== "new" ? value : null;
  const [error, setError] = useState("");
  const save = useWrite(
    (item: PlannedIn) => (current ? api.updatePlanned(current.id, item) : api.addPlanned(item)),
    () => {
      onClose();
      notify(c.saved);
    },
  );
  return (
    <Shell
      open={!!value}
      title={current ? p.editPlanned : p.addPlanned}
      hint={p.plannedHint}
      onClose={onClose}
    >
      <form
        className="nav-form"
        key={current?.id ?? "new"}
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const item: PlannedIn = {
            name: str(f.get("name")),
            direction: str(f.get("direction")) as PlannedIn["direction"],
            amount: Number(f.get("amount")),
            dueOn: str(f.get("dueOn")),
            dueTo: str(f.get("dueTo")) || null,
            repeat: str(f.get("repeat")) as PlannedIn["repeat"],
            category: str(f.get("category")) || null,
            accountId: str(f.get("account")) || null,
            mandatory: f.get("mandatory") === "on",
            movable: f.get("movable") === "on",
          };
          if (item.dueTo && item.dueTo < item.dueOn)
            return setError("Конец интервала раньше начала.");
          setError("");
          save.mutate(item);
        }}
      >
        <label className="nav-field">
          {p.name}
          <input name="name" required maxLength={200} defaultValue={current?.name ?? ""} />
        </label>
        <label className="nav-field">
          {p.direction}
          <select name="direction" defaultValue={current?.direction ?? "expense"}>
            <option value="expense">{c.tx.expense}</option>
            <option value="income">{c.tx.income}</option>
          </select>
        </label>
        <label className="nav-field">
          {c.tx.amount}
          <input
            name="amount"
            type="number"
            min={1}
            step={1}
            required
            defaultValue={current?.amount ?? ""}
          />
        </label>
        <label className="nav-field">
          {p.dueOn}
          <input name="dueOn" type="date" required defaultValue={current?.dueOn ?? ""} />
        </label>
        <label className="nav-field">
          {p.dueTo}
          <input name="dueTo" type="date" defaultValue={current?.dueTo ?? ""} />
        </label>
        <label className="nav-field">
          {p.periodicity}
          <select name="repeat" defaultValue={current?.repeat ?? "once"}>
            <option value="once">{p.once}</option>
            <option value="yearly">{p.yearly}</option>
          </select>
        </label>
        <CategorySelect value={current?.categoryId} />
        <AccountSelect accounts={accounts} value={current?.accountId ?? ""} optional />
        <label className="nav-checkbox">
          <input type="checkbox" name="mandatory" defaultChecked={current?.mandatory ?? true} />
          {p.mandatory}
        </label>
        <label className="nav-checkbox">
          <input type="checkbox" name="movable" defaultChecked={current?.movable ?? false} />
          {p.movable}
        </label>
        <button className="nav-primary" disabled={save.isPending}>
          {ru.common.save}
        </button>
        <FormError error={error || save.error} />
      </form>
    </Shell>
  );
}

export function SettleDialog({
  item,
  accounts,
  today,
  onClose,
  notify,
}: {
  item: PlannedPayment | null;
  accounts: Account[];
  today: string;
  onClose: () => void;
  notify: (m: string) => void;
}) {
  const p = c.payments;
  const [mode, setMode] = useState<"new" | "link">("new");
  const from = item ? addDays(item.dueOn < today ? item.dueOn : today, -45) : today;
  const candidates = useQuery({ ...q.transactionsFor({ from, to: today }), enabled: !!item });
  const used = new Set(item?.settlements.map((s) => s.transactionId));
  const list = (candidates.data ?? []).filter(
    (t) =>
      !t.voided && !used.has(t.id) && (item?.direction === "income" ? t.amount > 0 : t.amount < 0),
  );
  const save = useWrite(
    (f: FormData) =>
      api.settlePlanned(item!.id, {
        amount: Number(f.get("amount")) || undefined,
        ...(mode === "link"
          ? { transactionId: str(f.get("tx")) }
          : { accountId: str(f.get("account")) || undefined, date: str(f.get("date")) }),
      }),
    () => {
      onClose();
      notify(c.saved);
    },
  );
  return (
    <Shell
      open={!!item}
      title={item ? p.payTitle(item.name) : ""}
      hint={p.payHint}
      onClose={onClose}
    >
      {item && (
        <form
          className="nav-form"
          key={item.id}
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate(new FormData(e.currentTarget));
          }}
        >
          <p className="nav-small">{p.left(money(item.left))}</p>
          <label className="nav-field">
            {p.payAmount}
            <input
              name="amount"
              type="number"
              min={1}
              max={item.left}
              step={1}
              required
              defaultValue={item.left}
            />
          </label>
          <div className="nav-mode-switch" role="group">
            {(["new", "link"] as const).map((m) => (
              <button
                key={m}
                type="button"
                className={mode === m ? "active" : ""}
                aria-pressed={mode === m}
                onClick={() => setMode(m)}
              >
                {m === "new" ? p.payNew : p.payLink}
              </button>
            ))}
          </div>
          {mode === "new" ? (
            <>
              <AccountSelect accounts={accounts} value={item.accountId} />
              <label className="nav-field">
                {c.tx.date}
                <input name="date" type="date" required max={today} defaultValue={today} />
              </label>
            </>
          ) : list.length ? (
            <label className="nav-field">
              {p.payLink}
              <select name="tx" required>
                {list.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.date} · {t.merchant} · {money(Math.abs(t.amount))}
                  </option>
                ))}
              </select>
            </label>
          ) : (
            <p className="nav-small">
              {candidates.isPending ? ru.common.loading : p.payNoCandidates}
            </p>
          )}
          <button
            className="nav-primary"
            disabled={save.isPending || (mode === "link" && !list.length)}
          >
            {ru.common.save}
          </button>
          <FormError error={save.error} />
        </form>
      )}
    </Shell>
  );
}
