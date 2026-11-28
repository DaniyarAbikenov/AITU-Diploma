import type { ReactNode } from "react";
import { Info } from "lucide-react";

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
