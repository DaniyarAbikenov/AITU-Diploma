import { z } from "zod";
import {
  initialNavigator,
  updateNavigator,
  type NavigatorAction,
  type NavigatorState,
} from "@/lib/navigator";
const KEY = "financial-life-navigator-v1";
const money = z.number().int().min(0).max(1e12);
const schema = z.object({
  version: z.literal(1),
  name: z.string().min(1).max(80),
  income: money.positive(),
  essential: money.positive(),
  hours: money.positive().max(744),
  committed: money,
  daysToSalary: z.number().int().min(1).max(31),
  openingChecking: money,
  openingSavings: money,
  goals: z.array(
    z.object({
      id: z.string(),
      name: z.string(),
      target: money.positive(),
      saved: money,
      monthly: money.positive(),
      kind: z.enum(["home", "car", "reserve", "other"]),
    }),
  ),
  transactions: z.array(
    z.object({
      id: z.string(),
      date: z.string(),
      name: z.string(),
      amount: money.positive(),
      category: z.string(),
      kind: z.enum(["income", "expense", "transfer"]),
      goalId: z.string().optional(),
    }),
  ),
  completed: z.array(z.string()),
  strategy: z.enum(["parallel", "reserve"]),
  dismissed: z.boolean(),
});
// Browser-only storage is deliberately separate from connected bank accounts.
export function readNavigator(): NavigatorState {
  if (typeof window === "undefined") return initialNavigator();
  const raw = window.localStorage.getItem(KEY);
  if (!raw) return initialNavigator();
  const parsed = schema.safeParse(JSON.parse(raw));
  if (!parsed.success)
    throw new Error("Сохранённое демо повреждено. Можно сбросить только данные навигатора.");
  return parsed.data;
}
export function mutateNavigator(a: NavigatorAction) {
  const s = updateNavigator(readNavigator(), a);
  window.localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
export function resetNavigator() {
  const s = initialNavigator();
  window.localStorage.setItem(KEY, JSON.stringify(s));
  return s;
}
