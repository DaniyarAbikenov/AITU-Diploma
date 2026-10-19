import type { ReactNode } from "react";
import { Link } from "@tanstack/react-router";

export function AuthFrame({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="grid min-h-screen place-items-center bg-hero px-4">
      <div className="surface w-full max-w-md p-8">
        <Link to="/" className="font-display text-sm text-muted-foreground">Запас</Link>
        <h1 className="mb-6 mt-3 text-2xl text-foreground">{title}</h1>
        {children}
      </div>
    </div>
  );
}

