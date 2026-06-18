import { redirect } from "next/navigation";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import {
  addTrainerAction,
  toggleTrainerActiveAction,
  demoteTrainerAction,
  grantAdminByEmailAction,
  makeOwnerOnlyAction,
  revokeAdminByProfileAction,
  makeStudioTrainerAction,
} from "./actions";
import { Plus, UserCheck, UserX, ShieldCheck, UserCog, ArrowRightLeft } from "lucide-react";

export async function EquipaSection() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = await createClient();

  // PERF: layout admin ja chamou getCurrentProfile() — aqui vem do cache.
  const me = await getCurrentProfile();
  if (me?.role !== "owner") {
    return (
      <div className="card p-5 text-sm text-ink-500">
        Esta secção está reservada ao dono do estúdio.
      </div>
    );
  }

  const { data: trainers } = await supabase
    .from("trainers")
    .select("id, slug, active, bio, profile_id, profiles:profile_id(full_name, email, phone, role)")
    .order("slug");

  // Só mostra staff actual. Contas despromovidas a cliente (via Remover /
  // Revogar admin) mantêm o registo de trainer por causa do histórico de
  // marcações/compras (FK), mas deixam de ser equipa — escondemo-las aqui.
  const team = (trainers ?? []).filter(
    (t: any) => t.profiles?.role === "owner" || t.profiles?.role === "trainer",
  );
  const trainerCount = (trainers ?? []).length;

  // Admins = contas owner SEM trainer próprio. Partilham o calendário do
  // estúdio (não aparecem na lista de trainers acima).
  const trainerProfileIds = new Set((trainers ?? []).map((t: any) => t.profile_id));
  const { data: ownerProfiles } = await supabase
    .from("profiles")
    .select("id, full_name, email")
    .eq("role", "owner")
    .order("full_name");
  const admins = (ownerProfiles ?? []).filter((o: any) => !trainerProfileIds.has(o.id));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Equipa</h1>
        <p className="text-sm text-ink-500">Adiciona, activa ou remove trainers.</p>
      </div>

      <details className="card p-5">
        <summary className="cursor-pointer text-sm font-semibold inline-flex items-center gap-2">
          <Plus size={16} /> Adicionar trainer
        </summary>
        {/* H4: addTrainerAction tipa estritamente Promise<{error?,ok?}>
            (sem `| void`), portanto o cast directo dá TS2352 — usar
            `as unknown as` para forçar. O return value não é consumido
            por useFormState aqui. */}
        <form action={addTrainerAction as unknown as (fd: FormData) => Promise<void>} className="mt-4 grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Nome completo</label>
            <input name="full_name" required minLength={2} className="input" />
          </div>
          <div>
            <label className="label">Email</label>
            <input name="email" type="email" required className="input" />
          </div>
          <div>
            <label className="label">Slug (identificador URL)</label>
            <input name="slug" required pattern="[a-z0-9-]+" className="input" placeholder="ex: maria" />
          </div>
          <div>
            <label className="label">Password inicial</label>
            <input name="password" type="password" required minLength={8} className="input" />
            <p className="mt-1 text-xs text-ink-500">O trainer poderá alterar depois do primeiro login.</p>
          </div>
          <div className="sm:col-span-2">
            <button className="btn-primary w-full sm:w-auto">Criar trainer</button>
          </div>
        </form>
      </details>

      <details className="card p-5">
        <summary className="cursor-pointer text-sm font-semibold inline-flex items-center gap-2">
          <ShieldCheck size={16} /> Conceder admin a conta existente
        </summary>
        <p className="mt-3 text-xs text-ink-500">
          A conta tem de já estar registada na app. Fica com acesso total e as
          mesmas notificações, e <strong>partilha o calendário do estúdio</strong>
          {" "}— não cria um trainer novo (os clientes não passam a ter de escolher
          trainer). Se o email não estiver registado, aparece um erro.
        </p>
        <form
          action={grantAdminByEmailAction as unknown as (fd: FormData) => Promise<void>}
          className="mt-3 flex flex-col gap-3 sm:flex-row sm:items-end"
        >
          <div className="sm:flex-1">
            <label className="label">Email da conta</label>
            <input name="email" type="email" required className="input" placeholder="email@exemplo.com" />
          </div>
          <button className="btn-primary w-full sm:w-auto">Tornar admin</button>
        </form>
      </details>

      <ul className="space-y-2">
        {team.map((t: any) => (
          <li key={t.id} className="card p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm font-semibold">
                  {t.profiles?.full_name ?? "—"}{" "}
                  <span className="ml-1 text-xs font-normal text-ink-500">@{t.slug}</span>
                </div>
                <div className="text-xs text-ink-500">
                  {t.profiles?.email}
                  {t.profiles?.phone ? ` · ${t.profiles.phone}` : ""}
                  {t.profiles?.role === "owner" && <span className="ml-1.5 chip-gold">Owner</span>}
                </div>
              </div>
              <div className="flex items-center gap-2">
                <span className={t.active ? "chip-ok" : "chip-mute"}>
                  {t.active ? "Activo" : "Desactivado"}
                </span>
                {t.profile_id !== user.id && (
                  <>
                    <form action={toggleTrainerActiveAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <input type="hidden" name="active" value={String(!t.active)} />
                      <button className="btn-outline inline-flex items-center gap-1.5 text-xs">
                        {t.active ? <UserX size={12} /> : <UserCheck size={12} />}
                        {t.active ? "Desactivar" : "Activar"}
                      </button>
                    </form>
                    {t.profiles?.role === "owner" && trainerCount > 1 && (
                      <form action={makeOwnerOnlyAction}>
                        <input type="hidden" name="id" value={t.id} />
                        <button className="btn-outline inline-flex items-center gap-1.5 text-xs">
                          <UserCog size={12} /> Só admin
                        </button>
                      </form>
                    )}
                    <form action={demoteTrainerAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn-outline border-red-200 text-xs text-red-700 hover:bg-red-50">
                        {t.profiles?.role === "owner" ? "Revogar admin" : "Remover"}
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
        {team.length === 0 && (
          <li className="card p-5 text-center text-sm text-ink-500">Sem trainers.</li>
           )}
      </ul>

      {admins.length > 0 && (
        <div className="space-y-2">
          <div className="pt-2">
            <h2 className="font-display text-lg font-bold tracking-tight">Admins</h2>
            <p className="text-sm text-ink-500">
              Contas com acesso total que partilham o calendário do estúdio (sem trainer próprio).
            </p>
          </div>
          <ul className="space-y-2">
            {admins.map((a: any) => (
              <li key={a.id} className="card p-4">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="text-sm font-semibold">
                      {a.full_name ?? "—"}
                      <span className="ml-1.5 chip-gold">Admin</span>
                      {a.id === user.id && (
                        <span className="ml-1 text-xs font-normal text-ink-500">(tu)</span>
                      )}
                    </div>
                    <div className="text-xs text-ink-500">{a.email}</div>
                  </div>
                  <div className="flex items-center gap-2">
                    {trainerCount === 1 && (
                      <form action={makeStudioTrainerAction}>
                        <input type="hidden" name="profileId" value={a.id} />
                        <button className="btn-outline inline-flex items-center gap-1.5 text-xs">
                          <ArrowRightLeft size={12} /> Tornar trainer
                        </button>
                      </form>
                    )}
                    {a.id !== user.id && (
                      <form action={revokeAdminByProfileAction}>
                        <input type="hidden" name="profileId" value={a.id} />
                        <button className="btn-outline border-red-200 text-xs text-red-700 hover:bg-red-50">
                          Revogar admin
                        </button>
                      </form>
                    )}
                  </div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
