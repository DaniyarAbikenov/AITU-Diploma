import { createFileRoute, redirect } from "@tanstack/react-router";

/** Old page of the previous interface: everything now lives in Navigator. */
export const Route = createFileRoute("/forecast")({
  beforeLoad: () => {
    throw redirect({ href: "/navigator?tab=forecast" });
  },
});
