import { useState } from "react";
import { keepPreviousData, useQuery } from "@tanstack/react-query";
import { api, q } from "@/api/client";
import type { BasisSource, ProfilePatch } from "@/api/types";
import { ru } from "@/i18n/ru";
import { formatDate, formatMonth } from "@/lib/format";
import { money, type Tab } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { FormError } from "./forms";
import { useWrite } from "./hooks";

const t = ru.basis;

function nextMonths(today: string, n: number) {
  const [y, m] = today.split("-").map(Number);
  return Array.from({ length: n }, (_, i) => {
    const k = y * 12 + m - 1 + i;
    return `${Math.floor(k / 12)}-${String((k % 12) + 1).padStart(2, "0")}`;
  });
}

/** Essential expenses and planned income come from the user's data; typing a value is an explicit override. */
export function PlanBasisPanel({
  today,
  notify,
  go,
}: {
  today: string;
  notify: (m: string) => void;
  go: (tab: Tab) => void;
}) {
  const months = nextMonths(today, 6);
  const [month, setMonth] = useState(months[0]);
  const { data, error } = useQuery({
    ...q.planBasis(month),
    placeholderData: keepPreviousData,
  });
  if (error)
    return (
      <Panel title={t.title}>
        <p className="nav-error" role="alert">
          {error.message}
        </p>
      </Panel>
    );
  if (!data) return null;
  const e = data.essential,
    i = data.income;
  return (
    <Panel title={t.title}>
      <label className="nav-field">
        {t.month}
        <select value={month} onChange={(x) => setMonth(x.target.value)}>
          {months.map((m) => (
            <option key={m} value={m}>
              {formatMonth(m)}
            </option>
          ))}
        </select>
      </label>
      <Field
        name={t.essential}
        field="essentialExpenses"
        value={e.value ?? e.auto}
        auto={e.source === "manual" ? e.auto : null}
        manual={e.manual}
        source={e.source}
        on={e.source === "manual" || e.source === "fallback" ? e.manualOn : data.asOf}
        notify={notify}
      >
        {e.source === "none" && (
          <Missing action={t.toCalendar} onAction={() => go("calendar")}>
            {t.none}
          </Missing>
        )}
        {!e.everydayKnown && e.auto !== null && <Missing>{t.partial}</Missing>}
        {e.items.map((x, k) => (
          <div className="nav-account" key={k}>
            <span>
              {x.name}{" "}
              <small className="nav-small">
                {x.perDay !== null && x.days !== null
                  ? t.perDay(money(x.perDay), x.days)
                  : x.type === "planned"
                    ? x.note
                    : ""}
              </small>
            </span>
            <strong>{money(x.amount)}</strong>
          </div>
        ))}
        {e.auto !== null && (
          <div className="nav-account">
            <span>{t.total}</span>
            <strong>{money(e.auto)}</strong>
          </div>
        )}
        <p className="nav-small">{t.howTo}</p>
      </Field>
      <Field
        name={t.income}
        field="plannedIncome"
        value={i.value}
        auto={i.source === "manual" ? i.auto : null}
        manual={i.manual}
        source={i.source}
        on={i.source === "manual" || i.source === "fallback" ? i.manualOn : data.asOf}
        notify={notify}
      >
        {i.source === "none" && (
          <Missing action={t.toCalendar} onAction={() => go("calendar")}>
            {t.incomeNone}
          </Missing>
        )}
        {i.items.map((x, k) => (
          <div className="nav-account" key={k}>
            <span>
              {x.name} <small className="nav-small">{t.day(x.day)}</small>
            </span>
            <strong>{money(x.amount)}</strong>
          </div>
        ))}
        {i.low !== null && i.high !== null && i.low !== i.high && (
          <p className="nav-small">{t.range(money(i.low), money(i.high))}</p>
        )}
      </Field>
    </Panel>
  );
}

function Field(props: {
  name: string;
  field: "essentialExpenses" | "plannedIncome";
  value: number | null;
  auto: number | null;
  manual: number | null;
  source: BasisSource;
  on: string | null;
  notify: (m: string) => void;
  children: React.ReactNode;
}) {
  const [editing, setEditing] = useState(false);
  const save = useWrite(
    (p: ProfilePatch) => api.updateMe(p),
    () => {
      setEditing(false);
      props.notify(ru.crud.saved);
    },
  );
  return (
    <section className="nav-basis" aria-label={props.name}>
      <h3>{props.name}</h3>
      {props.value !== null && <p className="nav-large">{money(props.value)}</p>}
      <p className="nav-small">
        {t.source[props.source]}
        {props.on && props.source !== "none" && `, ${t.on(formatDate(props.on, true))}`}
      </p>
      {props.auto !== null && <p className="nav-small">{t.auto(money(props.auto))}</p>}
      {props.children}
      {editing ? (
        <form
          className="nav-form"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate({ [props.field]: Number(new FormData(e.currentTarget).get("value")) });
          }}
        >
          <label className="nav-field">
            {t.value(props.name)}
            <input
              name="value"
              type="number"
              min={0}
              step={1}
              required
              defaultValue={props.manual ?? ""}
            />
          </label>
          <div className="nav-actions">
            <button className="nav-primary" disabled={save.isPending}>
              {ru.common.save}
            </button>
            <button type="button" className="nav-secondary" onClick={() => setEditing(false)}>
              {ru.common.cancel}
            </button>
          </div>
        </form>
      ) : (
        <div className="nav-actions">
          <button className="nav-text-button" onClick={() => setEditing(true)}>
            {t.override}
          </button>
          {props.manual !== null && (props.source === "manual" || props.source === "fallback") && (
            <button
              className="nav-text-button"
              disabled={save.isPending}
              onClick={() => save.mutate({ [props.field]: null })}
            >
              {props.source === "manual" ? t.back : t.clear}
            </button>
          )}
        </div>
      )}
      <FormError error={save.error} />
    </section>
  );
}
