import { ChevronLeft, ChevronRight } from "lucide-react";
import { EstimateNote } from "@/components/kit";
import { DEMO_DATE, NAV_MODEL, navMetrics, type NavigatorState } from "@/lib/navigator";
import { Panel } from "../shared";
import { compact, money } from "../model";

export function CalendarTab({
  state: s,
  offset,
  onOffset,
}: {
  state: NavigatorState;
  offset: number;
  onOffset: (n: number) => void;
}) {
  const date = new Date(2026, 11 + offset, 1),
    year = date.getFullYear(),
    month = date.getMonth(),
    days = new Date(year, month + 1, 0).getDate(),
    first = (date.getDay() + 6) % 7;
  const events = [
    { day: 5, name: "Аренда", amount: -145000 },
    { day: 10, name: "Коммунальные услуги", amount: -32900 },
    { day: 25, name: "Зарплата", amount: s.income },
  ];
  let balance = navMetrics(s).checking;
  const rows = Array.from({ length: days }, (_, i) => {
    const day = i + 1,
      event = events.find((e) => e.day === day);
    balance += event?.amount ?? 0;
    return { day, event, balance };
  });
  return (
    <>
      <Panel
        title={date.toLocaleDateString("ru-RU", { month: "long", year: "numeric" })}
        action={
          <div className="nav-actions">
            <button
              aria-label="Предыдущий месяц"
              disabled={offset <= 0}
              onClick={() => onOffset(offset - 1)}
            >
              <ChevronLeft size={20} />
            </button>
            <button
              aria-label="Следующий месяц"
              disabled={offset >= 11}
              onClick={() => onOffset(offset + 1)}
            >
              <ChevronRight size={20} />
            </button>
          </div>
        }
      >
        <p className="nav-small">
          Демонстрационный план. Каждый месяц рассчитывается отдельно от текущего баланса;
          повседневные расходы не включены.
        </p>
        <div className="nav-calendar">
          {["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"].map((d) => (
            <strong key={d}>{d}</strong>
          ))}
          {Array.from({ length: first }, (_, i) => (
            <span key={`blank${i}`} />
          ))}
          {rows.map((r) => (
            <div
              key={r.day}
              className={`${r.event ? "has-event" : ""} ${r.balance < 0 ? "risk-day" : ""}`}
            >
              <span>{r.day}</span>
              {r.event && (
                <>
                  <small>{r.event.name}</small>
                  <b className={r.event.amount > 0 ? "nav-positive" : ""}>
                    {r.event.amount > 0 ? "+" : ""}
                    {compact(r.event.amount)}
                  </b>
                </>
              )}
            </div>
          ))}
        </div>
      </Panel>
      <Panel title="Ближайшие события">
        {rows
          .filter((r) => r.event)
          .map((r) => (
            <div key={r.day} className="nav-event">
              <span className="nav-icon">{r.day}</span>
              <div>
                <strong>{r.event!.name}</strong>
                <p className="nav-small">Остаток после платежа: {money(r.balance)}</p>
              </div>
              <strong className={r.event!.amount > 0 ? "nav-positive" : ""}>
                {money(r.event!.amount)}
              </strong>
            </div>
          ))}
        <p className={rows.some((r) => r.balance < 0) ? "nav-warning" : "nav-small"}>
          {rows.some((r) => r.balance < 0)
            ? "При таком плане возникает кассовый разрыв. Проверьте даты платежей и доступный остаток."
            : "По перечисленным событиям отрицательного остатка нет. Повседневные расходы могут изменить результат."}
        </p>
        <p className="nav-small">
          Диапазон доступного остатка: от расчётного остатка минус {money(s.essential * 0.2)} до
          расчётного остатка; учитывает возможные дополнительные расходы до 20% месячных
          обязательств.
        </p>
        <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
      </Panel>
    </>
  );
}
