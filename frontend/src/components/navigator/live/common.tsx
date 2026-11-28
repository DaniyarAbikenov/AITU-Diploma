import type { ReactNode } from "react";
import { Info } from "lucide-react";
import type { Account } from "@/api/types";
import { ru } from "@/i18n/ru";
import { formatMoney } from "@/lib/format";
import { formatDay } from "@/lib/navigator-live";

/** "Empty is not zero": explains why a number is missing and leads to the field that fixes it (FR-24/25). */
export function Missing({
  children,
  action,
  onAction,
}: {
  children: ReactNode;
  action?: string;
  onAction?: () => void;
}) {
  return (
    <div className="nav-note" role="note">
      <Info size={18} />
      <div>
        <p>{children}</p>
        {action && onAction && (
          <button className="nav-text-button" type="button" onClick={onAction}>
            {action}
          </button>
        )}
      </div>
    </div>
  );
}

export function Preliminary() {
  return <span className="nav-pill warn">предварительно</span>;
}

/** Tenge equivalent of a foreign-currency account with the rate date (and a stale mark when the feed is down). */
export function KztHint({ a }: { a: Account }) {
  if (a.currency === "KZT") return null;
  const kzt = a.currentBalanceKzt ?? a.balanceKzt;
  if (kzt == null || !a.rateDate) return <small className="nav-small">{ru.fx.noRate}</small>;
  return (
    <small className="nav-small">
      {ru.fx.approx(formatMoney(kzt), formatDay(a.rateDate))}
      {a.rateStale ? ` · ${ru.fx.stale}` : ""}
    </small>
  );
}
