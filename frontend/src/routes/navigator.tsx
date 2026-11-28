import { createFileRoute } from "@tanstack/react-router";
import { Navigator } from "@/components/navigator/Navigator";
export const Route = createFileRoute("/navigator")({
  head: () => ({
    meta: [
      { title: "Financial Life Navigator — ваше финансовое будущее" },
      {
        name: "description",
        content:
          "Интерактивный демопрототип: цели, бюджет, прогноз, финансовая устойчивость и полезные привычки.",
      },
    ],
  }),
  component: Navigator,
});
