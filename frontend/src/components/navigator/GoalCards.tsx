import { goalMonths, type NavigatorState } from "@/lib/navigator";
import { Progress } from "./shared";
import { compact, goalIcon, money, type Modal } from "./model";

export function GoalCards({
  s,
  open,
  all = false,
}: {
  s: NavigatorState;
  open: (m: Modal) => void;
  all?: boolean;
}) {
  return (
    <div className="nav-goal-grid">
      {s.goals.slice(0, all ? undefined : 3).map((g) => {
        const Icon = goalIcon(g.kind),
          percent = (g.saved / g.target) * 100;
        return (
          <article className={`nav-goal nav-goal-${g.kind}`} key={g.id}>
            <div className="nav-between">
              <span className="nav-icon">
                <Icon size={22} />
              </span>
              <span className="nav-tag">
                {g.kind === "reserve" ? "Основа спокойствия" : `${Math.round(percent)}% накоплено`}
              </span>
            </div>
            <h3>{g.name}</h3>
            <p className="nav-goal-amount">
              {money(g.saved)} <span>из {compact(g.target)}</span>
            </p>
            <Progress value={percent} label={g.name} />
            <div className="nav-between nav-goal-bottom">
              <span>{money(g.monthly)} / мес.</span>
              <button
                className="nav-text-button"
                onClick={() => open({ type: "transfer", goal: g })}
                disabled={percent >= 100}
              >
                {percent >= 100 ? "Цель достигнута" : "Пополнить"}
              </button>
            </div>
            {all && (
              <p className="nav-small">
                При выбранном плане: ~{goalMonths(s, g)} мес. Диапазон при взносах ±20%:{" "}
                {Math.ceil(goalMonths(s, g) / 1.2)}–{Math.ceil(goalMonths(s, g) / 0.8)} мес.
              </p>
            )}
          </article>
        );
      })}
    </div>
  );
}
