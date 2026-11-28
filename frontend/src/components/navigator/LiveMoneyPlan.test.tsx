import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigator } from "./Navigator";
import { accounts, db } from "@/api/mock";
import { signIn, signOut } from "@/lib/auth";
vi.mock("@/components/charts", () => ({
  Chart: () => <div>График</div>,
  FanChart: () => <div>График</div>,
  Sparkline: () => <div>Спарклайн</div>,
  baseAxis: () => ({}),
}));

function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
    clear: () => values.clear(),
  };
}
async function open(tab?: string) {
  await signIn("mock@example.com");
  render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Navigator />
    </QueryClientProvider>,
  );
  await screen.findByText("ДОБРЫЙ ДЕНЬ, АЙГЕРИМ");
  if (tab) fireEvent.click(screen.getAllByRole("button", { name: new RegExp(tab) })[0]);
}
const panel = (el: HTMLElement) => el.closest("section") as HTMLElement;

beforeEach(() => {
  cleanup();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("confirm", () => true);
  signOut();
  db.needs = [];
  db.setAside = null;
  db.allocationRules = [];
  db.incomeAllocations = { proposals: [], confirmed: [] };
  accounts.forEach((a) =>
    Object.assign(a, {
      kind: "current",
      confirmed: true,
      balanceKnown: true,
    }),
  );
});

describe("money plan on the overview", () => {
  it("says the limit is too high while everyday needs are unknown, and takes them off once entered", async () => {
    await open();
    expect(await screen.findByText(/предел завышен/)).toBeInTheDocument();
    expect(screen.queryByText(/^Нужды до/)).toBeNull();
    cleanup();
    db.needs = [
      {
        id: "n1",
        name: "Еда",
        amount: 5_000,
        period: "day",
        coveredBy: null,
        skipped: false,
        perDay: 5_000,
        perMonth: 155_000,
      },
    ];
    await open();
    expect(await screen.findByText(/^Нужды до/)).toBeInTheDocument();
    expect(screen.getByText(/Сверх нужд можно тратить не больше/)).toBeInTheDocument();
    expect(screen.queryByText(/предел завышен/)).toBeNull();
    expect(screen.queryByText(/^−0/)).toBeNull();
  });
  it("shows what to set aside only as a proposal", async () => {
    db.setAside = {
      amount: 50_000,
      free: 50_000,
      missing: [],
      items: [{ type: "reserve", id: null, name: "Резерв", amount: 50_000 }],
      days: 35,
      hasTargets: true,
    };
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Посмотреть распределение" }));
    expect(screen.getByText("Резерв")).toBeInTheDocument();
    expect(screen.getByText(/Ничего не переводится автоматически/)).toBeInTheDocument();
  });
  it("names the missing inputs instead of proposing a number", async () => {
    await open();
    expect(await screen.findByText(/не хватает: ежедневных потребностей/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Посмотреть распределение" })).toBeNull();
  });
  it("asks before splitting a payout", async () => {
    db.incomeAllocations.proposals = [
      {
        transactionId: "t1",
        date: "2026-10-20",
        name: "Зарплата",
        amount: 400_000,
        items: [{ type: "tax", id: null, name: "Налог", amount: 12_000 }],
        left: 388_000,
      },
    ];
    await open();
    fireEvent.click(await screen.findByRole("button", { name: "Подтвердить распределение" }));
    await waitFor(() => expect(db.incomeAllocations.proposals).toHaveLength(0));
  });
});

describe("needs and rules in the profile", () => {
  it("applies the suggested everyday need only by the button", async () => {
    await open("Профиль");
    const button = await screen.findByRole("button", { name: /Добавить как/ });
    expect(db.needs).toHaveLength(0);
    fireEvent.click(button);
    await waitFor(() => expect(db.needs).toMatchObject([{ amount: 8_000, period: "day" }]));
  });
  it("converts a need between a day and a month by the days of the month", async () => {
    await open("Профиль");
    fireEvent.click(await screen.findByRole("button", { name: /Добавить потребность/ }));
    const p = within(panel(screen.getByText("Ежедневные потребности")));
    fireEvent.change(p.getByLabelText("Сумма, ₸"), { target: { value: "5000" } });
    expect(p.getByText(/155\s000 ₸ в месяц/)).toBeInTheDocument(); // October: 31 days
    fireEvent.change(p.getByLabelText("Период"), { target: { value: "month" } });
    fireEvent.change(p.getByLabelText("Сумма, ₸"), { target: { value: "62000" } });
    expect(p.getByText(/2\s000 ₸ в день/)).toBeInTheDocument();
  });
  it("adds a payout rule", async () => {
    await open("Профиль");
    fireEvent.click(await screen.findByRole("button", { name: /Добавить правило/ }));
    const p = within(panel(screen.getByText("Что делать с каждой зарплатой")));
    fireEvent.change(p.getByLabelText("Значение"), { target: { value: "3" } });
    fireEvent.click(p.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(db.allocationRules).toMatchObject([{ kind: "tax", mode: "percent", value: 3 }]),
    );
  });
});
