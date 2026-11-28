import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigator } from "./Navigator";
import { readNavigator } from "@/api/navigator-store";
import { navMetrics } from "@/lib/navigator";
vi.mock("@/components/charts", () => ({
  Chart: () => <div>График прогноза</div>,
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
beforeEach(() => {
  cleanup();
  const values = new Map<string, string>();
  vi.stubGlobal("localStorage", {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {
      values.set(key, value);
    },
    removeItem: (key: string) => {
      values.delete(key);
    },
    clear: () => values.clear(),
  });
});
describe("Navigator interactions", () => {
  it("adds an expense, updates the ledger, and survives remount", async () => {
    const view = show();
    await screen.findByText("Ваше будущее начинается сегодня");
    fireEvent.click(screen.getByRole("button", { name: "Добавить операцию" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Тестовый расход" } });
    fireEvent.change(screen.getByLabelText("Сумма, ₸"), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    await waitFor(() => expect(navMetrics(readNavigator()).checking).toBe(484000));
    expect(await screen.findByText("Тестовый расход")).toBeInTheDocument();
    view.unmount();
    show();
    expect(await screen.findByText("Тестовый расход")).toBeInTheDocument();
  });
  it("reports a failed storage write instead of presenting false success", async () => {
    show();
    await screen.findByText("Ваше будущее начинается сегодня");
    fireEvent.click(screen.getByRole("button", { name: "Добавить операцию" }));
    fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Кофе" } });
    fireEvent.change(screen.getByLabelText("Сумма, ₸"), { target: { value: "1000" } });
    const spy = vi.spyOn(window.localStorage, "setItem").mockImplementation(() => {
      throw new Error("Хранилище недоступно");
    });
    fireEvent.click(screen.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByRole("alert")).toHaveTextContent("Хранилище недоступно");
    expect(navMetrics(readNavigator()).checking).toBe(485000);
    spy.mockRestore();
  });
  it("requires a correct lesson answer and persists the reward", async () => {
    show();
    await screen.findByText("Ваше будущее начинается сегодня");
    fireEvent.click(screen.getAllByRole("button", { name: /Мой прогресс/ })[0]);
    fireEvent.click(screen.getByRole("button", { name: "Пройти урок" }));
    const finish = screen.getByRole("button", { name: "Завершить урок · +15 XP" });
    expect(finish).toBeDisabled();
    fireEvent.click(
      screen.getByRole("button", { name: "Деньги на доступном накопительном счёте" }),
    );
    fireEvent.click(finish);
    await waitFor(() => expect(navMetrics(readNavigator()).xp).toBe(255));
  });
});
