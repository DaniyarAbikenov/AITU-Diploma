import { Trash2 } from "lucide-react";
import { EstimateNote } from "@/components/kit";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { DEMO_DATE, NAV_MODEL, goalMonths } from "@/lib/navigator";
import { Field } from "./shared";
import { money, type DemoTabProps, type Modal } from "./model";

export function NavigatorDialog({
  s,
  m,
  open,
  go,
  change,
  pending,
  modal,
  setModal,
  formError,
  lessonChoice,
  setLessonChoice,
  onReset,
  resetPending,
}: DemoTabProps & {
  modal: Modal;
  setModal: (m: Modal) => void;
  formError: string;
  lessonChoice: number | null;
  setLessonChoice: (n: number) => void;
  onReset: () => void;
  resetPending: boolean;
}) {
  return (
    <Dialog
      open={!!modal}
      onOpenChange={(v) => {
        if (!v) setModal(null);
      }}
    >
      <DialogContent className="navigator nav-dialog">
        <DialogHeader>
          <DialogTitle>
            {modal?.type === "transaction"
              ? modal.entry
                ? "Изменить операцию"
                : "Новая операция"
              : modal?.type === "transfer"
                ? `Пополнить: ${modal.goal.name}`
                : modal?.type === "goal"
                  ? "Новая финансовая цель"
                  : modal?.type === "strategy"
                    ? "Выберите маршрут к целям"
                    : modal?.type === "safe"
                      ? "Свободно сегодня — как это работает"
                      : modal?.type === "score"
                        ? "Из чего складывается устойчивость"
                        : modal?.type === "lesson"
                          ? "Коротко о финансовой подушке"
                          : modal?.type === "delete"
                            ? "Отменить операцию?"
                            : "Восстановить демо?"}
          </DialogTitle>
          <DialogDescription>Демонстрация · реальные деньги не перемещаются</DialogDescription>
        </DialogHeader>
        {modal?.type === "transaction" && (
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              change({
                type: "transaction",
                id: modal.entry?.id,
                entry: {
                  name: String(f.get("name")),
                  amount: Number(f.get("amount")),
                  kind: String(f.get("kind")) as "income" | "expense",
                  date: String(f.get("date")),
                  category: String(f.get("category")),
                },
              });
            }}
          >
            <label className="nav-field">
              Тип
              <select name="kind" defaultValue={modal.entry?.kind ?? "expense"}>
                <option value="expense">Расход</option>
                <option value="income">Доход</option>
              </select>
            </label>
            <Field
              name="name"
              label="Название"
              type="text"
              defaultValue={modal.entry?.name}
              placeholder="Например, продукты"
            />
            <Field name="amount" label="Сумма, ₸" defaultValue={modal.entry?.amount} />
            <label className="nav-field">
              Категория
              <select name="category" defaultValue={modal.entry?.category ?? "Продукты"}>
                {["Продукты", "Кафе", "Транспорт", "Дом", "Другое", "Доход"].map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </label>
            <label className="nav-field">
              Дата
              <input
                name="date"
                type="date"
                required
                max={DEMO_DATE}
                defaultValue={modal.entry?.date ?? DEMO_DATE}
              />
            </label>
            <p className="nav-small">
              Доступно на текущем счёте: {money(m.checking)}. Расход уменьшает баланс счёта;
              накопленные цели сохраняются.
            </p>
            <div className="nav-actions">
              <button className="nav-primary" disabled={pending}>
                Сохранить
              </button>
              {modal.entry && (
                <button
                  type="button"
                  className="nav-danger nav-secondary"
                  onClick={() => open({ type: "delete", entry: modal.entry! })}
                >
                  <Trash2 size={16} /> Удалить
                </button>
              )}
            </div>
          </form>
        )}
        {modal?.type === "transfer" && (
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              change({
                type: "transfer",
                goalId: modal.goal.id,
                amount: Number(new FormData(e.currentTarget).get("amount")),
              });
            }}
          >
            <p>
              С текущего счёта на накопительный. Доступно: <strong>{money(m.checking)}</strong>.
            </p>
            <Field
              name="amount"
              label="Сумма пополнения, ₸"
              defaultValue={Math.min(10000, m.checking, modal.goal.target - modal.goal.saved)}
            />
            <p className="nav-small">
              До цели осталось {money(modal.goal.target - modal.goal.saved)}. Капитал не изменится,
              свободная сумма уменьшится.
            </p>
            <button className="nav-primary" disabled={pending}>
              Подтвердить демоперевод
            </button>
          </form>
        )}
        {modal?.type === "goal" && (
          <form
            className="nav-form"
            onSubmit={(e) => {
              e.preventDefault();
              const f = new FormData(e.currentTarget);
              change({
                type: "goal",
                name: String(f.get("name")),
                target: Number(f.get("target")),
                monthly: Number(f.get("monthly")),
              });
            }}
          >
            <Field
              name="name"
              label="На что копим?"
              type="text"
              placeholder="Например, путешествие"
            />
            <Field name="target" label="Нужная сумма, ₸" />
            <Field name="monthly" label="План взноса в месяц, ₸" defaultValue={30000} />
            <button className="nav-primary" disabled={pending}>
              Создать цель
            </button>
          </form>
        )}
        {modal?.type === "safe" && (
          <>
            <div className="nav-formula">
              <div>
                <span>На текущем счёте</span>
                <strong>{money(m.checking)}</strong>
              </div>
              <div>
                <span>Ближайшие обязательства</span>
                <strong>−{money(s.committed)}</strong>
              </div>
              <div>
                <span>Осталось до зарплаты</span>
                <strong>{s.daysToSalary} дней</strong>
              </div>
              <div>
                <span>Свободно на день</span>
                <strong>{money(m.daily)}</strong>
              </div>
            </div>
            <p className="nav-small">
              max(0, текущий счёт − обязательства) ÷ дни до зарплаты. Цели и резерв уже находятся на
              отдельном накопительном счёте, поэтому повторно не вычитаются. Будущие добровольные
              взносы здесь не зарезервированы. Обязательства и дата зарплаты зафиксированы для демо.
            </p>
          </>
        )}
        {modal?.type === "score" && (
          <>
            <p className="nav-large">{m.score} / 100</p>
            <p>
              Резерв: до 60 баллов за покрытие 90 дней расходов. Положительный остаток дохода: до 25
              баллов. Покрытие ближайших платежей текущим счётом: 15 баллов.
            </p>
            <p className="nav-small">
              Это объяснимая демонстрационная шкала, не кредитный рейтинг и не валидированная
              финансовая оценка. XP в расчёт не входит.
            </p>
            <button
              className="nav-primary"
              onClick={() => {
                setModal(null);
                go("goals");
              }}
            >
              Перейти к резерву
            </button>
          </>
        )}
        {modal?.type === "strategy" && (
          <>
            <p>
              Общий план взносов: {money(s.goals.reduce((a, g) => a + g.monthly, 0))} / мес.
              Сравнение без инфляции и доходности.
            </p>
            <div className="nav-strategies">
              {(["parallel", "reserve"] as const).map((strategy) => (
                <div key={strategy}>
                  <h3>{strategy === "parallel" ? "Параллельно" : "Сначала резерв"}</h3>
                  <p>
                    {strategy === "parallel"
                      ? "Все цели получают свой ежемесячный взнос."
                      : "Все взносы идут в резерв до его заполнения; затем цели получают обычный взнос. Остаток остаётся свободным."}
                  </p>
                  {s.goals.slice(0, 3).map((g) => (
                    <p key={g.id} className="nav-small">
                      {g.name}: ~{goalMonths({ ...s, strategy }, g)} мес.
                    </p>
                  ))}
                  <button
                    className={s.strategy === strategy ? "nav-secondary" : "nav-primary"}
                    disabled={pending || s.strategy === strategy}
                    onClick={() => change({ type: "strategy", value: strategy })}
                  >
                    {s.strategy === strategy ? "Текущий план" : "Выбрать"}
                  </button>
                </div>
              ))}
            </div>
            <p className="nav-small">
              При изменении взносов на ±20% сроки составят примерно от 0,83 до 1,25 указанного
              срока. Стратегия меняет план, но не переводит деньги автоматически.
            </p>
            <EstimateNote asOf={DEMO_DATE} model={NAV_MODEL} />
          </>
        )}
        {modal?.type === "lesson" && (
          <>
            <p>
              Резерв помогает покрывать обязательные расходы, когда доход прерывается. Его полезно
              хранить отдельно от повседневного счёта и иметь возможность быстро использовать.
            </p>
            <h3>Какие средства подходят для резерва лучше?</h3>
            {[
              "Деньги на доступном накопительном счёте",
              "Вся стоимость квартиры",
              "Ожидаемая премия в следующем году",
            ].map((answer, i) => (
              <button
                key={answer}
                className={`nav-answer ${lessonChoice === i ? "selected" : ""}`}
                onClick={() => setLessonChoice(i)}
              >
                {answer}
              </button>
            ))}
            {lessonChoice !== null && (
              <p role="status">
                {lessonChoice === 0
                  ? "Верно: резерв должен быть доступен, когда он понадобится."
                  : "Попробуйте ещё: продать квартиру или дождаться премии быстро может не получиться."}
              </p>
            )}
            <button
              className="nav-primary"
              disabled={lessonChoice !== 0 || pending}
              onClick={() => change({ type: "quest", id: "lesson" })}
            >
              Завершить урок · +15 XP
            </button>
          </>
        )}
        {modal?.type === "delete" && (
          <>
            <p>
              «{modal.entry.name}» — {money(modal.entry.amount)}. Балансы будут пересчитаны. Для
              перевода деньги вернутся из цели на текущий счёт.
            </p>
            <button
              className="nav-primary"
              disabled={pending}
              onClick={() => change({ type: "delete", id: modal.entry.id })}
            >
              Подтвердить отмену
            </button>
          </>
        )}
        {modal?.type === "reset" && (
          <>
            <p>
              Ваши добавленные операции, цели, параметры и XP этого демо будут заменены исходным
              примером Алии.
            </p>
            <button className="nav-primary" disabled={resetPending} onClick={onReset}>
              Сбросить только это демо
            </button>
          </>
        )}
        {formError && (
          <p className="nav-error" role="alert">
            {formError}
          </p>
        )}
      </DialogContent>
    </Dialog>
  );
}
