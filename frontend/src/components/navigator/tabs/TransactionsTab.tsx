import { Search } from "lucide-react";
import { TransactionRows } from "../TransactionRows";
import { Panel, Progress } from "../shared";
import { compact, money, type DemoTabProps } from "../model";

export function TransactionsTab({
  s,
  m,
  open,
  search,
  setSearch,
  filter,
  setFilter,
}: DemoTabProps & {
  search: string;
  setSearch: (v: string) => void;
  filter: string;
  setFilter: (v: string) => void;
}) {
  return (
    <>
      <div className="nav-kpis compact">
        <Panel>
          <p>Текущий счёт</p>
          <h2>{money(m.checking)}</h2>
        </Panel>
        <Panel>
          <p>Накопительный счёт</p>
          <h2>{money(m.savings)}</h2>
        </Panel>
        <Panel>
          <p>Расходы в демо-периоде</p>
          <h2>{money(m.expenses)}</h2>
        </Panel>
      </div>
      <Panel title="История операций">
        <div className="nav-filters">
          <label className="nav-search">
            <Search size={18} />
            <input
              placeholder="Найти операцию"
              aria-label="Найти операцию"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select
            aria-label="Тип операции"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
          >
            <option value="all">Все операции</option>
            <option value="expense">Расходы</option>
            <option value="income">Доходы</option>
            <option value="transfer">Переводы в цели</option>
          </select>
        </div>
        <TransactionRows
          open={open}
          rows={s.transactions.filter(
            (t) =>
              (filter === "all" || t.kind === filter) &&
              `${t.name} ${t.category}`.toLowerCase().includes(search.toLowerCase()),
          )}
        />
      </Panel>
      <Panel title="Расходы по категориям">
        <div className="nav-budget-grid">
          {["Продукты", "Кафе", "Транспорт", "Дом", "Другое"].map((cat, i) => {
            const spent = s.transactions
                .filter((t) => t.kind === "expense" && t.category === cat)
                .reduce((a, t) => a + t.amount, 0),
              budget = [80000, 30000, 25000, 180000, 30000][i];
            return (
              <div key={cat}>
                <div className="nav-between">
                  <strong>{cat}</strong>
                  <span className={spent > budget ? "nav-danger" : ""}>
                    {money(spent)} / {compact(budget)}
                  </span>
                </div>
                <Progress value={(spent / budget) * 100} label={`Бюджет ${cat}`} />
                {spent > budget && (
                  <p className="nav-small nav-danger">
                    Выше демонстрационного лимита на {money(spent - budget)}
                  </p>
                )}
              </div>
            );
          })}
        </div>
        <p className="nav-small">
          Демонстрационные месячные лимиты. История содержит операции за 24–27 ноября.
        </p>
      </Panel>
    </>
  );
}
