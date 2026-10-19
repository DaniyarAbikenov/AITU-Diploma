import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Download, Trash2 } from "lucide-react";
import { api, q } from "@/api/client";
import { Card, Loading, PageHeader } from "@/components/kit";
import { Button } from "@/components/ui/button";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle, AlertDialogTrigger } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { signOut, updateSession, useSession } from "@/lib/auth";
import { formatMoney } from "@/lib/format";
import { pageHead } from "@/lib/seo";
import { UploadStep } from "@/components/UploadStep";

export const Route = createFileRoute("/_app/settings")({
  head: pageHead("Настройки и данные", "Счета, правила категорий, экспорт и удаление всех ваших данных."),
  component: Settings,
});

function Settings() {
  const session = useSession();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const accounts = useQuery(q.accounts);
  const rules = useQuery(q.rules);
  const cats = useQuery(q.categories);
  const delRule = useMutation({ mutationFn: api.deleteRule, onSuccess: () => qc.invalidateQueries({ queryKey: ["rules"] }) });
  const wipe = useMutation({ mutationFn: api.deleteAllData, onSuccess: () => { qc.clear(); signOut(); navigate({ to: "/" }); toast.success("Все данные удалены"); } });
  const exportJson = async () => {
    const [tx, goals] = await Promise.all([api.transactions(), api.goals()]);
    const url = URL.createObjectURL(new Blob([JSON.stringify({ transactions: tx, goals }, null, 2)], { type: "application/json" }));
    Object.assign(document.createElement("a"), { href: url, download: "zapas-export.json" }).click(); URL.revokeObjectURL(url);
  };
  return (
    <>
      <PageHeader eyebrow="Настройки" headline="Ваши данные под вашим контролем." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Профиль">
          <div className="space-y-3 text-sm">
            <p className="text-muted-foreground">{session?.user.email}</p>
            <div className="flex items-center gap-3"><span className="w-20 text-foreground">Город</span>
              <Select value={session?.user.city} onValueChange={(city) => updateSession({ user: { city } })}><SelectTrigger className="w-56" aria-label="Город"><SelectValue /></SelectTrigger>
                <SelectContent>{["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Атырау", "Усть-Каменогорск", "Павлодар"].map((c) => <SelectItem key={c} value={c}>{c}</SelectItem>)}</SelectContent></Select></div>
          </div>
        </Card>
        <Card title="Счета">
          {accounts.isLoading ? <Loading /> : <ul className="divide-y">{accounts.data?.map((a) => <li key={a.id} className="flex justify-between py-2 text-sm"><span className="text-foreground">{a.name} <span className="text-xs text-muted-foreground">· {a.bank}</span></span><span className="num text-foreground">{formatMoney(a.balance, "KZT", { withCode: true })}</span></li>)}</ul>}
        </Card>
        <div className="lg:col-span-2"><UploadStep onDone={() => toast.success("Выписка добавлена, прогноз обновлён")} /></div>
        <Card title="Правила категорий">
          {rules.isLoading ? <Loading /> : !rules.data?.length ? <p className="text-sm text-muted-foreground">Правил нет. Они появятся, когда вы примените категорию ко всем операциям получателя.</p> : (
            <ul className="divide-y">{rules.data.map((r) => <li key={r.id} className="flex items-center justify-between py-2 text-sm"><span className="text-foreground">{r.merchant} → <b>{cats.data?.find((c) => c.id === r.categoryId)?.name}</b></span><Button size="icon" variant="ghost" aria-label="Удалить правило" onClick={() => delRule.mutate(r.id)}><Trash2 className="size-4" /></Button></li>)}</ul>
          )}
        </Card>
        <Card title="Приватность">
          <p className="text-sm text-muted-foreground">Выписки удаляются после разбора. Мы храним только операции, нужные для прогноза, не передаём их третьим лицам и не подключаем сторонние сервисы аналитики.</p>
          <div className="mt-4 flex flex-wrap gap-2">
            <Button variant="outline" onClick={exportJson}><Download className="size-4" /> Экспорт данных</Button>
            <AlertDialog>
              <AlertDialogTrigger asChild><Button variant="destructive"><Trash2 className="size-4" /> Удалить все мои данные</Button></AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader><AlertDialogTitle>Удалить всё безвозвратно?</AlertDialogTitle><AlertDialogDescription>Операции, счета, цели, сценарии и аккаунт будут удалены. Восстановить их будет нельзя.</AlertDialogDescription></AlertDialogHeader>
                <AlertDialogFooter><AlertDialogCancel>Отмена</AlertDialogCancel><AlertDialogAction onClick={() => wipe.mutate()}>Да, удалить</AlertDialogAction></AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          </div>
        </Card>
      </div>
    </>
  );
}
