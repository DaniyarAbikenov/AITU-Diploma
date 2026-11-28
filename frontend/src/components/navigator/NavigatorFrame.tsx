import type { ReactNode } from "react";
import { Compass, Database, FlaskConical, ShieldCheck } from "lucide-react";
import { ru } from "@/i18n/ru";
import { tabs, type Tab } from "./model";

export type NavMode = "demo" | "live";

/** Segmented switch between the demo and the user's own data (FR-01). */
export function ModeSwitch({ mode, onMode }: { mode: NavMode; onMode: (m: NavMode) => void }) {
  return (
    <div className="nav-mode-switch" role="group" aria-label={ru.mode.switchLabel}>
      {(["live", "demo"] as const).map((m) => (
        <button
          key={m}
          type="button"
          className={mode === m ? "active" : ""}
          aria-pressed={mode === m}
          onClick={() => onMode(m)}
        >
          {m === "live" ? <Database size={15} /> : <FlaskConical size={15} />}
          {m === "live" ? ru.mode.live : ru.mode.demo}
        </button>
      ))}
    </div>
  );
}

/** Sidebar, top bar with the mode badge, page heading, footer and mobile navigation shared by both modes. */
export function NavigatorFrame({
  mode,
  onMode,
  tab,
  go,
  name,
  sidebarExtra,
  questCount,
  action,
  error,
  footer,
  children,
  overlay,
}: {
  mode: NavMode;
  onMode: (m: NavMode) => void;
  tab: Tab;
  go: (t: Tab) => void;
  name: string;
  sidebarExtra?: ReactNode;
  questCount?: number;
  action?: ReactNode;
  error?: ReactNode;
  footer: string;
  children: ReactNode;
  overlay?: ReactNode;
}) {
  return (
    <div className={`navigator nav-mode-${mode}`}>
      <aside className="nav-sidebar">
        <a href="/navigator" className="nav-brand">
          <span>
            <Compass size={27} />
          </span>
          <div>
            {ru.brand.name}
            <small>{ru.brand.tagline}</small>
          </div>
        </a>
        <p className="nav-sidebar-caption">{ru.brand.space}</p>
        <nav aria-label="Разделы навигатора">
          {tabs.map(({ id, name, icon: Icon }) => (
            <button
              key={id}
              className={tab === id ? "active" : ""}
              onClick={() => go(id)}
              aria-current={tab === id ? "page" : undefined}
            >
              <Icon size={20} />
              {name}
              {id === "quests" && questCount !== undefined && (
                <span className="nav-count">{questCount}</span>
              )}
            </button>
          ))}
        </nav>
        <div className="nav-sidebar-bottom">
          {sidebarExtra}
          <div className="nav-demo-note">
            <ShieldCheck size={17} />
            <span>{mode === "demo" ? ru.mode.demoNote : ru.mode.liveNote}</span>
          </div>
          <a className="nav-legacy" href="/dashboard">
            {ru.brand.legacy}
          </a>
        </div>
      </aside>
      <div className="nav-workspace">
        <header className="nav-topbar">
          <span className="nav-breadcrumb">
            {ru.brand.breadcrumb} <span>/</span> <strong>{ru.tabs[tab]}</strong>
          </span>
          <div>
            <ModeSwitch mode={mode} onMode={onMode} />
            <span className={`nav-demo-label nav-mode-label-${mode}`} data-testid="nav-mode-label">
              {mode === "demo" ? ru.mode.demoBadge : ru.mode.liveBadge}
            </span>
            <button
              className="nav-avatar"
              onClick={() => go("profile")}
              aria-label="Открыть профиль"
            >
              {name.slice(0, 1) || "?"}
            </button>
          </div>
        </header>
        <main className="nav-main">
          <div className="nav-page-heading">
            <div>
              <p className="nav-eyebrow">
                {tab === "home" && name ? ru.greeting(name) : "FINANCIAL LIFE NAVIGATOR"}
              </p>
              <h1>{ru.heading[tab]}</h1>
              <p>{ru.subheading[tab]}</p>
            </div>
            {action}
          </div>
          {error}
          {children}
          <footer className="nav-footer">
            <span>
              <Compass size={15} /> {ru.brand.app}
            </span>
            <span>{footer}</span>
            <span>{ru.footer.motto}</span>
          </footer>
        </main>
      </div>
      <nav className="nav-mobile" aria-label="Мобильная навигация">
        {tabs.map(({ id, name, icon: Icon }) => (
          <button
            key={id}
            className={tab === id ? "active" : ""}
            onClick={() => go(id)}
            aria-current={tab === id ? "page" : undefined}
          >
            <Icon size={20} />
            <span>{name}</span>
          </button>
        ))}
      </nav>
      {overlay}
    </div>
  );
}
