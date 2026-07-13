import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { BackLink } from "@/components/back-link";
import { listVerifiedFactors } from "@/lib/mfa";
import { EnrollCard } from "./enroll-card";
import { unenrollAction } from "./actions";

export default async function SegurancaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const profile = await getCurrentProfile();
  const factors = await listVerifiedFactors();
  const hasFactor = factors.length > 0;
  const isAdmin = profile?.role === "trainer" || profile?.role === "owner";

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Segurança</h1>
        <p className="text-sm text-ink-500">
          Verificação em dois passos e dispositivos confiados.
        </p>
      </div>

      {isAdmin && !hasFactor && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <div className="font-semibold">2FA recomendado para contas admin</div>
          <p className="mt-1 text-xs">
            Como és trainer/owner, ativar 2FA protege o acesso à gestão dos teus clientes
            mesmo que a tua password seja comprometida.
          </p>
        </div>
      )}

      {hasFactor ? (
        <div className="card space-y-3 p-5">
          <div className="flex items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-emerald-50 text-emerald-600">
              <ShieldCheck size={18} />
            </span>
            <div className="min-w-0 flex-1">
              <div className="text-sm font-semibold">2FA está activa</div>
              <div className="text-xs text-ink-500">
                Vais ter de meter um código do teu app de autenticação ao entrares em
                dispositivos novos.
              </div>
            </div>
          </div>
          {factors.map((f) => (
            <form key={f.id} action={unenrollAction} className="space-y-2 rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2">
              <input type="hidden" name="factorId" value={f.id} />
              <div className="text-xs">
                <div className="font-semibold">{f.friendly_name || "Authenticator app"}</div>
                <div className="text-ink-500">
                  Configurado em {new Date(f.created_at).toLocaleDateString("pt-PT")}
                </div>
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
                <button className="btn-outline shrink-0 text-xs text-red-700 hover:bg-red-50 border-red-200">
                  Desactivar
                </button>
              </div>
            </form>
          ))}
        </div>
      ) : (
        <EnrollCard />
      )}

      <div className="rounded-xl border border-ink-900/10 bg-bone-100 p-4 text-xs text-ink-600">
        <p className="font-semibold text-ink-900">Dispositivos confiados</p>
        <p className="mt-2">
          Ao confirmares 2FA num dispositivo, podes marcar a opção &quot;Confiar neste dispositivo 30
          dias&quot;. Enquanto o prazo não expirar, esse dispositivo não te pede o código a cada login.
        </p>
      </div>
    </div>
  );
}
