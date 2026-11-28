import { useQuery } from "@tanstack/react-query";
import { api, q } from "@/api/client";
import { ru } from "@/i18n/ru";
import { Panel } from "../shared";
import { FormError } from "./forms";
import { useWrite } from "./hooks";

const t = ru.insightSettings;
const fmt = (v: number, unit: string) =>
  unit === "share" ? `${Math.round(v * 100)} %` : String(v).replace(".", ",");

/** Thresholds of the smart insights (defaults marked) and opt-in of sensitive topics. */
export function InsightSettingsPanel({ notify }: { notify: (m: string) => void }) {
  const st = useQuery(q.insightSettings);
  const save = useWrite(api.updateInsightSettings, () => notify(ru.crud.saved));
  if (!st.data) return null;
  return (
    <Panel title={t.title}>
      <p className="nav-small">{t.text}</p>
      <form
        className="nav-form"
        onSubmit={(e) => {
          e.preventDefault();
          const f = new FormData(e.currentTarget);
          const thresholds: Record<string, number | null> = {};
          for (const x of st.data.thresholds) {
            const raw = String(f.get(x.key) ?? "")
              .trim()
              .replace(",", ".");
            const v = raw === "" ? null : Number(raw);
            const val = v != null && x.unit === "share" ? v / 100 : v;
            if (val === null ? !x.isDefault : val !== x.value) thresholds[x.key] = val;
          }
          const sensitive: Record<string, boolean> = {};
          for (const x of st.data.sensitive) sensitive[x.id] = f.get(`s_${x.id}`) === "on";
          save.mutate({ thresholds, sensitive });
        }}
      >
        {st.data.thresholds.map((x) => (
          <label key={x.key} className="nav-field">
            {x.label} {x.unit === "share" ? "(%)" : ""}
            <input
              name={x.key}
              type="number"
              min={0}
              step={x.unit === "share" ? 1 : x.unit === "money" ? 1 : 1}
              defaultValue={
                x.isDefault ? "" : x.unit === "share" ? Math.round(x.value * 100) : x.value
              }
              placeholder={t.default(fmt(x.default, x.unit))}
            />
            {x.isDefault && <small className="nav-small">{t.byDefault}</small>}
          </label>
        ))}
        <h3>{t.sensitiveTitle}</h3>
        <p className="nav-small">{t.sensitiveText}</p>
        {st.data.sensitive.map((x) => (
          <label key={x.id} className="nav-checkbox">
            <input type="checkbox" name={`s_${x.id}`} defaultChecked={x.enabled} />
            {x.title}
          </label>
        ))}
        <button className="nav-primary" disabled={save.isPending}>
          {t.save}
        </button>
        <FormError error={save.error} />
      </form>
    </Panel>
  );
}
