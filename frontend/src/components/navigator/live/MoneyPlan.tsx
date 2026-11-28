import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Info, Plus } from "lucide-react";
import { api, q } from "@/api/client";
import type { AllocationRule, DailyNeed, DailyNeedIn, Obligation, SplitItem } from "@/api/types";
import { ru } from "@/i18n/ru";
import { formatDay } from "@/lib/navigator-live";
import { money, type Tab } from "../model";
import { Panel } from "../shared";
import { Missing, Preliminary } from "./common";
import { FormError } from "./forms";
import { confirmed, useWrite } from "./hooks";
import type { LiveProps } from "./types";

const t = ru.plan;
const minus = (n: number) => (n ? `−${money(n)}` : money(0));

/** The spending limit: everyday needs first, then the ceiling above them. Computed by the server only. */
export function SpendingLimit({ snap, go }: LiveProps) {
  const [how, setHow] = useState(false);
  const { data, isPending, error } = useQuery(q.moneyPlan);
  const h = ru.live.home,
    p = data?.plan;
  const hasNeeds = !!data?.needs.length;
  return (
    <section className="nav-safe" aria-label={t.titleNoNeeds}>
      <div className="nav-between">
        <span>
          {hasNeeds ? t.title : t.titleNoNeeds} <Preliminary />
        </span>
        <button aria-label={h.howTitle} onClick={() => setHow(!how)}>
          <Info size={19} />
        </button>
      </div>
      {isPending ? (
        <p>{ru.common.loading}</p>
      ) : error ? (
        <p className="nav-error" role="alert">
          {error.message}
        </p>
      ) : !p ? (
        <Missing action={h.noAccountsAction} onAction={() => go("profile")}>
          {h.noAccounts}
        </Missing>
      ) : (
        <>
          <p className="nav-safe-amount">{money(p.safeDaily)}</p>
          <p>{h.safeUntil(formatDay(p.until))}</p>
          {data.everydayKnown ? (
            <p className="nav-small">{h.ceilingNote}</p>
          ) : (
            <Missing action={t.addNeeds} onAction={() => go("profile")}>
              {t.needsMissing}
            </Missing>
          )}
          {!!data.setAside.amount && <p>{t.asideNote(money(data.setAside.amount))}</p>}
          {p.deficit > 0 && <p className="nav-warning">{h.deficit(money(p.deficit))}</p>}
          <div className="nav-safe-line" />
          <div className="nav-formula">
            <div>
              <span>Текущие счета и наличные</span>
              <strong>{money(data.liquid ?? 0)}</strong>
            </div>
            {data.protected > 0 && (
              <div>
                <span>{t.protected}</span>
                <strong>{minus(data.protected)}</strong>
              </div>
            )}
            <div>
              <span>Подтверждённые платежи в горизонте</span>
              <strong>{minus(p.committed)}</strong>
            </div>
            {hasNeeds && (
              <div>
                <span>{t.needs(formatDay(p.until))}</span>
                <strong>{minus(p.needs)}</strong>
              </div>
            )}
            <div>
              <span>Дней в горизонте</span>
              <strong>{ru.common.days(p.days)}</strong>
            </div>
          </div>
          {data.liquidForeign > 0 && (
            <p className="nav-small">{t.foreign(money(data.liquidForeign))}</p>
          )}
          <p className="nav-small">{p.horizon === "income" ? h.safeIncome : h.safeMonthEnd}</p>
          {snap.confirmedPayments.length === 0 && (
            <Missing action="Открыть календарь" onAction={() => go("calendar")}>
              {h.noPayments}
            </Missing>
          )}
        </>
      )}
      {how && <p className="nav-small">{h.formula}</p>}
    </section>
  );
}

function Split({ items }: { items: SplitItem[] }) {
  return (
    <>
      {items.map((x) => (
        <div className="nav-account" key={x.type + x.id + x.name}>
          <span>{x.name}</span>
          <strong>{money(x.amount)}</strong>
        </div>
      ))}
    </>
  );
}

/** «Предлагаем отложить»: a view of what could go to the reserve and goals. Nothing is transferred. */
export function SetAsidePanel({ go }: { go: (tab: Tab) => void }) {
  const { data } = useQuery(q.moneyPlan);
  const [open, setOpen] = useState(false);
  if (!data) return null;
  const a = data.setAside;
  return (
    <Panel title={t.aside} action={<Preliminary />}>
      {a.amount === null ? (
        <Missing
          action={t.addNeeds}
          onAction={() =>
            go(
              a.missing.includes("income") && !a.missing.includes("needs") ? "calendar" : "profile",
            )
          }
        >
          {t.asideMissing} {a.missing.map((m) => t.missing[m]).join(", ")}.
        </Missing>
      ) : a.amount > 0 ? (
        <>
          <p className="nav-large">{money(a.amount)}</p>
          <p className="nav-small">{t.asideText(a.days)}</p>
          <button className="nav-secondary" aria-expanded={open} onClick={() => setOpen(!open)}>
            {t.view}
          </button>
          {open && (
            <>
              <Split items={a.items} />
              <p className="nav-small">
                {t.order} {t.noAuto}
              </p>
            </>
          )}
        </>
      ) : a.free && !a.hasTargets ? (
        <Missing action={t.createGoal} onAction={() => go("goals")}>
          {t.asideNoTargets(money(a.free))}
        </Missing>
      ) : (
        <p className="nav-small">{t.asideNone}</p>
      )}
    </Panel>
  );
}

/** Payouts of the last two weeks to split by the user's rules, and confirmed splits still to be carried out. */
export function IncomeSplitPanel({ notify }: { notify: (m: string) => void }) {
  const { data } = useQuery(q.incomeAllocations);
  const decide = useWrite(
    (v: { id: string; action: "confirm" | "skip" | "done" }) =>
      api.decideIncomeAllocation(v.id, v.action),
    () => notify(ru.crud.saved),
  );
  if (!data || (!data.proposals.length && !data.confirmed.length)) return null;
  return (
    <>
      {data.proposals.map((p) => (
        <Panel key={p.transactionId} title={t.proposal(p.name, money(p.amount))}>
          <Split items={p.items} />
          <p className="nav-small">
            {t.rest(money(p.left))}. {t.confirmNote}
          </p>
          <div className="nav-actions">
            <button
              className="nav-primary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: p.transactionId, action: "confirm" })}
            >
              {t.confirm}
            </button>
            <button
              className="nav-secondary"
              disabled={decide.isPending}
              onClick={() => decide.mutate({ id: p.transactionId, action: "skip" })}
            >
              {t.skip}
            </button>
          </div>
        </Panel>
      ))}
      {data.confirmed.map((c) => (
        <Panel key={c.transactionId} title={t.protectedTitle}>
          <Split items={c.items} />
          <button
            className="nav-secondary"
            disabled={decide.isPending}
            onClick={() => decide.mutate({ id: c.transactionId, action: "done" })}
          >
            {t.done}
          </button>
        </Panel>
      ))}
      <FormError error={decide.error} />
    </>
  );
}

/** Everyday needs per day or per month; the statement median is only offered, applied by a button. */
export function NeedsPanel({
  obligations,
  notify,
}: {
  obligations: Obligation[];
  notify: (m: string) => void;
}) {
  const { data } = useQuery(q.moneyPlan);
  const [editing, setEditing] = useState<DailyNeed | "new" | null>(null);
  const [draft, setDraft] = useState<{ amount: string; period: "day" | "month" }>({
    amount: "",
    period: "day",
  });
  const save = useWrite(
    (v: { id?: string; need: DailyNeedIn }): Promise<unknown> =>
      v.id ? api.updateNeed(v.id, v.need) : api.addNeed(v.need),
    () => {
      setEditing(null);
      notify(ru.crud.saved);
    },
  );
  const remove = useWrite(
    (id: string) => api.deleteNeed(id),
    () => notify(ru.crud.deleted),
  );
  if (!data) return null;
  const cur = editing && editing !== "new" ? editing : null;
  const open = (n: DailyNeed | "new") => {
    setDraft(
      n === "new" ? { amount: "", period: "day" } : { amount: String(n.amount), period: n.period },
    );
    setEditing(n);
  };
  const [year, month] = data.asOf.split("-").map(Number);
  const monthDays = new Date(year, month, 0).getDate();
  const typed = Number(draft.amount);
  const payments = obligations.filter((o) => o.confirmed && !o.rejected);
  return (
    <Panel title={t.needsTitle}>
      <p className="nav-small">{t.needsHint}</p>
      {data.needs.map((n) => (
        <div className="nav-live-row" key={n.id}>
          <div>
            <strong>{n.name}</strong>
            <p className="nav-small">
              {money(n.amount)} {n.period === "day" ? t.perDay : t.perMonth}
              {" · ≈ "}
              {n.period === "day"
                ? `${money(n.perMonth)} ${t.perMonth}`
                : `${money(n.perDay)} ${t.perDay}`}
              {n.skipped &&
                ` · ${t.coveredYes(payments.find((o) => `ob_${o.id}` === n.coveredBy)?.name ?? "план")}`}
            </p>
          </div>
          <div className="nav-actions">
            <button className="nav-text-button" onClick={() => open(n)}>
              {t.edit}
            </button>
            <button
              className="nav-text-button"
              disabled={remove.isPending}
              onClick={() => confirmed(t.del(n.name)) && remove.mutate(n.id)}
            >
              {ru.common.delete}
            </button>
          </div>
        </div>
      ))}
      {!!data.suggestedDaily && !data.needs.length && (
        <div className="nav-note" role="note">
          <div>
            <p>{t.suggest(money(data.suggestedDaily))}</p>
            <button
              className="nav-text-button"
              disabled={save.isPending}
              onClick={() =>
                save.mutate({
                  need: { name: t.everyday, amount: data.suggestedDaily!, period: "day" },
                })
              }
            >
              {t.useSuggest}
            </button>
          </div>
        </div>
      )}
      {editing ? (
        <form
          className="nav-form"
          key={cur?.id ?? "new"}
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            save.mutate({
              id: cur?.id,
              need: {
                name: String(f.get("name")).trim(),
                amount: Number(f.get("amount")),
                period: f.get("period") === "month" ? "month" : "day",
                coveredBy: String(f.get("covered") ?? "") || null,
              },
            });
          }}
        >
          <label className="nav-field">
            {t.needName}
            <input
              name="name"
              required
              maxLength={80}
              defaultValue={cur?.name ?? ""}
              placeholder="Еда"
            />
          </label>
          <label className="nav-field">
            {t.needAmount}
            <input
              name="amount"
              type="number"
              min={1}
              step={1}
              required
              value={draft.amount}
              onChange={(e) => setDraft({ ...draft, amount: e.target.value })}
            />
          </label>
          <label className="nav-field">
            {t.period}
            <select
              name="period"
              value={draft.period}
              onChange={(e) =>
                setDraft({ ...draft, period: e.target.value === "month" ? "month" : "day" })
              }
            >
              <option value="day">{t.perDay}</option>
              <option value="month">{t.perMonth}</option>
            </select>
          </label>
          {typed > 0 && (
            <p className="nav-small">
              {draft.period === "day"
                ? t.other(money(typed * monthDays), t.perMonth)
                : t.other(money(Math.round(typed / monthDays)), t.perDay)}
            </p>
          )}
          <label className="nav-field">
            {t.covered}
            <select name="covered" defaultValue={cur?.coveredBy ?? ""}>
              <option value="">{t.coveredNo}</option>
              {payments.map((o) => (
                <option key={o.id} value={`ob_${o.id}`}>
                  {o.name}
                </option>
              ))}
            </select>
          </label>
          <div className="nav-actions">
            <button className="nav-primary" disabled={save.isPending}>
              {ru.common.save}
            </button>
            <button type="button" className="nav-secondary" onClick={() => setEditing(null)}>
              {ru.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button className="nav-secondary" onClick={() => open("new")}>
          <Plus size={16} /> {t.add}
        </button>
      )}
      <FormError error={save.error || remove.error} />
    </Panel>
  );
}

/** The user's own rules for every payout, applied in order. */
export function PayoutRulesPanel({ notify }: { notify: (m: string) => void }) {
  const { data } = useQuery(q.allocationRules);
  const [adding, setAdding] = useState(false);
  const save = useWrite(
    (r: AllocationRule[]) => api.saveAllocationRules(r),
    () => {
      setAdding(false);
      notify(ru.crud.saved);
    },
  );
  if (!data) return null;
  return (
    <Panel title={t.rulesTitle}>
      <p className="nav-small">{t.rulesHint}</p>
      {!data.length && <p className="nav-small">{t.noRules}</p>}
      {data.map((r, i) => (
        <div className="nav-live-row" key={i}>
          <div>
            <strong>
              {i + 1}. {r.name}
            </strong>
            <p className="nav-small">
              {t.kinds[r.kind]} ·{" "}
              {r.mode === "percent"
                ? `${String(r.value).replace(".", ",")} ${t.percent}`
                : money(r.value)}
            </p>
          </div>
          <button
            className="nav-text-button"
            disabled={save.isPending}
            onClick={() => save.mutate(data.filter((_, j) => j !== i))}
          >
            {ru.common.delete}
          </button>
        </div>
      ))}
      {adding ? (
        <form
          className="nav-form"
          onSubmit={(e) => {
            e.preventDefault();
            const f = new FormData(e.currentTarget);
            const kind = String(f.get("kind")) as AllocationRule["kind"];
            save.mutate([
              ...data,
              {
                name: t.kinds[kind],
                kind,
                mode: f.get("mode") === "fixed" ? "fixed" : "percent",
                value: Number(f.get("value")),
              },
            ]);
          }}
        >
          <label className="nav-field">
            {t.ruleKind}
            <select name="kind">
              {Object.entries(t.kinds).map(([k, v]) => (
                <option key={k} value={k}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="nav-field">
            {t.mode}
            <select name="mode">
              <option value="percent">{t.percent}</option>
              <option value="fixed">{t.fixed}</option>
            </select>
          </label>
          <label className="nav-field">
            {t.value}
            <input name="value" type="number" min={0.01} step={0.01} required />
          </label>
          <div className="nav-actions">
            <button className="nav-primary" disabled={save.isPending}>
              {ru.common.save}
            </button>
            <button type="button" className="nav-secondary" onClick={() => setAdding(false)}>
              {ru.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <button className="nav-secondary" onClick={() => setAdding(true)}>
          <Plus size={16} /> {t.addRule}
        </button>
      )}
      <FormError error={save.error} />
    </Panel>
  );
}
