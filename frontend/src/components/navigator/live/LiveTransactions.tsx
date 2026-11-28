import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ArrowDownLeft, ArrowLeftRight, Search, Send, Wallet } from "lucide-react";
import { q } from "@/api/client";
import type { Account, Transaction, TxKind } from "@/api/types";
import { bankName, ru } from "@/i18n/ru";
import { formatMonth, monthRange, monthTotals, recentMonths, txKind } from "@/lib/navigator-live";
import { money } from "../model";
import { Panel } from "../shared";
import { TxDialog } from "./forms";
import type { LiveProps } from "./types";

const t = ru.live.transactions;
const KINDS = Object.keys(ru.txKind) as TxKind[];

function KindIcon({ kind }: { kind: TxKind }) {
  if (kind === "transfer_own") return <ArrowLeftRight size={20} />;
  if (kind === "transfer_third_party") return <Send size={20} />;
  if (kind.startsWith("income")) return <ArrowDownLeft size={20} />;
  return <Wallet size={20} />;
}

/** Operation rows of the working mode. Own transfers are shown as transfers, never as spending (FR-18). */
export function TxList({
  rows,
  accounts,
  onPick,
}: {
  rows: Transaction[];
  accounts: Account[];
  onPick?: (t: Transaction) => void;
}) {
  const acc = new Map(accounts.map((a) => [a.id, a]));
  return (
    <div className="nav-transaction-list">
      {rows.map((x) => {
        const kind = txKind(x),
          a = acc.get(x.accountId);
        const Tag = onPick ? "button" : "div";
        return (
          <Tag
            key={x.id}
            className="nav-transaction"
            onClick={onPick ? () => onPick(x) : undefined}
          >
            <span
              className={`nav-icon ${x.amount > 0 && kind !== "transfer_own" ? "positive" : ""}`}
            >
              <KindIcon kind={kind} />
            </span>
            <span className="nav-transaction-name">
              <strong>{x.merchant}</strong>
              <small>
                {x.voided ? `${ru.crud.tx.voided} · ` : ""}
                {ru.txKind[kind]}
                {x.source === "manual"
                  ? ` · ${ru.crud.tx.manual}`
                  : x.kindSource === "user"
                    ? " · тип задан вами"
                    : ""}{" "}
                · {a ? bankName(a.bank) : "—"} ·{" "}
                {new Date(x.date + "T12:00:00Z").toLocaleDateString("ru-RU", {
                  day: "numeric",
                  month: "short",
                  timeZone: "UTC",
                })}
              </small>
            </span>
            <strong className={x.amount > 0 && kind !== "transfer_own" ? "nav-positive" : ""}>
              {kind === "transfer_own" ? "" : x.amount > 0 ? "+" : "−"}
              {money(Math.abs(x.amount))}
            </strong>
          </Tag>
        );
      })}
    </div>
  );
}

export function LiveTransactions({ accounts, today, notify }: LiveProps) {
  const months = useMemo(() => recentMonths(today), [today]);
  const [month, setMonth] = useState(months[0]),
    [bank, setBank] = useState(""),
    [account, setAccount] = useState(""),
    [kind, setKind] = useState(""),
    [search, setSearch] = useState(""),
    [picked, setPicked] = useState<Transaction | null>(null);
  const range = monthRange(month);
  const query = useQuery(
    q.transactionsFor({ ...range, bank: bank || undefined, account: account || undefined }),
  );
  const banks = [...new Set(accounts.map((a) => a.bank))];
  const rows = (query.data ?? []).filter(
    (x) => (!kind || txKind(x) === kind) && x.merchant.toLowerCase().includes(search.toLowerCase()),
  );
  const totals = monthTotals(query.data ?? []);
  return (
    <>
      <div className="nav-kpis compact">
        <Panel>
          <p>{t.income}</p>
          <h2>{money(totals.income)}</h2>
        </Panel>
        <Panel>
          <p>{t.expense}</p>
          <h2>{money(totals.expense)}</h2>
        </Panel>
        <Panel>
          <p>{t.own}</p>
          <h2>{money(totals.own)}</h2>
          <p className="nav-small">{t.ownHint}</p>
        </Panel>
      </div>
      <Panel title={`История операций · ${formatMonth(month)}`}>
        <div className="nav-filters">
          <label className="nav-search">
            <Search size={18} />
            <input
              placeholder={t.search}
              aria-label={t.search}
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </label>
          <select aria-label={t.month} value={month} onChange={(e) => setMonth(e.target.value)}>
            {months.map((m) => (
              <option key={m} value={m}>
                {formatMonth(m)}
              </option>
            ))}
          </select>
          <select
            aria-label={t.bank}
            value={bank}
            onChange={(e) => {
              setBank(e.target.value);
              setAccount("");
            }}
          >
            <option value="">{t.allBanks}</option>
            {banks.map((b) => (
              <option key={b} value={b}>
                {bankName(b)}
              </option>
            ))}
          </select>
          <select
            aria-label={t.account}
            value={account}
            onChange={(e) => setAccount(e.target.value)}
          >
            <option value="">{t.allAccounts}</option>
            {accounts
              .filter((a) => !bank || a.bank === bank)
              .map((a) => (
                <option key={a.id} value={a.id}>
                  {bankName(a.bank)} · {a.name}
                </option>
              ))}
          </select>
          <select aria-label={t.kind} value={kind} onChange={(e) => setKind(e.target.value)}>
            <option value="">{t.allKinds}</option>
            {KINDS.map((k) => (
              <option key={k} value={k}>
                {ru.txKind[k]}
              </option>
            ))}
          </select>
        </div>
        {query.isPending ? (
          <p className="nav-small">{ru.common.loading}</p>
        ) : query.isError ? (
          <p className="nav-error" role="alert">
            {query.error.message}
          </p>
        ) : rows.length ? (
          <TxList rows={rows} accounts={accounts} onPick={setPicked} />
        ) : (
          <div className="nav-empty">
            <Search />
            <h3>{t.empty}</h3>
            <p>{t.emptyHint}</p>
          </div>
        )}
      </Panel>
      <TxDialog
        tx={picked}
        open={!!picked}
        accounts={accounts}
        today={today}
        onClose={() => setPicked(null)}
        notify={notify}
      />
    </>
  );
}
