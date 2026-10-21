import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signIn } from "@/lib/auth";
import { AuthFrame } from "@/components/AuthFrame";

export const Route = createFileRoute("/login")({
  head: () => ({ meta: [
    { title: "Вход — Запас" }, { name: "description", content: "Войдите, чтобы увидеть прогноз и индекс финансовой устойчивости." },
    { property: "og:title", content: "Вход — Запас" }, { property: "og:description", content: "Вход в сервис прогноза финансовой устойчивости." },
  ] }),
  component: Login,
});

const loginSchema = z.object({ email: z.string().email("Введите корректный email"), password: z.string().min(6, "Минимум 6 символов") });

function Login() {
  const navigate = useNavigate();
  const { register, handleSubmit, formState: { errors } } = useForm({ resolver: zodResolver(loginSchema), defaultValues: { email: "demo@zapas.kz", password: "demo1234" } });
  return (
    <AuthFrame title="С возвращением">
      <form className="space-y-4" onSubmit={handleSubmit((v) => { signIn(v.email); navigate({ to: "/dashboard" }); })}>
        <div className="space-y-1.5"><Label htmlFor="email">Email</Label><Input id="email" type="email" autoComplete="email" {...register("email")} aria-invalid={!!errors.email} />{errors.email && <p className="text-xs text-risk">{errors.email.message}</p>}</div>
        <div className="space-y-1.5"><Label htmlFor="password">Пароль</Label><Input id="password" type="password" autoComplete="current-password" {...register("password")} aria-invalid={!!errors.password} />{errors.password && <p className="text-xs text-risk">{errors.password.message}</p>}</div>
        <Button type="submit" className="w-full">Войти</Button>
        <p className="text-center text-sm text-muted-foreground">Нет аккаунта? <Link to="/register" className="text-primary underline-offset-4 hover:underline">Зарегистрироваться</Link></p>
      </form>
    </AuthFrame>
  );
}
