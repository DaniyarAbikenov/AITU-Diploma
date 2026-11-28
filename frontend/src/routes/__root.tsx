import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
  type ErrorComponentProps,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { PublicFrame } from "@/components/navigator/PublicFrame";
import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";

function NotFoundComponent() {
  return (
    <PublicFrame>
      <div className="nav-panel nav-public-card">
        <h1>404</h1>
        <p>Такой страницы нет. Возможно, она переехала в Navigator.</p>
        <div className="nav-actions" style={{ marginTop: 16 }}>
          <Link to="/navigator" className="nav-primary">
            Открыть Navigator
          </Link>
          <Link to="/" className="nav-secondary">
            На главную
          </Link>
        </div>
      </div>
    </PublicFrame>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);
  return (
    <PublicFrame>
      <div className="nav-panel nav-public-card">
        <h1>Страница не загрузилась</h1>
        <p>Что-то пошло не так. Попробуйте ещё раз или вернитесь на главную.</p>
        <div className="nav-actions" style={{ marginTop: 16 }}>
          <button
            className="nav-primary"
            onClick={() => {
              router.invalidate();
              reset();
            }}
          >
            Повторить
          </button>
          <a href="/" className="nav-secondary">
            На главную
          </a>
        </div>
      </div>
    </PublicFrame>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Financial Life Navigator — прогноз финансовой устойчивости" },
      {
        name: "description",
        content:
          "Загрузите выписку банка и узнайте, какие финансовые проблемы могут возникнуть и как ваши решения влияют на устойчивость.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.ico", type: "image/x-icon" },
      { rel: "preconnect", href: "https://fonts.googleapis.com" },
      { rel: "preconnect", href: "https://fonts.gstatic.com", crossOrigin: "anonymous" },
      {
        rel: "stylesheet",
        href: "https://fonts.googleapis.com/css2?family=Unbounded:wght@400;500;600&family=Manrope:wght@400;500;600;700&family=JetBrains+Mono:wght@500;600&display=swap&subset=cyrillic",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
      <Outlet />
    </QueryClientProvider>
  );
}
