import { beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Navigator } from "./Navigator";
import { api } from "@/api/client";
import { accounts, db } from "@/api/mock";
import { signIn, signOut } from "@/lib/auth";
vi.mock("@/components/charts", () => ({ Chart: () => <div>График</div>, baseAxis: () => ({}) }));

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
const dialog = () => screen.getByRole("dialog");

beforeEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.stubGlobal("localStorage", storage());
  vi.stubGlobal("sessionStorage", storage());
  vi.stubGlobal("confirm", () => true);
  signOut();
  accounts.forEach((a) =>
    Object.assign(a, { kind: "current", confirmed: true, balanceKnown: true }),
  );
});

describe("manual operations", () => {
  it("validates the amount and saves only after the server answers", async () => {
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Добавить операцию" }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText("Описание"), { target: { value: "Рынок" } });
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "0" } });
    fireEvent.submit(d.getByLabelText("Сумма, ₸").closest("form")!);
    expect(await d.findByRole("alert")).toHaveTextContent("больше нуля");
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "4500" } });
    fireEvent.click(d.getByRole("button", { name: "Сохранить" }));
    expect(await screen.findByText("Успешно сохранено")).toBeInTheDocument();
    expect(db.transactions[0]).toMatchObject({
      merchant: "Рынок",
      amount: -4500,
      source: "manual",
    });
  });
  it("keeps the input and shows no success when the network fails", async () => {
    vi.spyOn(api, "createTx").mockRejectedValue(new Error("Сеть недоступна"));
    await open();
    fireEvent.click(screen.getByRole("button", { name: "Добавить операцию" }));
    const d = within(dialog());
    fireEvent.change(d.getByLabelText("Описание"), { target: { value: "Такси" } });
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "1200" } });
    fireEvent.click(d.getByRole("button", { name: "Сохранить" }));
    expect(await d.findByRole("alert")).toHaveTextContent("Сеть недоступна");
    expect(d.getByLabelText("Описание")).toHaveValue("Такси");
    expect(screen.queryByText("Успешно сохранено")).toBeNull();
  });
});

describe("obligations and planned items", () => {
  it("adds, edits and deletes a monthly obligation", async () => {
    await open("Календарь");
    fireEvent.click((await screen.findAllByRole("button", { name: "Добавить платёж" }))[0]);
    let d = within(dialog());
    fireEvent.change(d.getByLabelText("Название"), { target: { value: "Интернет" } });
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "9000" } });
    fireEvent.change(d.getByLabelText("День месяца"), { target: { value: "31" } });
    fireEvent.click(d.getByRole("button", { name: "Сохранить" }));
    const rowOf = async (text: string) =>
      (await screen.findAllByText(text))
        .map((e) => e.closest(".nav-live-row"))
        .find(Boolean) as HTMLElement;
    const row = await rowOf("Интернет");
    expect(db.obligations.find((o) => o.name === "Интернет")).toMatchObject({
      amount: 9000,
      dayOfMonth: 31,
    });
    fireEvent.click(within(row).getByRole("button", { name: "Изменить" }));
    d = within(dialog());
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "9900" } });
    fireEvent.click(d.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(db.obligations.find((o) => o.name === "Интернет")?.amount).toBe(9900),
    );
    fireEvent.click(within(await rowOf("Интернет")).getByRole("button", { name: "Удалить" }));
    await waitFor(() => expect(db.obligations.some((o) => o.name === "Интернет")).toBe(false));
  });
  it("plans a one-off expense and pays it partly", async () => {
    await open("Календарь");
    fireEvent.click(
      (await screen.findAllByRole("button", { name: "Добавить плановую статью" }))[0],
    );
    const d = within(dialog());
    fireEvent.change(d.getByLabelText("Название"), { target: { value: "Взнос за магистратуру" } });
    fireEvent.change(d.getByLabelText("Сумма, ₸"), { target: { value: "300000" } });
    fireEvent.change(d.getByLabelText("Дата"), { target: { value: "2026-12-10" } });
    fireEvent.click(d.getByRole("button", { name: "Сохранить" }));
    const row = (await screen.findByText("Взнос за магистратуру")).closest(
      ".nav-live-row",
    ) as HTMLElement;
    fireEvent.click(within(row).getByRole("button", { name: "Отметить оплату" }));
    const pay = within(dialog());
    fireEvent.change(pay.getByLabelText("Сумма оплаты, ₸"), { target: { value: "100000" } });
    fireEvent.click(pay.getByRole("button", { name: "Сохранить" }));
    await waitFor(() =>
      expect(db.planned.find((p) => p.name === "Взнос за магистратуру")).toMatchObject({
        status: "partial",
        left: 200000,
      }),
    );
    expect(await screen.findByText("Оплачено частично")).toBeInTheDocument();
  });
});
