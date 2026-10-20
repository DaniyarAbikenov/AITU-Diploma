import { useSyncExternalStore } from "react";
import type { User } from "@/api/types";

// Mock auth: token + profile in sessionStorage (cleared with the tab).
// Real backend should set an httpOnly cookie instead — see docs/decisions.md.
const KEY = "fs_session";
type Session = { token: string; user: User; onboarded: boolean };
const listeners = new Set<() => void>();
let cache: Session | null | undefined;

function read(): Session | null {
  if (cache !== undefined) return cache;
  try { cache = JSON.parse(sessionStorage.getItem(KEY) ?? "null"); } catch { cache = null; }
  return cache ?? null;
}
function write(s: Session | null) {
  cache = s;
  if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY);
  listeners.forEach((l) => l());
}

export const getToken = () => (typeof window === "undefined" ? null : read()?.token ?? null);

const REAL = (import.meta.env.VITE_API_MODE as string | undefined) === "real";
const BASE = (import.meta.env.VITE_API_URL as string | undefined) ?? "/api/v1";

async function authCall(path: string, payload: unknown): Promise<Session> {
  const res = await fetch(BASE + path, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
  const p = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(p.detail ?? p.title ?? res.statusText);
  return { token: p.token, user: p.user, onboarded: p.onboarded };
}

export async function signIn(email: string, password = "", name = "Айгерим") {
  if (REAL) { write(await authCall("/auth/login", { email, password })); return; }
  write({ token: "mock-" + Math.random().toString(36).slice(2), user: { id: "u1", email, name, city: "Алматы", currency: "KZT" }, onboarded: true });
}
export async function register(email: string, name: string, password = "") {
  if (REAL) { write(await authCall("/auth/register", { email, name, password })); return; }
  write({ token: "mock-" + Math.random().toString(36).slice(2), user: { id: "u1", email, name, city: "Алматы", currency: "KZT" }, onboarded: false });
}
export function updateSession(patch: Omit<Partial<Session>, "user"> & { user?: Partial<User> }) {
  const s = read(); if (!s) return;
  write({ ...s, ...patch, user: { ...s.user, ...patch.user } });
}
export const signOut = () => write(null);

/** undefined = not hydrated yet (SSR), null = signed out. */
export function useSession(): Session | null | undefined {
  return useSyncExternalStore(
    (l) => { listeners.add(l); return () => listeners.delete(l); },
    () => read(),
    () => undefined,
  );
}
