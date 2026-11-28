import { BookOpen, Check, CheckCheck, Leaf } from "lucide-react";
import { NAV_QUESTS } from "@/lib/navigator";
import { Panel, Progress } from "../shared";
import { type DemoTabProps } from "../model";

export function QuestsTab({ s, m, open, change, pending }: DemoTabProps) {
  return (
    <>
      <section className="nav-progress-hero">
        <Leaf size={40} />
        <div>
          <p>ВАШ ФИНАНСОВЫЙ ОПЫТ</p>
          <h2>Уровень {m.level} · уверенный старт</h2>
          <p>{m.levelXP} из 300 XP до следующего уровня</p>
          <Progress value={m.levelXP / 3} label="Ваш опыт" />
        </div>
        <span>
          Без стриков.
          <br />
          Без штрафов.
          <br />В своём темпе.
        </span>
      </section>
      <div className="nav-quest-grid">
        {NAV_QUESTS.map((quest) => (
          <Panel key={quest.id}>
            <div className="nav-between">
              <span className="nav-icon">
                {s.completed.includes(quest.id) ? <CheckCheck /> : <BookOpen />}
              </span>
              <span className="nav-tag">+{quest.xp} XP</span>
            </div>
            <h2>{quest.title}</h2>
            <p>{quest.text}</p>
            <button
              disabled={s.completed.includes(quest.id) || pending}
              className={s.completed.includes(quest.id) ? "nav-secondary" : "nav-primary"}
              onClick={() =>
                quest.id === "lesson"
                  ? open({ type: "lesson" })
                  : change({ type: "quest", id: quest.id })
              }
            >
              {s.completed.includes(quest.id)
                ? "Выполнено"
                : quest.id === "lesson"
                  ? "Пройти урок"
                  : "Отметить выполнение"}
            </button>
          </Panel>
        ))}
      </div>
      <Panel title="Ваши навыки">
        <div className="nav-skills">
          {["Планирование", "Осознанные расходы", "Финансовый резерв", "Финансовые знания"].map(
            (name, i) => (
              <div key={name}>
                <span
                  className={`nav-icon ${s.completed.includes(NAV_QUESTS[i].id) ? "positive" : ""}`}
                >
                  {s.completed.includes(NAV_QUESTS[i].id) ? <Check /> : <Leaf />}
                </span>
                <strong>{name}</strong>
                <small>
                  {s.completed.includes(NAV_QUESTS[i].id)
                    ? "Первый шаг пройден"
                    : "Первый шаг впереди"}
                </small>
              </div>
            ),
          )}
        </div>
        <p className="nav-small">
          XP начисляется один раз за задание. Отметки не создают доход и не подтверждают отмену
          подписок в банке.
        </p>
      </Panel>
    </>
  );
}
