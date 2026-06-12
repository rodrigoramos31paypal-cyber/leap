import { redirect } from "next/navigation";
import { createClient, getSessionUser } from "@/lib/supabase/server";
import { updateProfileAction } from "./actions";
import { BackLink } from "@/components/back-link";

export default async function PerfilPage({
  searchParams,
}: {
  searchParams: { ok?: string };
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");

  const supabase = createClient();

  const { data: profile } = await supabase.from("profiles").select("*").eq("id", user.id).single();

  return (
    <div className="space-y-5">
      <BackLink />
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Perfil</h1>
        <p className="text-sm text-ink-500">Os teus dados pessoais.</p>
      </div>

      {searchParams.ok && (
        <div className="rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-700">Perfil atualizado.</div>
      )}

      <form action={updateProfileAction} className="card space-y-4 p-5">
        <div>
          <label className="label">Nome completo</label>
          <input name="full_name" defaultValue={profile?.full_name ?? ""} required className="input" />
        </div>
        <div>
          <label className="label">Email</label>
          <input value={profile?.email ?? ""} disabled className="input bg-bone-100 text-ink-500" />
        </div>
        <div>
          <label className="label">Telemóvel</label>
          <input name="phone" defaultValue={profile?.phone ?? ""} className="input" />
        </div>
        <button type="submit" className="btn-primary w-full">Guardar</button>
      </form>
    </div>
  );
}
