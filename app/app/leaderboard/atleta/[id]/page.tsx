import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentProfile } from "@/lib/supabase/server";
import { getActiveTrainersPublic, getTrainerForClient } from "@/lib/trainer";
import { renderAthleteProfile } from "@/components/athlete-profile";

export const metadata = { title: "Perfil de atleta · LEAP", robots: { index: false, follow: false } };

export default async function AthletePage({ params, searchParams }: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ month?: string; page?: string }>;
}) {
  const [{ id }, back, viewer] = await Promise.all([params, searchParams, getCurrentProfile()]);
  if (!viewer) redirect("/login");
  if (viewer.role !== "client" || viewer.access_blocked || viewer.approval_status !== "approved") notFound();
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(id)) notFound();

  const trainerId = (await getTrainerForClient(viewer.id)) ?? (await getActiveTrainersPublic())[0]?.id;
  if (!trainerId) notFound();

  const athlete = await renderAthleteProfile(id, trainerId);
  if (!athlete) notFound();

  const query = new URLSearchParams();
  if (typeof back.month === "string" && /^\d{4}-\d{2}$/.test(back.month)) query.set("month", back.month);
  if (typeof back.page === "string" && /^\d+$/.test(back.page)) query.set("page", back.page);

  return (
    <div className="space-y-4">
      <Link href={`/app/leaderboard?${query}`} className="inline-flex min-h-11 items-center gap-2 text-sm font-semibold text-gold-700 dark:text-gold-300">
        <ArrowLeft size={16} /> Voltar ao ranking
      </Link>
      {athlete}
    </div>
  );
}
