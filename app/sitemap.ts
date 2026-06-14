import type { MetadataRoute } from "next";
import { createClient } from "@/lib/supabase/server";

// ════════════════════════════════════════════════════════════════
// sitemap.xml dinâmico · gerado em build/runtime.
//
// Inclui:
//   • Home (/)
//   • Todas as páginas públicas de trainers activos (/t/<slug>)
//
// O sitemap revalida ao mesmo ritmo da ISR da página pública do
// trainer (1h) — qualquer trainer novo aparece nos motores de busca
// na próxima ronda.
// ════════════════════════════════════════════════════════════════
export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  const now = new Date();

  const entries: MetadataRoute.Sitemap = [
    {
      url: base || "/",
      lastModified: now,
      changeFrequency: "weekly",
      priority: 1,
    },
  ];

  // Trainers activos · usa o cliente Supabase normal (RLS de 0045
  // permite anon ler `trainers` activos).
  try {
    const supabase = createClient();
    const { data } = await supabase
      .from("trainers")
      .select("slug, updated_at")
      .eq("active", true);
    for (const t of (data ?? []) as Array<{ slug: string; updated_at: string }>) {
      if (!t.slug) continue;
      entries.push({
        url: `${base}/t/${t.slug}`,
        lastModified: t.updated_at ? new Date(t.updated_at) : now,
        changeFrequency: "weekly",
        priority: 0.8,
      });
    }
  } catch {
    // Falha não-fatal — devolvemos pelo menos a entry da home.
  }

  return entries;
}
