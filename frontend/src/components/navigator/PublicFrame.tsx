import type { ReactNode } from "react";
import { Compass } from "lucide-react";
import { ru } from "@/i18n/ru";
import "./navigator.css";

/** Frame of the public pages (landing, sign-in, registration, onboarding) in the Navigator style. */
export function PublicFrame({ children, actions }: { children: ReactNode; actions?: ReactNode }) {
  return (
    <div className="navigator nav-public">
      <header className="nav-public-top">
        <a href="/" className="nav-brand">
          <span>
            <Compass size={27} />
          </span>
          <div>
            {ru.brand.name}
            <small>{ru.pub.brandTagline}</small>
          </div>
        </a>
        {actions && <div className="nav-actions">{actions}</div>}
      </header>
      {children}
    </div>
  );
}
