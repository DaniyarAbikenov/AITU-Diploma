import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, LineChart, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Запас — финансовая устойчивость по выписке банка" },
      { name: "description", content: "Загрузите PDF-выписку Kaspi или Halyk и узнайте, какие проблемы с деньгами могут возникнуть и как ваши решения повлияют на устойчивость." },
      { property: "og:title", content: "Запас — финансовая устойчивость по выписке банка" },
      { property: "og:description", content: "Не «сколько я потратил», а «что может пойти не так и как это предотвратить»." },
    ],
  }),
  component: Landing,
});

function Landing() {
  return (
    <div className="min-h-screen bg-hero text-sidebar-foreground">
      <div className="mx-auto flex min-h-screen max-w-6xl flex-col px-6 py-8">
        <header className="flex items-center justify-between">
          <span className="font-display text-xl">Запас</span>
          <Link to="/login" className="text-sm underline-offset-4 hover:underline">Войти</Link>
        </header>
        <section className="flex flex-1 flex-col justify-center py-16">
          <p className="mb-5 text-xs font-semibold uppercase tracking-[0.2em] text-sidebar-primary">Для жителей Казахстана</p>
          <h1 className="max-w-4xl text-4xl font-medium leading-[1.05] md:text-6xl">
            Не «сколько я потратил»,<br />а «что может пойти не так».
          </h1>
          <p className="mt-6 max-w-xl text-lg text-sidebar-foreground/75">
            Загрузите PDF-выписку банка — мы разберём операции, найдём кредиты и рассрочки и покажем, хватит ли денег до конца месяца и как на вас повлияет курс тенге.
          </p>
          <div className="mt-10 flex flex-wrap gap-3">
            <Button asChild size="lg" className="bg-sidebar-primary text-sidebar-primary-foreground hover:bg-sidebar-primary/90"><Link to="/register">Начать с выписки</Link></Button>
            <Button asChild size="lg" variant="ghost" className="text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"><Link to="/login">Смотреть демо</Link></Button>
          </div>
        </section>
        <section className="grid gap-6 border-t border-sidebar-border pt-8 md:grid-cols-3">
          {[
            { icon: FileText, t: "Без ручного ввода", d: "Выписка Kaspi или Halyk — и расходы, доходы, рассрочки уже на месте." },
            { icon: LineChart, t: "Честные прогнозы", d: "Всегда с диапазоном: «скорее всего так, но может быть вот так»." },
            { icon: ShieldCheck, t: "Ваши данные — ваши", d: "Никакой сторонней аналитики. Удалить всё можно одной кнопкой." },
          ].map(({ icon: Icon, t, d }) => (
            <div key={t} className="flex gap-3"><Icon className="mt-0.5 size-5 shrink-0 text-sidebar-primary" aria-hidden /><div><p className="font-semibold">{t}</p><p className="text-sm text-sidebar-foreground/70">{d}</p></div></div>
          ))}
        </section>
      </div>
    </div>
  );
}
