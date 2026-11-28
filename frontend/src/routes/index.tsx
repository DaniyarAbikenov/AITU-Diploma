import { createFileRoute, Link } from "@tanstack/react-router";
import { FileText, LineChart, ShieldCheck } from "lucide-react";
import { PublicFrame } from "@/components/navigator/PublicFrame";
import { ru } from "@/i18n/ru";
import { useSession } from "@/lib/auth";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Financial Life Navigator — финансовая устойчивость по выписке банка" },
      { name: "description", content: ru.pub.landingText },
      { property: "og:title", content: "Financial Life Navigator" },
      { property: "og:description", content: ru.pub.landingTitle },
    ],
  }),
  component: Landing,
});

const ICONS = [FileText, LineChart, ShieldCheck];

function Landing() {
  const session = useSession();
  const t = ru.pub;
  return (
    <PublicFrame
      actions={
        session ? (
          <Link to="/navigator" className="nav-primary">
            {ru.brand.app}
          </Link>
        ) : (
          <Link to="/login" className="nav-secondary">
            {t.login}
          </Link>
        )
      }
    >
      <section className="nav-landing">
        <div>
          <p className="nav-eyebrow">{t.landingEyebrow}</p>
          <h1>{t.landingTitle}</h1>
          <p>{t.landingText}</p>
          <div className="nav-actions" style={{ marginTop: 28 }}>
            <Link to={session ? "/navigator" : "/register"} className="nav-primary">
              {session ? ru.brand.app : t.register}
            </Link>
            <a href="/navigator?mode=demo" className="nav-secondary">
              {t.demo}
            </a>
          </div>
        </div>
        <div className="nav-panel">
          <p className="nav-small">Свободно на день</p>
          <p className="nav-large">12 400 ₸</p>
          <p className="nav-small">
            до дня перед зарплатой, с учётом аренды, кредита и плановых трат
          </p>
        </div>
      </section>
      <section className="nav-features">
        {t.features.map((f, i) => {
          const Icon = ICONS[i];
          return (
            <div key={f.t} className="nav-panel">
              <span className="nav-icon">
                <Icon size={20} />
              </span>
              <h3>{f.t}</h3>
              <p className="nav-small">{f.d}</p>
            </div>
          );
        })}
      </section>
    </PublicFrame>
  );
}
