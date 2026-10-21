import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { register as registerUser } from "@/lib/auth";
import { AuthFrame } from "@/components/AuthFrame";

export const Route = createFileRoute("/register")({
  head: () => ({ meta: [
    { title: "Регистрация — Запас" }, { name: "description", content: "Создайте аккаунт и загрузите первую выписку банка." },
    { property: "og:title", content: "Регистрация — Запас" }, { property: "og:description", content: "Начните с PDF-выписки — остальное приложение сделает само." },
  ] }),
  component: Register,
});

const schema = z.object({ name: z.string().min(2, "Как к вам обращаться?"), email: z.string().email("Введите корректный email"), password: z.string().min(8, "Минимум 8 символов") });

function Register() {
  const navigate = useNavigate();
  const { register, handleSubmit, setError, formState: { errors } } = useForm({ resolver: zodResolver(schema) });
  return (
    <AuthFrame title="Создать аккаунт">
      <form className="space-y-4" onSubmit={handleSubmit(async (v) => { try { await registerUser(v.email, v.name, v.password); navigate({ to: "/onboarding" }); } catch (e) { setError("email", { message: (e as Error).message }); } })}>
        {(["name", "email", "password"] as const).map((f) => (
          <div key={f} className="space-y-1.5">
            <Label htmlFor={f}>{{ name: "Имя", email: "Email", password: "Пароль" }[f]}</Label>
            <Input id={f} type={f === "password" ? "password" : f === "email" ? "email" : "text"} {...register(f)} aria-invalid={!!errors[f]} />
            {errors[f] && <p className="text-xs text-risk">{errors[f]?.message}</p>}
          </div>
        ))}
        <Button type="submit" className="w-full">Продолжить</Button>
        <p className="text-center text-sm text-muted-foreground">Уже есть аккаунт? <Link to="/login" className="text-primary hover:underline">Войти</Link></p>
      </form>
    </AuthFrame>
  );
}
