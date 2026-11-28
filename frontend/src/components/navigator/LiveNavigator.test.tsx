import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigator } from "./Navigator";
import { accounts, db } from "@/api/mock";
import { signIn as authSignIn, signOut } from "@/lib/auth";
vi.mock("@/components/charts", () => ({
  Chart: () => <div>График</div>,
  FanChart: () => <div>График</div>,
  Sparkline: () => <div>Спарклайн</div>,
  baseAxis: () => ({}),
}));

function show() {
  return render(
    <QueryClientProvider
      client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
    >
      <Navigator />
    </QueryClientProvider>,
  );
}
function storage() {
  const values = new Map<string, string>();
  return {
    getItem: (k: string) => values.get(k) ?? null,
    setItem: (k: string, v: string) => void values.set(k, v),
    removeItem: (k: string) => void values.delete(k),
    clear: () => values.clear(),
  };
}
const signIn = () => authSignIn("mock@example.com");
const label = () => screen.getByTestId("nav-mode-label");

beforeEach(() => {
  cleanup();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  signOut();
});

describe("Navigator modes (FR-01)", () => {
  it("starts in demo without a session and shows the mode label", async () => {
    show();
    await screen.findByText("Ваше будущее начинается сегодня");
    expect(label()).toHaveTextContent("ДЕМО-РЕЖИМ");
  });
  it("working mode asks to sign in instead of showing demo data", async () => {
    show();
    await screen.findByText("Ваше будущее начинается сегодня");
    fireEvent.click(screen.getByRole("button", { name: "Мои данные" }));
    expect(await screen.findByText("Войдите, чтобы увидеть свои данные")).toBeInTheDocument();
    expect(label()).toHaveTextContent("МОИ ДАННЫЕ");
    expect(screen.queryByText(/Алия/i)).toBeNull();
  });
  it("signed-in user opens in working mode with no demo names, goals or fake numbers", async () => {
    await signIn();
    show();
    expect(await screen.findByText("ДОБРЫЙ ДЕНЬ, АЙГЕРИМ")).toBeInTheDocument();
    expect(label()).toHaveTextContent("МОИ ДАННЫЕ");
    // mock accounts are not confirmed yet: no Safe-to-Spend, a reason and a way to fix it instead
    expect(screen.getAllByText(/Нет подтверждённых текущих счетов/).length).toBeGreaterThan(0);
    expect(screen.getByText(/Индекс не показываем/)).toBeInTheDocument();
    expect(screen.queryByText(/Алия|в этом демо/i)).toBeNull();
    fireEvent.click(screen.getAllByRole("button", { name: /Мои цели/ })[0]);
    expect(await screen.findByText("Подушка безопасности")).toBeInTheDocument();
    expect(screen.queryByText("Своя квартира")).toBeNull();
    // each screen keeps the label
    for (const name of ["Операции", "Календарь", "Прогноз", "Мой прогресс", "Профиль"]) {
      fireEvent.click(screen.getAllByRole("button", { name: new RegExp(name) })[0]);
      expect(label()).toHaveTextContent("МОИ ДАННЫЕ");
    }
  });
  it("confirming an account with a known balance turns on Safe-to-Spend", async () => {
    await signIn();
    accounts.forEach((a) =>
      Object.assign(a, {
        kind: undefined,
        confirmed: false,
        balanceKnown: true,
        balanceAsOf: "2026-10-19",
        balanceSource: "statement",
      }),
    );
    show();
    await screen.findByText("ДОБРЫЙ ДЕНЬ, АЙГЕРИМ");
    fireEvent.click(screen.getAllByRole("button", { name: /Профиль/ })[0]);
    const kind = await screen.findByLabelText("Тип счёта: Kaspi Gold");
    fireEvent.change(kind, { target: { value: "current" } });
    await waitFor(() => expect(accounts[0].kind).toBe("current"));
    const row = kind.closest(".nav-live-row") as HTMLElement;
    await waitFor(() =>
      expect(within(row).getByRole("button", { name: "Подтвердить счёт" })).toBeEnabled(),
    );
    fireEvent.click(within(row).getByRole("button", { name: "Подтвердить счёт" }));
    await waitFor(() => expect(accounts[0].confirmed).toBe(true));
    fireEvent.click(screen.getAllByRole("button", { name: /Обзор/ })[0]);
    expect(await screen.findByText(/до .* включительно/)).toBeInTheDocument();
  });
  it("lets the user reject a detected regular payment", async () => {
    await signIn();
    show();
    await screen.findByText("ДОБРЫЙ ДЕНЬ, АЙГЕРИМ");
    fireEvent.click(screen.getAllByRole("button", { name: /Календарь/ })[0]);
    const name = await screen.findByText("Yandex Plus");
    const row = name.closest(".nav-live-row") as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Отклонить" }));
    await waitFor(() =>
      expect(db.obligations.find((o) => o.name === "Yandex Plus")?.rejected).toBe(true),
    );
  });
  it("opens the tab named in ?tab= and shows the moved sections", async () => {
    window.history.pushState({}, "", "/navigator?tab=debts");
    await signIn();
    show();
    expect(await screen.findByText("Долги без сюрпризов")).toBeInTheDocument();
    expect(await screen.findByText("А что если взять рассрочку?")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Макро/ })[0]);
    expect(await screen.findByText("Мир, цены и вы")).toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: /Операции/ })[0]);
    expect(await screen.findByText("Правила категорий")).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
  it("demo mode says the moved sections need the working mode", async () => {
    window.history.pushState({}, "", "/navigator?tab=macro&mode=demo");
    show();
    expect(
      await screen.findByText(/Этот раздел работает в режиме «Мои данные»/),
    ).toBeInTheDocument();
    window.history.pushState({}, "", "/");
  });
  it("shows no debt-to-income percentage for a month without usable income", async () => {
    db.dti = [
      { month: "2026-08", dti: 0.1, debt: 40_000, income: 400_000, status: "ok", payments: 1 },
      {
        month: "2026-09",
        dti: null,
        debt: 37_800,
        income: 3_000,
        expectedIncome: 400_000,
        status: "incomplete_income",
        payments: 1,
      },
    ];
    window.history.pushState({}, "", "/navigator?tab=debts");
    await signIn();
    show();
    expect(await screen.findByText(/доход в выписках .* намного меньше/)).toBeInTheDocument();
    expect(screen.queryByText(/1259/)).toBeNull();
    expect(screen.getByText(/платежи 37 800 ₸ ÷ доход 3 000 ₸/)).toBeInTheDocument();
    window.history.pushState({}, "", "/");
    db.dti = null;
  });
  it("shows a smart card with its fact, opens the right tab, explains why and hides it", async () => {
    db.smart = [
      {
        key: "K001:missing_inputs:profile:2026-10",
        entryId: "K001",
        title: "Полнота обязательных полей",
        text: "Для надёжного расчёта свободных денег пока не хватает исходных данных. Заполнено 2 из 4.",
        fact: "Заполнено 2 из 4.",
        module: "onboarding",
        tab: "profile",
        actionLabel: "Дополнить данные",
        actionIntent: "review_data",
        tier: 0,
        tierName: "Ошибки данных",
        rank: 0.3,
        critical: false,
        why: {
          signal: "R001",
          formula: "q = count(known requiredFields) / count(requiredFields)",
          inputs: { R001: { q: 0.5 } },
          evidence: [],
          asOf: "2026-10-19",
          kbVersion: "1.0.0",
          entryVersion: "1.0.0",
        },
      },
    ];
    await signIn();
    show();
    expect(await screen.findByText(/Заполнено 2 из 4/)).toBeInTheDocument();
    expect(screen.getByText(/q = count\(known requiredFields\)/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Скрыть" }));
    await waitFor(() => expect(screen.queryByText(/Заполнено 2 из 4/)).toBeNull());
    db.smart = [];
  });
});
