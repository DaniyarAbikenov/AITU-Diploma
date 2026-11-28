import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Activity, Plus } from "lucide-react";
import { api } from "@/api/client";
import type { Account, AccountKind, ProfilePatch } from "@/api/types";
import { updateSession } from "@/lib/auth";
import { bankName, ru } from "@/i18n/ru";
import { cautiousIncome, formatDay } from "@/lib/navigator-live";
import { money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { ObligationsPanel } from "./LivePayments";
import { PrivacyPanel } from "./PrivacyPanel";
import type { LiveProps } from "./types";

const t = ru.live.profile;
const KINDS = Object.keys(ru.accountKind) as AccountKind[];
const ZONES = [
  "Asia/Almaty",
  "Asia/Aqtobe",
  "Asia/Aqtau",
  "Asia/Oral",
  "Asia/Qyzylorda",
  "Asia/Atyrau",
];
/** Empty input = unknown (null), never 0. */
const opt = (v: FormDataEntryValue | null) =>
  v === null || String(v).trim() === "" ? null : Number(v);

export function LiveProfile({ me, accounts, incomes, obligations, today, notify }: LiveProps) {
  const qc = useQueryClient();
  const saveMe = useMutation({
    mutationFn: (p: ProfilePatch) => api.updateMe(p),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      updateSession({ user: { name: u.name, city: u.city } });
      notify(t.saved);
    },
  });
  const cautious = cautiousIncome(incomes);
  const hourly = me.plannedIncome != null && me.workHours ? me.plannedIncome / me.workHours : null;
  return (
    <>
      <div className="nav-profile-grid">
        <Panel title={t.planTitle}>
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              saveMe.mutate({
                name: String(f.get("name")).trim(),
                city: String(f.get("city")).trim(),
                timezone: String(f.get("timezone")),
                plannedIncome: opt(f.get("income")),
                essentialExpenses: opt(f.get("expenses")),
                workHours: opt(f.get("hours")),
              });
            }}
          >
            <label className="nav-field">
              {t.name}
              <input name="name" required maxLength={120} defaultValue={me.name} />
            </label>
            <label className="nav-field">
              {t.city}
              <input name="city" maxLength={80} defaultValue={me.city} />
            </label>
            <label className="nav-field">
              {t.timezone}
              <select name="timezone" defaultValue={me.timezone ?? "Asia/Almaty"}>
                {[...new Set([me.timezone ?? "Asia/Almaty", ...ZONES])].map((z) => (
                  <option key={z}>{z}</option>
                ))}
              </select>
            </label>
            <label className="nav-field">
              {t.income}
              <input
                name="income"
                type="number"
                min={0}
                step={1}
                placeholder={ru.common.unknown}
                defaultValue={me.plannedIncome ?? ""}
              />
            </label>
            {cautious > 0 && (
              <p className="nav-small">
                По подтверждённым выплатам (по нижней границе): {money(cautious)} в месяц.
              </p>
            )}
            <label className="nav-field">
              {t.expenses}
              <input
                name="expenses"
                type="number"
                min={0}
                step={1}
                placeholder={ru.common.unknown}
                defaultValue={me.essentialExpenses ?? ""}
              />
            </label>
            <label className="nav-field">
              {t.hours}
              <input
                name="hours"
                type="number"
                min={1}
                max={744}
                step={1}
                placeholder={ru.common.unknown}
                defaultValue={me.workHours ?? ""}
              />
            </label>
            <p className="nav-small">{t.unknownHint}</p>
            <button className="nav-primary" disabled={saveMe.isPending}>
              {ru.common.save}
            </button>
            {saveMe.isError && (
              <p className="nav-error" role="alert">
                {saveMe.error.message}
              </p>
            )}
          </form>
        </Panel>
        <Panel title={t.hourTitle}>
          <span className="nav-icon">
            <Activity />
          </span>
          {hourly ? (
            <>
              <p className="nav-large">
                {money(hourly)} <span className="nav-small">/ час</span>
              </p>
              <p className="nav-small">
                Покупка за 10 000 ₸ — примерно {(10000 / hourly).toFixed(1).replace(".", ",")} ч.
                работы.
              </p>
            </>
          ) : (
            <Missing>{t.hourEmpty}</Missing>
          )}
        </Panel>
      </div>
      <Panel title={t.accountsTitle}>
        <p className="nav-small">{t.accountsHint}</p>
        {accounts.length ? (
          <div className="nav-live-list">
            {accounts.map((a) => (
              <AccountRow key={a.id} a={a} today={today} notify={notify} />
            ))}
          </div>
        ) : (
          <Missing>{t.noAccounts}</Missing>
        )}
        <NewAccount today={today} notify={notify} />
      </Panel>
      <ObligationsPanel obligations={obligations} notify={notify} />
      <PrivacyPanel email={me.email} />
    </>
  );
}

function AccountRow({
  a,
  today,
  notify,
}: {
  a: Account;
  today: string;
  notify: (m: string) => void;
}) {
  const qc = useQueryClient();
  const [editBalance, setEditBalance] = useState(false);
  const done = () => {
    qc.invalidateQueries({ queryKey: ["accounts"] });
    qc.invalidateQueries({ queryKey: ["resilience"] });
    qc.invalidateQueries({ queryKey: ["balance"] });
    notify(t.saved);
  };
  const patch = useMutation({
    mutationFn: (p: Partial<Pick<Account, "kind" | "confirmed">>) => api.updateAccount(a.id, p),
    onSuccess: done,
  });
  const checkpoint = useMutation({
    mutationFn: (cp: { balance: number; asOf: string }) => api.addCheckpoint(a.id, cp),
    onSuccess: () => {
      setEditBalance(false);
      done();
    },
  });
  const error = patch.error ?? checkpoint.error;
  return (
    <div className="nav-live-row">
      <div>
        <strong>
          {bankName(a.bank)} · {a.name}
        </strong>{" "}
        {!a.confirmed && <span className="nav-pill warn">{t.notConfirmed}</span>}
        <p className="nav-small">
          {a.balanceKnown === false || !a.balanceAsOf
            ? t.balanceUnknown
            : `${money(a.balance)} · ${t.balanceFrom(a.balanceSource ?? "manual", formatDay(a.balanceAsOf))}${
                a.currentBalance != null && a.currentBalance !== a.balance
                  ? ` · с ручными операциями после этой даты: ${money(a.currentBalance)}`
                  : ""
              }`}
        </p>
      </div>
      <label className="nav-field">
        {t.kind}
        <select
          value={a.kind ?? ""}
          onChange={(e) => patch.mutate({ kind: e.target.value as AccountKind })}
          aria-label={`${t.kind}: ${a.name}`}
        >
          {!a.kind && <option value="">{t.kindRequired}</option>}
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {ru.accountKind[k]}
            </option>
          ))}
        </select>
      </label>
      <div className="nav-actions">
        {!a.confirmed && (
          <button
            className="nav-primary"
            disabled={!a.kind || a.balanceKnown === false || patch.isPending}
            title={!a.kind ? t.kindRequired : undefined}
            onClick={() => patch.mutate({ confirmed: true })}
          >
            {t.confirmAccount}
          </button>
        )}
        <button className="nav-secondary" onClick={() => setEditBalance(!editBalance)}>
          {t.setBalance}
        </button>
      </div>
      {editBalance && (
        <form
          className="nav-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            checkpoint.mutate({ balance: Number(f.get("balance")), asOf: String(f.get("asOf")) });
          }}
        >
          <label className="nav-field">
            {t.balance}
            <input
              name="balance"
              type="number"
              step={1}
              required
              defaultValue={a.balanceKnown ? a.balance : ""}
            />
          </label>
          <label className="nav-field">
            {t.balanceDate}
            <input name="asOf" type="date" required max={today} defaultValue={today} />
          </label>
          <button className="nav-primary" disabled={checkpoint.isPending}>
            {ru.common.save}
          </button>
        </form>
      )}
      {error && (
        <p className="nav-error" role="alert">
          {error.message}
        </p>
      )}
    </div>
  );
}

function NewAccount({ today, notify }: { today: string; notify: (m: string) => void }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const create = useMutation({
    mutationFn: api.createAccount,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["accounts"] });
      setOpen(false);
      notify(t.saved);
    },
  });
  if (!open)
    return (
      <button className="nav-secondary" onClick={() => setOpen(true)}>
        <Plus size={16} /> {t.addAccount}
      </button>
    );
  return (
    <form
      className="nav-form"
      onSubmit={(e) => {
        e.preventDefault();
        const f = new FormData(e.currentTarget);
        create.mutate({
          bank: String(f.get("bank")).trim(),
          name: String(f.get("name")).trim(),
          kind: String(f.get("kind")) as AccountKind,
          balance: opt(f.get("balance")),
          balanceAsOf: String(f.get("asOf") || today),
        });
      }}
    >
      <label className="nav-field">
        {t.bank}
        <input
          name="bank"
          required
          maxLength={80}
          placeholder="Например, Наличные или Kaspi Bank"
        />
      </label>
      <label className="nav-field">
        {t.accountName}
        <input name="name" required maxLength={120} placeholder="Например, Kaspi Депозит" />
      </label>
      <label className="nav-field">
        {t.kind}
        <select name="kind" defaultValue="current">
          {KINDS.map((k) => (
            <option key={k} value={k}>
              {ru.accountKind[k]}
            </option>
          ))}
        </select>
      </label>
      <label className="nav-field">
        {t.balance}
        <input name="balance" type="number" step={1} placeholder={ru.common.unknown} />
      </label>
      <label className="nav-field">
        {t.balanceDate}
        <input name="asOf" type="date" max={today} defaultValue={today} />
      </label>
      <div className="nav-actions">
        <button className="nav-primary" disabled={create.isPending}>
          {ru.common.save}
        </button>
        <button type="button" className="nav-secondary" onClick={() => setOpen(false)}>
          {ru.common.cancel}
        </button>
      </div>
      {create.isError && (
        <p className="nav-error" role="alert">
          {create.error.message}
        </p>
      )}
    </form>
  );
}
