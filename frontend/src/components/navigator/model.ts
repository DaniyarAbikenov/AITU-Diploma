import {
  CalendarDays,
  CreditCard,
  Globe2,
  Car,
  Home,
  LayoutDashboard,
  Leaf,
  Settings2,
  ShieldCheck,
  Target,
  TrendingUp,
  Wallet,
} from "lucide-react";
import type {
  NavGoal,
  NavigatorAction,
  NavigatorState,
  NavTransaction,
  navMetrics,
} from "@/lib/navigator";
import { formatMoney, formatMoneyShort } from "@/lib/format";
import { ru } from "@/i18n/ru";

/** One tenge format for the whole app (src/lib/format.ts): "1 080 000 ₸" and "1,08 млн ₸". */
export const money = (n: number) => formatMoney(n);
export const compact = (n: number) => formatMoneyShort(n);
/** Money in a given currency (accounts and operations keep their own currency). */
export const moneyIn = (n: number, currency = "KZT") =>
  formatMoney(n, (["KZT", "USD", "EUR", "RUB"].includes(currency) ? currency : "KZT") as "KZT");
export const tabs = [
  { id: "home", name: ru.tabs.home, icon: LayoutDashboard },
  { id: "goals", name: ru.tabs.goals, icon: Target },
  { id: "transactions", name: ru.tabs.transactions, icon: Wallet },
  { id: "calendar", name: ru.tabs.calendar, icon: CalendarDays },
  { id: "forecast", name: ru.tabs.forecast, icon: TrendingUp },
  { id: "debts", name: ru.tabs.debts, icon: CreditCard },
  { id: "macro", name: ru.tabs.macro, icon: Globe2 },
  { id: "quests", name: ru.tabs.quests, icon: Leaf },
  { id: "profile", name: ru.tabs.profile, icon: Settings2 },
] as const;
export type Tab = (typeof tabs)[number]["id"];
/** The tab named in ?tab= (old page URLs redirect there), otherwise the overview. */
export const initialTab = (): Tab => {
  const v =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("tab");
  return tabs.some((t) => t.id === v) ? (v as Tab) : "home";
};
export type Modal =
  | { type: "transaction"; entry?: NavTransaction }
  | { type: "transfer"; goal: NavGoal }
  | { type: "goal" }
  | { type: "strategy" }
  | { type: "safe" }
  | { type: "score" }
  | { type: "lesson" }
  | { type: "delete"; entry: NavTransaction }
  | { type: "reset" }
  | null;
export const goalIcon = (kind: NavGoal["kind"]) =>
  kind === "home" ? Home : kind === "car" ? Car : kind === "reserve" ? ShieldCheck : Target;
/** Everything a demo tab needs from the Navigator shell. */
export type DemoTabProps = {
  s: NavigatorState;
  m: ReturnType<typeof navMetrics>;
  open: (m: Modal) => void;
  go: (t: Tab) => void;
  change: (a: NavigatorAction) => void;
  pending: boolean;
};
