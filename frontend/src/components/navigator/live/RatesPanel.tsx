import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { q } from "@/api/client";
import { ru } from "@/i18n/ru";
import { convert, formatDay, rateMap } from "@/lib/navigator-live";
import { moneyIn } from "../model";
import { Panel } from "../shared";

const t = ru.fx;
const CURRENCIES = ["KZT", "USD", "EUR", "RUB"];

/** Official NBK rates with their date and a converter between tenge and the account currencies. */
export function RatesPanel() {
  const rates = useQuery(q.rates);
  const [amount, setAmount] = useState("100"),
    [from, setFrom] = useState("USD"),
    [to, setTo] = useState("KZT");
  const map = rateMap(rates.data?.rates);
  const result = convert(Number(amount) || 0, from, to, map);
  return (
    <Panel title={t.ratesTitle}>
      <p className="nav-small">{t.ratesText}</p>
      {rates.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : rates.isError ? (
        <p className="nav-error" role="alert">
          {rates.error.message}
        </p>
      ) : (
        <div className="nav-live-list">
          {rates.data.rates.map((r) => (
            <div className="nav-account" key={r.currency}>
              <span>
                {t.rateLine(r.currency, String(r.rate).replace(".", ","), formatDay(r.rateDate))}
              </span>
              {r.stale && <small className="nav-pill warn">{t.stale}</small>}
            </div>
          ))}
        </div>
      )}
      <h3>{t.converterTitle}</h3>
      <div className="nav-form">
        <label className="nav-field">
          {t.amount}
          <input
            type="number"
            min={0}
            step={0.01}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
        </label>
        <label className="nav-field">
          {t.from}
          <select value={from} onChange={(e) => setFrom(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <label className="nav-field">
          {t.to}
          <select value={to} onChange={(e) => setTo(e.target.value)}>
            {CURRENCIES.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
        <p className="nav-large" role="status">
          {result === null ? ru.fx.noRate : t.result(moneyIn(result, to))}
        </p>
      </div>
    </Panel>
  );
}
