import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PublicFrame } from "@/components/navigator/PublicFrame";
import { ru } from "@/i18n/ru";
import { signIn } from "@/lib/auth";

export const Route = createFileRoute("/login")({
  head: () => ({
    meta: [
      { title: "Вход — Financial Life Navigator" },
      { name: "description", content: "Войдите, чтобы увидеть свои деньги, план и прогноз." },
    ],
  }),
  component: Login,
});

const t = ru.pub;
const loginSchema = z.object({
  email: z.string().email(t.emailInvalid),
  password: z.string().min(6, t.passwordShort(6)),
});

/** ?next=/... returns the user to the page that asked for sign-in (local paths only); default is Navigator. */
function safeNext(): "/navigator" | "/onboarding" {
  const next =
    typeof window === "undefined" ? null : new URLSearchParams(window.location.search).get("next");
  return next === "/onboarding" ? "/onboarding" : "/navigator";
}

function Login() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "", password: "" } });
  return (
    <PublicFrame>
      <div className="nav-panel nav-public-card">
        <h1>{t.loginTitle}</h1>
        <form
          className="nav-form"
          onSubmit={handleSubmit(async (v) => {
            try {
              await signIn(v.email, v.password);
              navigate({ to: safeNext() });
            } catch (e) {
              setError("password", { message: (e as Error).message });
            }
          })}
        >
          <label className="nav-field">
            {t.email}
            <input
              type="email"
              autoComplete="email"
              aria-invalid={!!errors.email}
              {...register("email")}
            />
            {errors.email && <span className="nav-field-error">{errors.email.message}</span>}
          </label>
          <label className="nav-field">
            {t.password}
            <input
              type="password"
              autoComplete="current-password"
              aria-invalid={!!errors.password}
              {...register("password")}
            />
            {errors.password && (
              <span className="nav-field-error" role="alert">
                {errors.password.message}
              </span>
            )}
          </label>
          <button type="submit" className="nav-primary" disabled={isSubmitting}>
            {t.login}
          </button>
          <p className="nav-small">
            {t.noAccount} <Link to="/register">{t.register}</Link> ·{" "}
            <a href="/navigator?mode=demo">{t.demo}</a>
          </p>
        </form>
      </div>
    </PublicFrame>
  );
}
