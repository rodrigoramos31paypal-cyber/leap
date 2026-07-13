"use client";

// PERF (QW-2, audit jun/2026): wrapper que mostra o primeiro slide
// imediatamente (SSR) via PromoBannerStatic, e — só depois do mount —
// faz lazy-import do PromoCarousel completo (com auto-advance, dots,
// scroll-snap). Resultado:
//   • SSR HTML inclui o banner → LCP cobre logo a área promocional.
//   • Sem JS, o user vê na mesma o 1º banner — o carrossel é
//     "progressive enhancement", não obrigatório.
//   • next/dynamic com ssr:false → o chunk do PromoCarousel não entra
//     no JS inicial; é fetched depois do hydration do shell.
import dynamic from "next/dynamic";
import { useEffect, useState } from "react";
import { PromoBannerStatic, type PromoBanner } from "./promo-banner-static";

const PromoCarousel = dynamic(
  () => import("./promo-carousel").then((m) => m.PromoCarousel),
  { ssr: false, loading: () => null },
);

export function PromoSlot({ banners }: { banners: PromoBanner[] }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  if (!banners.length) return null;
  // No SSR e nos primeiros frames depois da hidratação, mostra o
  // primeiro slide estático. Quando mounted → swap para o carrossel
  // (que já tem o chunk em cache do client).
  if (!mounted) return <PromoBannerStatic banner={banners[0]} />;
  return <PromoCarousel banners={banners} />;
}
