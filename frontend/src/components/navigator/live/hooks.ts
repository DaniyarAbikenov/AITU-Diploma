import { useMutation, useQueryClient } from "@tanstack/react-query";

/** Everything the money numbers depend on: refreshed after every successful write. */
const MONEY_KEYS = [
  "transactions",
  "accounts",
  "obligations",
  "planned",
  "income",
  "resilience",
  "balance",
  "txHistory",
];

export function useWrite<A, R>(fn: (a: A) => Promise<R>, onDone: (r: R) => void) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: (r) => {
      MONEY_KEYS.forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      onDone(r);
    },
  });
}

export const confirmed = (text: string) => typeof window === "undefined" || window.confirm(text);
