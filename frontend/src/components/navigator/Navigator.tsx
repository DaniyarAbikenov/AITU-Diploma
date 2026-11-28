import { useState } from "react";
import { useSession } from "@/lib/auth";
import { DemoNavigator } from "./DemoNavigator";
import { LiveNavigator } from "./live/LiveNavigator";
import type { NavMode } from "./NavigatorFrame";
import "./navigator.css";

const MODE_KEY = "financial-life-navigator-mode";

function storedMode(): NavMode | null {
  const fromUrl = new URLSearchParams(window.location.search).get("mode");
  if (fromUrl === "demo" || fromUrl === "live") return fromUrl;
  try {
    const v = window.localStorage.getItem(MODE_KEY);
    return v === "demo" || v === "live" ? v : null;
  } catch {
    return null;
  }
}

/**
 * FR-01: two separate modes. "Демо" is the fictional user in localStorage on a fixed date; "Мои данные" reads the
 * signed-in user's data from /api/v1 with today's date in their time zone. Nothing is copied between them.
 */
export function Navigator() {
  const session = useSession();
  const [chosen, setChosen] = useState<NavMode | null>(() =>
    typeof window === "undefined" ? null : storedMode(),
  );
  const mode: NavMode = chosen ?? (session ? "live" : "demo");
  const onMode = (m: NavMode) => {
    setChosen(m);
    try {
      window.localStorage.setItem(MODE_KEY, m);
    } catch {
      /* the choice then lasts for this visit only */
    }
  };
  return mode === "demo" ? (
    <DemoNavigator onMode={onMode} />
  ) : (
    <LiveNavigator onMode={onMode} signedIn={!!session} />
  );
}
