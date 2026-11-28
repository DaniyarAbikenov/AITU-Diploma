import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Download, LogOut, Trash2 } from "lucide-react";
import { api } from "@/api/client";
import { ru } from "@/i18n/ru";
import { signOut } from "@/lib/auth";
import { Panel } from "../shared";
import { FormError } from "./forms";
import { confirmed } from "./hooks";

const t = ru.privacy;

/** Export of the user's data and the right to erasure (previously in the old settings page). */
export function PrivacyPanel({ email }: { email: string }) {
  const qc = useQueryClient();
  const exportJson = useMutation({
    mutationFn: async () => {
      const [transactions, goals, accounts, obligations, income, planned] = await Promise.all([
        api.transactions(),
        api.goals(),
        api.accounts(),
        api.obligations(),
        api.income(),
        api.planned(),
      ]);
      const blob = new Blob(
        [JSON.stringify({ accounts, transactions, obligations, income, planned, goals }, null, 2)],
        { type: "application/json" },
      );
      const url = URL.createObjectURL(blob);
      Object.assign(document.createElement("a"), {
        href: url,
        download: "navigator-export.json",
      }).click();
      URL.revokeObjectURL(url);
    },
  });
  const wipe = useMutation({
    mutationFn: api.deleteAllData,
    onSuccess: () => {
      qc.clear();
      signOut();
      window.location.href = "/";
    },
  });
  return (
    <Panel title={t.title}>
      <p className="nav-small">{t.email(email)}</p>
      <p className="nav-small">{t.text}</p>
      <div className="nav-actions">
        <button
          className="nav-secondary"
          disabled={exportJson.isPending}
          onClick={() => exportJson.mutate()}
        >
          <Download size={16} /> {t.export}
        </button>
        <button
          className="nav-secondary nav-danger"
          disabled={wipe.isPending}
          onClick={() => confirmed(t.wipeConfirm) && wipe.mutate()}
        >
          <Trash2 size={16} /> {t.wipe}
        </button>
        <button
          className="nav-text-button"
          onClick={() => {
            qc.clear();
            signOut();
            window.location.href = "/";
          }}
        >
          <LogOut size={16} /> {t.logout}
        </button>
      </div>
      <FormError error={exportJson.error || wipe.error} />
    </Panel>
  );
}
