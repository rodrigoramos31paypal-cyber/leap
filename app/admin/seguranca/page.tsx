import { redirect } from "next/navigation";
import { ShieldCheck, AlertTriangle, SmartphoneNfc } from "lucide-react";
import { getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { listVerifiedFactors } from "@/lib/mfa";
// Reutiliza os componentes/actions do espaço cliente — mesma UI, mesmas regras.
import { EnrollCard } from "@/app/app/perfil/seguranca/enroll-card";
import { unenrollAction } from "@/app/app/perfil/seguranca/actions";

export default async function AdminSegurancaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  if (profile?.role !== "trainer" && profile?.role !== "owner") {
    redirect("/app/dashboard");
  }

  const factors = await listVerifiedFactors();
  const hasFactor = factors.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-[1.75rem] font-bold leading-tight tracking-tight">Segurança</h1>
        <p className="text-[12.5px] text-ink-500">Verificação em dois passos (2FA) da tua conta de administração</p>
      </div>

      {!hasFactor && (
        <div className="flex items-start gap-2.5 rounded-xl border border-[#FAC775] bg-[#FAEEDA] p-3 dark:border-amber-500/30 dark:bg-amber-500/10">
          <AlertTriangle size={17} className="mt-0.5 shrink-0 text-[#854F0B] dark:text-amber-400" />
          <div className="text-[12px] leading-relaxed text-[#633806] dark:text-amber-200">
            <span className="font-semibold">Ativa a 2FA.</span> Protege o acesso à gestão dos teus clientes mesmo que a
            password seja comprometida. Depois de ativar podes marcar &quot;confiar 30 dias&quot; e deixas de meter o código a
            cada login no mesmo browser.
          </div>
        </div>
      )}

      {hasFactor ? (
        <div className="card p-4">
          <div className="flex items-center gap-3">
            <span className="grid h-11 w-11 shrink-0 place-items-center rounded-xl bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              <ShieldCheck size={22} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-[14px] font-semibold text-ink-900 dark:text-bone-50">2FA ativa</div>
              <div className="text-[11.5px] text-ink-500">Pede um código do teu app de autenticação em dispositivos novos.</div>
            </div>
            <span className="shrink-0 rounded-full bg-emerald-100 px-2.5 py-0.5 text-[10px] font-semibold text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300">
              Protegida
            </span>
          </div>
          {factors.map((f) => (
            <form
              key={f.id}
              action={unenrollAction}
              className="mt-3 space-y-2 rounded-xl border border-ink-900/10 bg-bone-50 p-3 dark:border-white/10 dark:bg-white/[0.03]"
            >
              <input type="hidden" name="factorId" value={f.id} />
              <div className="text-xs">
                <div className="font-semibold text-ink-900 dark:text-bone-50">{f.friendly_name || "Authenticator app"}</div>
                <div className="text-ink-500">Configurado em {new Date(f.created_at).toLocaleDateString("pt-PT")}</div>
              </div>
              <div className="flex items-center gap-2">
                <input
                  name="code"
                  inputMode="numeric"
                  pattern="[0-9]{6}"
                  maxLength={6}
                  required
                  autoComplete="one-time-code"
                  className="input flex-1 text-center font-mono tracking-[0.3em]"
                  placeholder="Código 2FA"
                  aria-label="Código 2FA actual"
                />
                <button className="shrink-0 rounded-lg border border-red-200 px-3 py-2 text-xs font-semibold text-red-700 transition hover:bg-red-50 dark:border-red-500/30 dark:text-red-300 dark:hover:bg-red-500/10">
                  Desativar
                </button>
              </div>
            </form>
          ))}
        </div>
      ) : (
        <EnrollCard />
      )}

      <div className="rounded-xl border border-ink-900/[0.07] bg-bone-100 p-4 dark:border-white/10 dark:bg-white/5">
        <div className="flex items-center gap-1.5 text-[12px] font-semibold text-ink-900 dark:text-bone-50">
          <SmartphoneNfc size={15} /> Dispositivos confiados
        </div>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-600 dark:text-bone-100/70">
          Ao confirmares a 2FA num dispositivo, podes marcar &quot;confiar neste dispositivo 30 dias&quot;. Enquanto o prazo não
          expirar, esse dispositivo não te pede o código a cada login.
        </p>
      </div>
    </div>
  );
}
