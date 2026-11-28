import { Activity } from "lucide-react";
import { Field, Panel } from "../shared";
import { money, type DemoTabProps } from "../model";

export function ProfileTab({ s, m, open, change, pending }: DemoTabProps) {
  return (
    <>
      <div className="nav-profile-grid">
        <Panel title="Параметры вашего плана">
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              change({
                type: "settings",
                name: String(f.get("name")),
                income: Number(f.get("income")),
                essential: Number(f.get("essential")),
                hours: Number(f.get("hours")),
              });
            }}
          >
            <Field name="name" label="Как к вам обращаться" defaultValue={s.name} type="text" />
            <Field name="income" label="Чистый доход в месяц, ₸" defaultValue={s.income} />
            <Field
              name="essential"
              label="Обязательные расходы в месяц, ₸"
              defaultValue={s.essential}
            />
            <Field name="hours" label="Рабочие часы в месяц" defaultValue={s.hours} />
            <button className="nav-primary" disabled={pending}>
              Сохранить параметры
            </button>
          </form>
        </Panel>
        <div>
          <Panel title="Деньги — это ваше время">
            <span className="nav-icon">
              <Activity />
            </span>
            <p className="nav-large">
              {money(s.income / s.hours)} <span className="nav-small">/ час</span>
            </p>
            <p>Стоимость часа = чистый месячный доход ÷ рабочие часы.</p>
            <p className="nav-small">
              Покупка за 10 000 ₸ — примерно {(10000 / (s.income / s.hours)).toFixed(1)} ч. работы.
              Это способ сравнения, а не оценка ваших решений.
            </p>
          </Panel>
          <Panel title="Ваши счета">
            <div className="nav-account">
              <span>Текущий счёт</span>
              <strong>{money(m.checking)}</strong>
            </div>
            <div className="nav-account">
              <span>Накопления, включая все цели</span>
              <strong>{money(m.savings)}</strong>
            </div>
            <div className="nav-account">
              <span>Чистый капитал</span>
              <strong>{money(m.capital)}</strong>
            </div>
          </Panel>
        </div>
      </div>
      <Panel title="Демонстрационные данные">
        <p>
          Изменения сохраняются в этом браузере. Прототип не подключён к банкам, не выполняет
          платежи и не использует данные основного приложения.
        </p>
        <p className="nav-small">
          Дата модели зафиксирована: 27 ноября 2026. Сброс затронет только Financial Life Navigator.
        </p>
        <button className="nav-secondary" onClick={() => open({ type: "reset" })}>
          Восстановить исходное демо
        </button>
      </Panel>
    </>
  );
}
