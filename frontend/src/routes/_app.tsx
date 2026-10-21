import { createFileRoute, Link, Outlet, useNavigate } from "@tanstack/react-router";
import { useEffect } from "react";
import { BarChart3, Globe2, Home, Landmark, LineChart, LogOut, Moon, Settings, ShieldCheck, Sparkles, Sun, Target } from "lucide-react";
import { signOut, useSession } from "@/lib/auth";
import { API_MODE } from "@/api/client";
import { Skeleton } from "@/components/ui/skeleton";

export const Route = createFileRoute("/_app")({ component: AppLayout });

const GROUPS = [
  { title: "Данные", hint: "что есть в выписках", items: [
    { to: "/dashboard", label: "Главная", icon: Home, mobile: true },
    { to: "/expenses", label: "Расходы", icon: BarChart3, mobile: true },
    { to: "/debts", label: "Обязательства", icon: Landmark },
  ] },
  { title: "Анализ", hint: "что мы посчитали", items: [
    { to: "/resilience", label: "Устойчивость", icon: ShieldCheck, mobile: true },
    { to: "/forecast", label: "Прогноз", icon: LineChart, mobile: true },
  ] },
  { title: "Планирование", hint: "что если", items: [
    { to: "/scenarios", label: "Сценарии", icon: Sparkles, mobile: true },
    { to: "/goals", label: "Цели", icon: Target },
  ] },
  { title: "Контекст", hint: "внешние данные", items: [
    { to: "/macro", label: "Мир и цены", icon: Globe2 },
  ] },
] as const;
type NavItem = (typeof GROUPS)[number]["items"][number];
const NAV: NavItem[] = GROUPS.flatMap((g) => [...g.items] as NavItem[]);

function toggleTheme() {
  const dark = document.documentElement.classList.toggle("dark");
  localStorage.setItem("theme", dark ? "dark" : "light");
}

function AppLayout() {
  const session = useSession();
  const navigate = useNavigate();
  useEffect(() => { if (session === null) navigate({ to: "/login" }); }, [session, navigate]);

  return (
    <div className="min-h-screen bg-background md:grid md:grid-cols-[248px_1fr]">
      <aside className="sticky top-0 hidden h-screen flex-col bg-sidebar p-4 text-sidebar-foreground md:flex">
        <Link to="/dashboard" className="mb-8 flex items-center gap-2 px-2 pt-2">
          <span className="grid size-8 place-items-center rounded-lg bg-sidebar-primary font-display text-sm font-semibold text-sidebar-primary-foreground">З</span>
          <span className="font-display text-lg">Запас</span>
        </Link>
        <nav className="flex flex-1 flex-col gap-4 overflow-y-auto" aria-label="Основная навигация">
          {GROUPS.map((g) => (
            <div key={g.title} className="flex flex-col gap-0.5">
              <p className="px-3 pb-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-sidebar-foreground/50">{g.title} <span className="font-normal normal-case tracking-normal">· {g.hint}</span></p>
              {g.items.map(({ to, label, icon: Icon }) => (
                <Link key={to} to={to} className="flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
                  activeProps={{ className: "!bg-sidebar-accent !text-sidebar-accent-foreground font-semibold" }}>
                  <Icon className="size-4" aria-hidden /> {label}
                </Link>
              ))}
            </div>
          ))}
          <Link to="/settings" className="mt-auto flex items-center gap-3 rounded-lg px-3 py-2 text-sm text-sidebar-foreground/80 hover:bg-sidebar-accent"
            activeProps={{ className: "!bg-sidebar-accent !text-sidebar-accent-foreground font-semibold" }}><Settings className="size-4" aria-hidden /> Настройки</Link>
        </nav>
        <div className="space-y-1 border-t border-sidebar-border pt-3 text-sm">
          {API_MODE === "mock" && <p className="px-3 pb-1 text-xs text-sidebar-foreground/60">Демо-данные</p>}
          <button onClick={toggleTheme} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground/80 hover:bg-sidebar-accent">
            <Moon className="size-4 dark:hidden" aria-hidden /><Sun className="hidden size-4 dark:block" aria-hidden /> Тема
          </button>
          <button onClick={() => { signOut(); navigate({ to: "/" }); }} className="flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sidebar-foreground/80 hover:bg-sidebar-accent">
            <LogOut className="size-4" aria-hidden /> Выйти
          </button>
        </div>
      </aside>

      <header className="flex items-center justify-between border-b bg-card px-4 py-3 md:hidden">
        <Link to="/dashboard" className="font-display text-lg text-foreground">Запас</Link>
        <div className="flex gap-3 text-sm text-muted-foreground">
          <Link to="/debts">Долги</Link><Link to="/macro">Цены</Link><Link to="/goals">Цели</Link><Link to="/settings" aria-label="Настройки"><Settings className="size-5" /></Link>
        </div>
      </header>

      <main className="mx-auto w-full max-w-6xl px-4 pb-28 pt-6 md:px-10 md:pb-12 md:pt-10">
        {session ? <Outlet /> : <div className="space-y-4"><Skeleton className="h-10 w-2/3" /><Skeleton className="h-64 w-full" /></div>}
      </main>

      <nav aria-label="Навигация" className="fixed inset-x-0 bottom-0 z-40 grid grid-cols-5 border-t bg-card md:hidden">
        {NAV.filter((n) => "mobile" in n && n.mobile).map(({ to, label, icon: Icon }) => (
          <Link key={to} to={to} className="flex flex-col items-center gap-1 py-2.5 text-[11px] text-muted-foreground" activeProps={{ className: "!text-primary font-semibold" }}>
            <Icon className="size-5" aria-hidden />{label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
