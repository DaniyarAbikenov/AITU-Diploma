import {
  CalendarDays,
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

export const money = (n: number) =>
  new Intl.NumberFormat("ru-RU", { maximumFractionDigits: 0 }).format(n) + " ₸";
export const compact = (n: number) =>
  new Intl.NumberFormat("ru-RU", { notation: "compact", maximumFractionDigits: 1 }).format(n) +
  " ₸";
export const tabs = [
  { id: "home", name: "Обзор", icon: LayoutDashboard },
  { id: "goals", name: "Мои цели", icon: Target },
  { id: "transactions", name: "Операции", icon: Wallet },
  { id: "calendar", name: "Календарь", icon: CalendarDays },
  { id: "forecast", name: "Прогноз", icon: TrendingUp },
  { id: "quests", name: "Мой прогресс", icon: Leaf },
  { id: "profile", name: "Профиль", icon: Settings2 },
] as const;
export type Tab = (typeof tabs)[number]["id"];
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
