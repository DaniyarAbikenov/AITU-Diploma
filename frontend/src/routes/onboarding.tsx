import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Check, MapPin } from "lucide-react";
import { api, q } from "@/api/client";
import { PublicFrame } from "@/components/navigator/PublicFrame";
import { ImportPanel } from "@/components/navigator/live/ImportPanel";
import { IncomesPanel, ObligationsPanel } from "@/components/navigator/live/LivePayments";
import { ru } from "@/i18n/ru";
import { updateSession, useSession } from "@/lib/auth";

export const Route = createFileRoute("/onboarding")({
  head: () => ({
    meta: [
      { title: "Настройка — Financial Life Navigator" },
      {
        name: "description",
        content: "Город, выписка банка и подтверждение найденных доходов и платежей.",
      },
    ],
  }),
  component: Onboarding,
});

const CITIES = [
  "Алматы",
  "Астана",
  "Шымкент",
  "Караганда",
  "Актобе",
  "Атырау",
  "Усть-Каменогорск",
  "Павлодар",
];
const t = ru.pub;

function Onboarding() {
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [step, setStep] = useState(0);
  const [city, setCity] = useState(session?.user.city ?? "Алматы");
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (session === null) navigate({ to: "/register" });
  }, [session, navigate]);
  const saveCity = useMutation({
    mutationFn: () => api.updateMe({ city }),
    onSuccess: (u) => {
      qc.setQueryData(["me"], u);
      updateSession({ user: { city } });
      setStep(1);
    },
  });
  const income = useQuery({ ...q.income, enabled: step === 2 });
  const obligations = useQuery({ ...q.obligations, enabled: step === 2 });
  return (
    <PublicFrame>
      <div className="nav-public-wide">
        <ol className="nav-steps" aria-label="Шаги">
          {t.steps.map((s, i) => (
            <li key={s} className={i === step ? "active" : i < step ? "done" : ""}>
              <span>{i < step ? <Check size={13} /> : i + 1}</span>
              {s}
            </li>
          ))}
        </ol>
        {step === 0 && (
          <section className="nav-panel">
            <MapPin aria-hidden />
            <h1>{t.cityTitle(session?.user.name)}</h1>
            <p className="nav-small">{t.cityText}</p>
            <div className="nav-choice-grid" role="group" aria-label="Город">
              {CITIES.map((c) => (
                <button
                  key={c}
                  type="button"
                  className={city === c ? "active" : ""}
                  aria-pressed={city === c}
                  onClick={() => setCity(c)}
                >
                  {c}
                </button>
              ))}
            </div>
            <button
              className="nav-primary"
              disabled={saveCity.isPending}
              onClick={() => saveCity.mutate()}
            >
              {t.next}
            </button>
            {saveCity.isError && (
              <p className="nav-error" role="alert">
                {saveCity.error.message}
              </p>
            )}
          </section>
        )}
        {step === 1 && (
          <>
            <ImportPanel />
            <div className="nav-actions">
              <button className="nav-primary" onClick={() => setStep(2)}>
                {t.next}
              </button>
              <button className="nav-text-button" onClick={() => navigate({ to: "/navigator" })}>
                {t.skip}
              </button>
            </div>
          </>
        )}
        {step === 2 && (
          <>
            <section className="nav-panel">
              <h1>{t.confirmTitle}</h1>
              <p className="nav-small">{t.confirmText}</p>
            </section>
            <IncomesPanel
              incomes={income.data ?? []}
              onEdit={() => navigate({ to: "/navigator" })}
              notify={setToast}
            />
            <ObligationsPanel obligations={obligations.data ?? []} notify={setToast} />
            {toast && (
              <p className="nav-small" role="status">
                {toast}
              </p>
            )}
            <button
              className="nav-primary"
              onClick={() => {
                updateSession({ onboarded: true });
                navigate({ to: "/navigator" });
              }}
            >
              {t.finish}
            </button>
          </>
        )}
      </div>
    </PublicFrame>
  );
}
