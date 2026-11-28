import { ArrowDownLeft, Coffee, Search, Target, Wallet } from "lucide-react";
import type { NavTransaction } from "@/lib/navigator";
import { money, type Modal } from "./model";

export function TransactionRows({
  rows,
  open,
}: {
  rows: NavTransaction[];
  open: (m: Modal) => void;
}) {
  return rows.length ? (
    <div className="nav-transaction-list">
      {[...rows]
        .sort((a, b) => b.date.localeCompare(a.date))
        .map((t) => (
          <button
            key={t.id}
            className="nav-transaction"
            onClick={() =>
              t.kind === "transfer"
                ? open({ type: "delete", entry: t })
                : open({ type: "transaction", entry: t })
            }
          >
            <span className={`nav-icon ${t.kind === "income" ? "positive" : ""}`}>
              {t.kind === "income" ? (
                <ArrowDownLeft size={20} />
              ) : t.kind === "transfer" ? (
                <Target size={20} />
              ) : t.category === "Кафе" ? (
                <Coffee size={20} />
              ) : (
                <Wallet size={20} />
              )}
            </span>
            <span className="nav-transaction-name">
              <strong>{t.name}</strong>
              <small>
                {t.category} ·{" "}
                {new Date(t.date + "T12:00:00").toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                })}
              </small>
            </span>
            <strong className={t.kind === "income" ? "nav-positive" : ""}>
              {t.kind === "income" ? "+" : t.kind === "transfer" ? "" : "−"}
              {money(t.amount)}
            </strong>
          </button>
        ))}
    </div>
  ) : (
    <div className="nav-empty">
      <Search />
      <h3>Пока нет операций</h3>
      <p>Измените фильтр или добавьте первую операцию.</p>
    </div>
  );
}
