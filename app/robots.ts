import type { MetadataRoute } from "next";

// ════════════════════════════════════════════════════════════════
// robots.txt dinâmico · Next 14 metadata file convention.
//
// Permite indexar:
//   • Página inicial (/)
//   • Páginas públicas dos trainers (/t/*)
//
// Bloqueia o resto (área cliente, área admin, endpoints de auth,
// APIs internas). Há também `noindex` por página nas rotas privadas
// — defesa em profundidade contra bots que ignorem robots.txt.
// ════════════════════════════════════════════════════════════════
export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").replace(/\/$/, "");
  return {
    rules: [
      {
        userAgent: "*",
        allow: ["/", "/t/"],
        disallow: [
          "/admin/",
          "/app/",
          "/login",
          "/registar",
          "/recuperar",
          "/auth/",
          "/api/",
          "/offline",
        ],
      },
    ],
    sitemap: base ? `${base}/sitemap.xml` : undefined,
    host: base || undefined,
  };
}
