import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { PublicFrame } from "@/components/navigator/PublicFrame";
import { ru } from "@/i18n/ru";
import { register as registerUser } from "@/lib/auth";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Регистрация — Financial Life Navigator" },
      { name: "description", content: "Создайте аккаунт и загрузите первую выписку банка." },
    ],
  }),
  component: Register,
});

const t = ru.pub;
const schema = z.object({
  name: z.string().min(2, t.nameShort),
  email: z.string().email(t.emailInvalid),
  password: z.string().min(8, t.passwordShort(8)),
});
const FIELDS = [
  ["name", t.name, "text", "name"],
  ["email", t.email, "email", "email"],
  ["password", t.password, "password", "new-password"],
] as const;

function Register() {
  const navigate = useNavigate();
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting },
  } = useForm({ resolver: zodResolver(schema) });
  return (
    <PublicFrame>
      <div className="nav-panel nav-public-card">
        <h1>{t.registerTitle}</h1>
        <form
          className="nav-form"
          onSubmit={handleSubmit(async (v) => {
            try {
              await registerUser(v.email, v.name, v.password);
              navigate({ to: "/onboarding" });
            } catch (e) {
              setError("email", { message: (e as Error).message });
            }
          })}
        >
          {FIELDS.map(([f, label, type, auto]) => (
            <label key={f} className="nav-field">
              {label}
              <input type={type} autoComplete={auto} aria-invalid={!!errors[f]} {...register(f)} />
              {errors[f] && (
                <span className="nav-field-error" role="alert">
                  {errors[f]?.message as string}
                </span>
              )}
            </label>
          ))}
          <button type="submit" className="nav-primary" disabled={isSubmitting}>
            {t.continue}
          </button>
          <p className="nav-small">
            {t.haveAccount} <Link to="/login">{t.login}</Link>
          </p>
        </form>
      </div>
    </PublicFrame>
  );
}
