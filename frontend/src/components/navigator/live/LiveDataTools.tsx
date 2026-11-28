import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { api, q } from "@/api/client";
import type { Transaction } from "@/api/types";
import { Chart, baseAxis } from "@/components/charts";
import { ru } from "@/i18n/ru";
import { formatMonth } from "@/lib/navigator-live";
import { compact, money } from "../model";
import { Panel } from "../shared";
import { Missing } from "./common";
import { FormError } from "./forms";
import { confirmed, useWrite } from "./hooks";

const t = ru.tools;

/** Operations whose category the categorizer was unsure about: fix one or make a merchant rule. */
export function ReviewPanel({ notify }: { notify: (m: string) => void }) {
  const all = useQuery(q.transactions);
  const cats = useQuery(q.categories);
  const [limit, setLimit] = useState(20);
  const rows = (all.data ?? []).filter((x) => x.needsReview && !x.voided);
  const one = useWrite(
    ({ id, c }: { id: string; c: string }) => api.recategorize(id, c),
    () => notify(ru.crud.saved),
  );
  const bulk = useWrite(
    ({ merchant, c }: { merchant: string; c: string }) => api.bulkCategorize(merchant, c),
    () => notify(ru.crud.saved),
  );
  if (all.isPending) return null;
  return (
    <Panel title={t.reviewTitle(rows.length)}>
      {rows.length === 0 ? (
        <p className="nav-small">{t.reviewEmpty}</p>
      ) : (
        <>
          <p className="nav-small">{t.reviewText}</p>
          <div className="nav-live-list">
            {rows.slice(0, limit).map((x: Transaction) => (
              <ReviewRow
                key={x.id}
                tx={x}
                cats={cats.data ?? []}
                busy={one.isPending || bulk.isPending}
                onOne={(c) => one.mutate({ id: x.id, c })}
                onAll={(c) => bulk.mutate({ merchant: x.merchant, c })}
              />
            ))}
          </div>
          {rows.length > limit && (
            <button className="nav-secondary" onClick={() => setLimit(limit + 20)}>
              {t.more(rows.length - limit)}
            </button>
          )}
        </>
      )}
      <FormError error={one.error || bulk.error} />
    </Panel>
  );
}

function ReviewRow({
  tx,
  cats,
  busy,
  onOne,
  onAll,
}: {
  tx: Transaction;
  cats: { id: string; name: string }[];
  busy: boolean;
  onOne: (c: string) => void;
  onAll: (c: string) => void;
}) {
  const [cat, setCat] = useState(tx.categoryId);
  return (
    <div className="nav-live-row">
      <div>
        <strong>{tx.merchant}</strong>
        <p className="nav-small">
          {tx.date} · {money(tx.amount)}
        </p>
      </div>
      <label className="nav-field">
        {ru.crud.tx.category}
        <select
          value={cat}
          aria-label={`${ru.crud.tx.category}: ${tx.merchant}`}
          onChange={(e) => {
            setCat(e.target.value);
            onOne(e.target.value);
          }}
          disabled={busy}
        >
          {cats.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </label>
      <button className="nav-text-button" disabled={busy} onClick={() => onAll(cat)}>
        {t.applyAll}
      </button>
    </div>
  );
}

export function RulesPanel({ notify }: { notify: (m: string) => void }) {
  const rules = useQuery(q.rules);
  const cats = useQuery(q.categories);
  const del = useWrite(
    (id: string) => api.deleteRule(id),
    () => notify(ru.crud.deleted),
  );
  const name = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? id;
  return (
    <Panel title={t.rulesTitle}>
      {rules.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : !rules.data?.length ? (
        <Missing>{t.rulesEmpty}</Missing>
      ) : (
        <div className="nav-live-list">
          {rules.data.map((r) => (
            <div className="nav-live-row" key={r.id}>
              <div>
                <strong>{r.merchant}</strong>
                <p className="nav-small">
                  → {name(r.categoryId)}
                  {r.kind ? ` · ${ru.txKind[r.kind]}` : ""}
                </p>
              </div>
              <button
                className="nav-text-button"
                aria-label={`${t.ruleDelete}: ${r.merchant}`}
                disabled={del.isPending}
                onClick={() => confirmed(t.ruleDeleteConfirm(r.merchant)) && del.mutate(r.id)}
              >
                <Trash2 size={16} /> {ru.common.delete}
              </button>
            </div>
          ))}
        </div>
      )}
      <FormError error={del.error} />
    </Panel>
  );
}

/** Spending by category in the selected month against the previous one. */
export function CompareMonths({ month }: { month: string }) {
  const s = useQuery(q.summary(month));
  const cats = useQuery(q.categories);
  const name = (id: string) => cats.data?.find((c) => c.id === id)?.name ?? id;
  const rows = (s.data?.topCategories ?? []).filter((r) => r.amount > 0 || r.prev > 0);
  return (
    <Panel title={t.compareTitle(formatMonth(month))}>
      {s.isPending ? (
        <p className="nav-small">{ru.common.loading}</p>
      ) : s.isError ? (
        <p className="nav-error" role="alert">
          {s.error.message}
        </p>
      ) : !rows.length ? (
        <Missing>{t.compareEmpty}</Missing>
      ) : (
        <Chart
          paletteScope=".navigator"
          height={Math.max(240, rows.length * 34)}
          label={rows
            .map((r) => `${name(r.categoryId)} ${compact(r.amount)} против ${compact(r.prev)}`)
            .join("; ")}
          option={(p) => ({
            ...baseAxis(p),
            legend: {
              data: [t.prevMonth, t.thisMonth],
              top: 0,
              textStyle: { color: p["muted-foreground"] },
            },
            grid: { left: 4, right: 12, top: 30, bottom: 4, containLabel: true },
            xAxis: { type: "value", axisLabel: { formatter: (v: number) => compact(v) } },
            yAxis: { type: "category", inverse: true, data: rows.map((r) => name(r.categoryId)) },
            series: [
              {
                name: t.prevMonth,
                type: "bar",
                data: rows.map((r) => r.prev),
                itemStyle: { color: p.border },
              },
              {
                name: t.thisMonth,
                type: "bar",
                data: rows.map((r) => r.amount),
                itemStyle: { color: p.primary },
              },
            ],
          })}
        />
      )}
    </Panel>
  );
}

/** Ambiguous transfer pairs from statements: the user picks which incoming operation is the same transfer. */
export function TransferPairsPanel({ notify }: { notify: (m: string) => void }) {
  const cands = useQuery(q.transferCandidates);
  const all = useQuery({ ...q.transactions, enabled: !!cands.data?.length });
  const link = useWrite(
    ({ outId, inId }: { outId: string; inId: string }) => api.linkTransfer(outId, inId),
    () => notify(ru.crud.saved),
  );
  if (!cands.data?.length) return null;
  const byId = new Map((all.data ?? []).map((x) => [x.id, x]));
  const label = (id: string) => {
    const x = byId.get(id);
    return x ? `${x.date} · ${x.merchant} · ${money(Math.abs(x.amount))}` : id;
  };
  return (
    <Panel title={ru.dep.pairsTitle}>
      <p className="nav-small">{ru.dep.pairsText}</p>
      <div className="nav-live-list">
        {cands.data.map((c) => (
          <form
            key={c.outId}
            className="nav-live-row"
            onSubmit={(e) => {
              e.preventDefault();
              link.mutate({
                outId: c.outId,
                inId: String(new FormData(e.currentTarget).get("in")),
              });
            }}
          >
            <div>
              <strong>{label(c.outId)}</strong>
            </div>
            <label className="nav-field">
              {ru.dep.transferTo}
              <select name="in">
                {c.inIds.map((id) => (
                  <option key={id} value={id}>
                    {label(id)}
                  </option>
                ))}
              </select>
            </label>
            <button className="nav-secondary" disabled={link.isPending}>
              {ru.dep.link}
            </button>
          </form>
        ))}
      </div>
      <FormError error={link.error} />
    </Panel>
  );
}
