import { redirect } from "next/navigation";
import { createClient, getSessionUser, getCurrentProfile } from "@/lib/supabase/server";
import { addTrainerAction, toggleTrainerActiveAction, deleteTrainerAction } from "./actions";
import { Plus, UserCheck, UserX } from "lucide-react";

export default async function EquipaPage() {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

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

      <ul className="space-y-2">
        {(trainers ?? []).map((t: any) => (
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
                    <form action={deleteTrainerAction}>
                      <input type="hidden" name="id" value={t.id} />
                      <button className="btn-outline border-red-200 text-xs text-red-700 hover:bg-red-50">
                        Remover
                      </button>
                    </form>
                  </>
                )}
              </div>
            </div>
          </li>
        ))}
        {(trainers?.length ?? 0) === 0 && (
          <li className="card p-5 text-center text-sm text-ink-500">Sem trainers.</li>
           )}
      </ul>
    </div>
  );
}
