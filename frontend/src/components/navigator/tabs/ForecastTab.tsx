import { ShieldCheck } from "lucide-react";
import { ForecastView } from "../ForecastView";
import { Panel } from "../shared";
import { money, type DemoTabProps } from "../model";

export function ForecastTab({
  s,
  m,
  months,
  setMonths,
  lost,
  setLost,
  extra,
  setExtra,
}: DemoTabProps & {
  months: number;
  setMonths: (n: number) => void;
  lost: number;
  setLost: (n: number) => void;
  extra: number;
  setExtra: (n: number) => void;
}) {
  return (
    <>
      <div className="nav-simulation">
        <Panel title="Соберите свой сценарий">
          <label className="nav-field">
            Горизонт прогноза
            <select value={months} onChange={(e) => setMonths(+e.target.value)}>
              <option value={6}>6 месяцев</option>
              <option value={12}>12 месяцев</option>
              <option value={24}>24 месяца</option>
            </select>
          </label>
          <label className="nav-field">
            Без дохода: {lost} мес.
            <input
              type="range"
              min="0"
              max="6"
              value={lost}
              onChange={(e) => setLost(+e.target.value)}
            />
          </label>
          <label className="nav-field">
            Дополнительные расходы: {money(extra)} / мес.
            <input
              type="range"
              min="0"
              max="300000"
              step="10000"
              value={extra}
              onChange={(e) => setExtra(+e.target.value)}
            />
          </label>
          <button
            className="nav-secondary"
            onClick={() => {
              setLost(3);
              setExtra(0);
            }}
          >
            Стресс-тест: 3 месяца без дохода
          </button>
          <button
            className="nav-text-button"
            onClick={() => {
              setLost(0);
              setExtra(0);
            }}
          >
            Вернуть базовый сценарий
          </button>
          <div className="nav-gentle">
            <ShieldCheck size={22} />
            <p>
              Резерва хватит на{" "}
              <strong>{Math.floor((m.reserve / (s.essential + extra)) * 30)} дней</strong>.
            </p>
          </div>
          <p className="nav-small">
            В резерв входят только средства цели «Подушка спокойствия». Остальные цели не считаются
            доступным резервом.
          </p>
        </Panel>
        <Panel title="Возможная траектория капитала">
          <ForecastView s={s} months={months} lost={lost} extra={extra} detail />
        </Panel>
      </div>
      <Panel title="Что лежит в основе прогноза">
        <p>
          Начальный капитал {money(m.capital)} + доход {money(s.income)} / мес. − обязательные
          расходы {money(s.essential)} / мес. − дополнительные расходы. Потеря дохода применяется к
          первым {lost} месяцам.
        </p>
        <p className="nav-small">
          Взносы в цели не вычитаются из капитала: это внутреннее распределение денег. Налоги,
          инфляция, проценты и непредвиденные расходы не моделируются. Это демонстрационный расчёт.
        </p>
      </Panel>
    </>
  );
}
