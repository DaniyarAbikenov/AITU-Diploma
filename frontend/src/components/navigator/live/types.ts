import type {
  Account,
  Goal,
  GoalProjection,
  IncomeSource,
  Obligation,
  PlannedPayment,
  User,
} from "@/api/types";
import type { LiveSnapshot } from "@/lib/navigator-live";
import type { Tab } from "../model";

export type LiveGoal = Goal & { projection: GoalProjection };

/** What every working-mode tab receives from LiveNavigator. */
export type LiveProps = {
  me: User;
  accounts: Account[];
  obligations: Obligation[];
  incomes: IncomeSource[];
  goals: LiveGoal[];
  planned: PlannedPayment[];
  today: string;
  snap: LiveSnapshot;
  go: (t: Tab) => void;
  notify: (message: string) => void;
};
