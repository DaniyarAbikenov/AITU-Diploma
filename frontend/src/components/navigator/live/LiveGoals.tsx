import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Plus, Target, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { ru } from "@/i18n/ru";
import { formatMonth } from "@/lib/navigator-live";
import { compact, money } from "../model";
import { Panel, Progress } from "../shared";
import { Missing, Preliminary } from "./common";
import type { LiveGoal, LiveProps } from "./types";

const t = ru.live.goals;

/** Goals from /api/v1/goals only: no demo goals here, amounts and dates come from the user. */
export function LiveGoals({ goals, today, notify }: LiveProps) {
  const qc = useQueryClient();
  const [formOpen, setFormOpen] = useState(false),
    [name, setName] = useState("");
  const add = useMutation({
    mutationFn: api.addGoal,
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["goals"] });
      setFormOpen(false);
      setName("");
      notify(ru.live.profile.saved);
    },
  });
  const remove = useMutation({
    mutationFn: api.deleteGoal,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["goals"] }),
  });
  const card = (g: LiveGoal) => {
    const percent = g.target > 0 ? (g.saved / g.target) * 100 : 0;
    return (
      <article className="nav-goal nav-goal-other" key={g.id}>
        <div className="nav-between">
          <span className="nav-icon">
            <Target size={22} />
          </span>
          <span className="nav-tag">{Math.round(percent)}% накоплено</span>
        </div>
        <h3>{g.name}</h3>
        <p className="nav-goal-amount">
          {money(g.saved)} <span>из {compact(g.target)}</span>
        </p>
        <Progress value={percent} label={g.name} />
        <p className="nav-small">
          {g.monthly > 0 ? `${money(g.monthly)} / мес.` : "Ежемесячный взнос не указан"} · срок{" "}
          {formatMonth(g.deadline)}
        </p>
        {g.monthly > 0 ? (
          <p className="nav-small">
            {t.eta(formatMonth(g.projection.etaMonth))} ·{" "}
            {g.projection.onTrack ? t.onTrack : t.offTrack} <Preliminary />
          </p>
        ) : (
          <Missing>{t.noMonthly}</Missing>
        )}
        <p className="nav-small">{t.required(money(g.projection.requiredMonthly))}</p>
        <button
          className="nav-text-button"
          onClick={() => {
            if (window.confirm(t.deleteConfirm(g.name))) remove.mutate(g.id);
          }}
        >
          <Trash2 size={14} /> {ru.common.delete}
        </button>
      </article>
    );
  };
  return (
    <>
      <div className="nav-section-title">
        <p>
          {goals.length
            ? `${goals.length} · накоплено ${money(goals.reduce((a, g) => a + g.saved, 0))}`
            : ""}
        </p>
        <button className="nav-primary" onClick={() => setFormOpen(true)}>
          <Plus size={17} /> {t.add}
        </button>
      </div>
      {goals.length ? (
        <div className="nav-goal-grid">{goals.map(card)}</div>
      ) : (
        <Panel>
          <Missing action={t.add} onAction={() => setFormOpen(true)}>
            {t.empty}
          </Missing>
        </Panel>
      )}
      {formOpen && (
        <Panel title={t.add}>
          <div className="nav-actions">
            {t.suggestions.map((s) => (
              <button key={s} type="button" className="nav-secondary" onClick={() => setName(s)}>
                {s}
              </button>
            ))}
          </div>
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              add.mutate({
                name: String(f.get("name")).trim(),
                target: Number(f.get("target")),
                saved: Number(f.get("saved") || 0),
                monthly: Number(f.get("monthly") || 0),
                deadline: String(f.get("deadline")),
              });
            }}
          >
            <label className="nav-field">
              {t.name}
              <input
                name="name"
                required
                maxLength={200}
                value={name}
                onChange={(e) => setName(e.target.value)}
              />
            </label>
            <label className="nav-field">
              {t.target}
              <input name="target" type="number" min={1} step={1} required />
            </label>
            <label className="nav-field">
              {t.saved}
              <input name="saved" type="number" min={0} step={1} placeholder="0" />
            </label>
            <label className="nav-field">
              {t.monthly}
              <input name="monthly" type="number" min={0} step={1} />
            </label>
            <label className="nav-field">
              {t.deadline}
              <input name="deadline" type="month" required min={today.slice(0, 7)} />
            </label>
            <div className="nav-actions">
              <button className="nav-primary" disabled={add.isPending}>
                {ru.common.save}
              </button>
              <button type="button" className="nav-secondary" onClick={() => setFormOpen(false)}>
                {ru.common.cancel}
              </button>
            </div>
            {add.isError && (
              <p className="nav-error" role="alert">
                {add.error.message}
              </p>
            )}
          </form>
        </Panel>
      )}
    </>
  );
}
