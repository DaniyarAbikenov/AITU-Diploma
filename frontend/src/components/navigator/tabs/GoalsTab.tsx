import { Plus } from "lucide-react";
import { EstimateNote } from "@/components/kit";
import { DEMO_DATE, NAV_MODEL } from "@/lib/navigator";
import { GoalCards } from "../GoalCards";
import { Panel } from "../shared";
import { money, type DemoTabProps } from "../model";

export function GoalsTab({ s, open }: DemoTabProps) {
  return (
    <>
      <div className="nav-section-title">
        <p>
          {s.goals.length} цели · накоплено {money(s.goals.reduce((a, g) => a + g.saved, 0))}
        </p>
        <div className="nav-actions">
          <button onClick={() => open({ type: "strategy" })}>Сравнить стратегии</button>
          <button className="nav-primary" onClick={() => open({ type: "goal" })}>
            <Plus size={17} /> Новая цель
          </button>
        </div>
      </div>
      <GoalCards s={s} open={open} all />
      <Panel title="Ваш маршрут">
        <p>
          Стратегия:{" "}
          <strong>
            {s.strategy === "parallel" ? "Параллельные накопления" : "Сначала резерв"}
          </strong>
          . Суммарный план взносов — {money(s.goals.reduce((a, g) => a + g.monthly, 0))} / мес.
        </p>
        {s.goals.reduce((a, g) => a + g.monthly, 0) > s.income - s.essential && (
          <p className="nav-warning">
            План взносов превышает остаток после обязательных расходов. Сроки условны: сократите
            взносы или пересмотрите доход.
          </p>
        )}
        <p className="nav-small">
          Цели — части накопительного счёта. Пополнение перемещает деньги между счетами и не
          увеличивает общий капитал. Оценка сроков не учитывает инфляцию и доходность.
        </p>
        <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
      </Panel>
    </>
  );
}
