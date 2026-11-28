import type { RuleIn, RuleInfo } from "@/api/types";

export type RuleState = { on: boolean; rule: RuleIn };

export const ruleStateFrom = (info?: RuleInfo | null): RuleState =>
  info
    ? {
        on: true,
        rule: {
          kind: info.kind,
          params: info.params,
          expression: info.kind === "formula" ? info.expression : null,
        },
      }
    : { on: false, rule: { kind: "per_day", params: { perDay: 5000, days: "month" } } };
