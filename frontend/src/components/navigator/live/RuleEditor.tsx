import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { api, q } from "@/api/client";
import type {
  Obligation,
  PlannedPayment,
  RuleIn,
  RuleInfo,
  RuleKind,
  RulePreview,
} from "@/api/types";
import { ru } from "@/i18n/ru";
import type { RuleState } from "./rule-state";

const t = ru.rules;
const KINDS: RuleKind[] = ["per_day", "percent_income", "percent_of", "fixed_plus", "formula"];

/** «Фиксированная сумма / Рассчитывать по правилу» with a wizard, examples and a live preview from the server. */
export function RuleEditor({
  value,
  onChange,
  self,
  obligations = [],
  planned = [],
}: {
  value: RuleState;
  onChange: (v: RuleState) => void;
  self?: string;
  obligations?: Obligation[];
  planned?: PlannedPayment[];
}) {
  const { on, rule } = value;
  const set = (patch: Partial<RuleIn>) => onChange({ on, rule: { ...rule, ...patch } });
  const param = (k: string, v: string | number) => set({ params: { ...rule.params, [k]: v } });
  const vars = useQuery({ ...q.ruleVariables, enabled: on && rule.kind === "formula" });
  const [preview, setPreview] = useState<RulePreview | null>(null);
  const key = JSON.stringify(rule);
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const timer = setTimeout(() => {
      api
        .rulePreview(JSON.parse(key))
        .then((p) => alive && setPreview(p))
        .catch((e: Error) => alive && setPreview({ error: e.message }));
    }, 300);
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key, on]);
  const refs = [
    ...obligations.map((o) => ({ id: `ob_${o.id}`, name: o.name })),
    ...planned.map((p) => ({ id: `pl_${p.id}`, name: p.name })),
  ].filter((r) => r.id !== self);
  return (
    <fieldset className="nav-form" style={{ border: 0, padding: 0, margin: 0 }}>
      <legend className="nav-small">{t.mode}</legend>
      <div className="nav-mode-switch" role="group" aria-label={t.mode}>
        <button
          type="button"
          className={!on ? "active" : ""}
          aria-pressed={!on}
          onClick={() => onChange({ on: false, rule })}
        >
          {t.fixed}
        </button>
        <button
          type="button"
          className={on ? "active" : ""}
          aria-pressed={on}
          onClick={() => onChange({ on: true, rule })}
        >
          {t.byRule}
        </button>
      </div>
      {on && (
        <>
          <div className="nav-actions">
            <span className="nav-small">{t.examples}:</span>
            <button
              type="button"
              className="nav-text-button"
              onClick={() =>
                onChange({ on, rule: { kind: "per_day", params: { perDay: 5000, days: "month" } } })
              }
            >
              {t.exFood}
            </button>
            <button
              type="button"
              className="nav-text-button"
              onClick={() =>
                onChange({
                  on,
                  rule: { kind: "percent_income", params: { percent: 3, base: "income_min" } },
                })
              }
            >
              {t.exTax}
            </button>
          </div>
          <label className="nav-field">
            {t.kind}
            <select
              value={rule.kind}
              onChange={(e) =>
                set({ kind: e.target.value as RuleKind, params: {}, expression: null })
              }
            >
              {KINDS.map((k) => (
                <option key={k} value={k}>
                  {t.kinds[k]}
                </option>
              ))}
            </select>
          </label>
          {rule.kind === "per_day" && (
            <>
              <label className="nav-field">
                {t.perDay}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={rule.params.perDay ?? ""}
                  onChange={(e) => param("perDay", e.target.value)}
                />
              </label>
              <label className="nav-field">
                {t.days}
                <select
                  value={String(rule.params.days ?? "month")}
                  onChange={(e) => param("days", e.target.value)}
                >
                  <option value="month">{t.daysMonth}</option>
                  <option value="left">{t.daysLeft}</option>
                </select>
              </label>
            </>
          )}
          {(rule.kind === "percent_income" || rule.kind === "percent_of") && (
            <label className="nav-field">
              {t.percent}
              <input
                type="number"
                min={0}
                max={100}
                step={0.01}
                value={rule.params.percent ?? ""}
                onChange={(e) => param("percent", e.target.value)}
              />
            </label>
          )}
          {rule.kind === "percent_income" && (
            <>
              <label className="nav-field">
                {t.base}
                <select
                  value={String(rule.params.base ?? "income_min")}
                  onChange={(e) => param("base", e.target.value)}
                >
                  {Object.entries(t.bases).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
              </label>
              <p className="nav-small">{t.percentNote}</p>
            </>
          )}
          {rule.kind === "percent_of" && (
            <label className="nav-field">
              {t.ref}
              <select
                value={String(rule.params.ref ?? "")}
                onChange={(e) => param("ref", e.target.value)}
              >
                <option value="">—</option>
                {refs.map((r) => (
                  <option key={r.id} value={r.id}>
                    {r.name}
                  </option>
                ))}
              </select>
            </label>
          )}
          {rule.kind === "fixed_plus" && (
            <>
              <label className="nav-field">
                {t.fixedPart}
                <input
                  type="number"
                  min={0}
                  step={1}
                  value={rule.params.fixed ?? ""}
                  onChange={(e) => param("fixed", e.target.value)}
                />
              </label>
              <label className="nav-field">
                {t.extra}
                <input
                  value={String(rule.params.formula ?? "")}
                  maxLength={250}
                  onChange={(e) => param("formula", e.target.value)}
                />
              </label>
            </>
          )}
          {rule.kind === "formula" && (
            <label className="nav-field">
              {t.formula}
              <input
                value={rule.expression ?? ""}
                maxLength={300}
                placeholder="5000 * days_in_month"
                aria-invalid={!!preview?.error}
                onChange={(e) => set({ expression: e.target.value })}
              />
            </label>
          )}
          {(rule.kind === "formula" || rule.kind === "fixed_plus") && (
            <p className="nav-small">
              {t.formulaHint}{" "}
              {(vars.data ?? []).map((v) => (
                <code key={v.name} title={v.description}>
                  {v.name}{" "}
                </code>
              ))}
              {refs.map((r) => (
                <code key={r.id} title={r.name}>
                  {r.id}{" "}
                </code>
              ))}
            </p>
          )}
          <div role="status" aria-live="polite">
            {preview?.error ? (
              <p className="nav-error">
                {t.error(preview.error)}
                {preview.errorPos != null && rule.kind === "formula" && rule.expression && (
                  <>
                    <br />
                    <code>
                      {rule.expression.slice(0, preview.errorPos)}
                      <mark>
                        {rule.expression.slice(preview.errorPos, preview.errorPos + 1) || " "}
                      </mark>
                      {rule.expression.slice(preview.errorPos + 1)}
                    </code>
                  </>
                )}
              </p>
            ) : preview?.explanation ? (
              <p className="nav-small">
                {t.preview(preview.explanation)}
                {preview.estimate ? ` · ${t.estimate}` : ""}
              </p>
            ) : null}
          </div>
        </>
      )}
    </fieldset>
  );
}

/** Rule line under an item: «по правилу: 5 000 ₸ × 30 дн. = 150 000 ₸ · оценка» or «не рассчитано, нужен доход». */
export function RuleLine({ rule }: { rule?: RuleInfo | null }) {
  if (!rule) return null;
  return (
    <p className="nav-small">
      {rule.overridden
        ? t.overridden
        : rule.amountThisMonth == null
          ? t.notComputed
          : t.byRuleLine(rule.explanation)}
      {rule.estimate && rule.amountThisMonth != null ? ` · ${t.estimate}` : ""}
    </p>
  );
}
