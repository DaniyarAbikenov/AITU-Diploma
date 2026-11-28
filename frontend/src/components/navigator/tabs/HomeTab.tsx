import {
  Activity,
  Check,
  ChevronRight,
  Info,
  Leaf,
  ShieldCheck,
  Sparkles,
  Wallet,
  X,
  Coffee,
} from "lucide-react";
import { GoalCards } from "../GoalCards";
import { ForecastView } from "../ForecastView";
import { TransactionRows } from "../TransactionRows";
import { City, Panel } from "../shared";
import { compact, money, type DemoTabProps } from "../model";

export function HomeTab({
  s,
  m,
  open,
  go,
  change,
  months,
  lost,
  extra,
}: DemoTabProps & { months: number; lost: number; extra: number }) {
  return (
    <>
      <div className="nav-top-grid">
        <section className="nav-hero">
          <div className="nav-hero-content">
            <span className="nav-hero-label">
              <Leaf size={16} /> ВАШ ФИНАНСОВЫЙ МИР
            </span>
            <h2>
              Строим будущее.
              <br />В вашем темпе.
            </h2>
            <p>
              Каждое накопление — ещё один
              <br className="nav-desktop" /> кирпичик в вашу независимость.
            </p>
            <button onClick={() => go("goals")}>Посмотреть мои цели</button>
          </div>
          <City />
          <div className="nav-hero-foot">
            <span className="nav-mini-circle">
              <Check size={13} />
            </span>
            Ваш прогресс сохраняется, даже когда вы отдыхаете
          </div>
        </section>
        <section className="nav-safe">
          <div className="nav-between">
            <span>Свободно сегодня</span>
            <button
              aria-label="Как рассчитана свободная сумма"
              onClick={() => open({ type: "safe" })}
            >
              <Info size={19} />
            </button>
          </div>
          <p className="nav-safe-amount">{money(m.daily)}</p>
          <p>
            На приятное и повседневное —<br />с учётом ближайших обязательств.
          </p>
          <div className="nav-safe-line" />
          <div className="nav-between">
            <span>До следующей зарплаты</span>
            <strong>{s.daysToSalary} дней</strong>
          </div>
          <button className="nav-safe-link" onClick={() => open({ type: "safe" })}>
            Как мы это посчитали?
          </button>
        </section>
      </div>
      <div className="nav-kpis">
        <button onClick={() => open({ type: "score" })}>
          <span className="nav-kpi-icon">
            <ShieldCheck />
          </span>
          <span>
            <small>Финансовая устойчивость</small>
            <strong>
              {m.score}
              <em> / 100</em>
            </strong>
            <small>Есть пространство для роста</small>
          </span>
          <span
            className="nav-ring"
            style={{ background: `conic-gradient(#29966b ${m.score}%, #e8eee9 0)` }}
          >
            <span>{m.score}</span>
          </span>
        </button>
        <button onClick={() => go("profile")}>
          <span className="nav-kpi-icon">
            <Wallet />
          </span>
          <span>
            <small>Ваш чистый капитал</small>
            <strong>{compact(m.capital)}</strong>
            <small>Счета и накопления · долгов в демо нет</small>
          </span>
        </button>
        <button onClick={() => go("forecast")}>
          <span className="nav-kpi-icon warm">
            <Activity />
          </span>
          <span>
            <small>Запас спокойствия</small>
            <strong>
              {m.runway}
              <em> дней</em>
            </strong>
            <small>Резерв на обязательные расходы</small>
          </span>
        </button>
      </div>
      <div className="nav-section-title">
        <h2>Ближе к вашим целям</h2>
        <button onClick={() => go("goals")}>
          Все цели <ChevronRight size={16} />
        </button>
      </div>
      <GoalCards s={s} open={open} />
      {!s.dismissed && (
        <div className="nav-tip">
          <Sparkles size={22} />
          <div>
            <strong>Сначала спокойствие, потом большие планы</strong>
            <p>Сравните параллельные накопления со стратегией «Сначала резерв».</p>
          </div>
          <button onClick={() => open({ type: "strategy" })}>Сравнить стратегии</button>
          <button aria-label="Скрыть рекомендацию" onClick={() => change({ type: "dismiss" })}>
            <X size={18} />
          </button>
        </div>
      )}
      <div className="nav-bottom-grid">
        <Panel
          title="Взгляд в будущее"
          action={
            <button className="nav-text-button" onClick={() => go("forecast")}>
              Прогноз <ChevronRight size={16} />
            </button>
          }
        >
          <ForecastView s={s} months={months} lost={lost} extra={extra} />
        </Panel>
        <Panel
          title="Последние операции"
          action={
            <button className="nav-text-button" onClick={() => go("transactions")}>
              Все
            </button>
          }
        >
          <TransactionRows rows={s.transactions.slice(0, 4)} open={open} />
          <div className="nav-gentle">
            <Coffee size={18} />
            <p>
              Кофе — часть жизни.
              <br />
              <span>План помогает тратить без чувства вины.</span>
            </p>
          </div>
        </Panel>
      </div>
    </>
  );
}
