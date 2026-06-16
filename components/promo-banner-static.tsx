// SSR-only version of one banner slide — sem JS. Usado como fallback
// SSR enquanto o PromoCarousel (client) hidrata. Apresenta o primeiro
// banner com o mesmo look-and-feel; quando o carrossel monta, substitui
// este placeholder com a versão interactiva (auto-advance + dots).
//
// PERF (QW-2, audit jun/2026): tirar o carrossel do caminho crítico do
// 1º paint — o user vê o banner imediatamente, sem precisar do JS.
import Image from "next/image";

export type PromoBanner = {
  id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  button_label?: string | null;
  link_url?: string | null;
};

export function PromoBannerStatic({ banner }: { banner: PromoBanner | null }) {
  if (!banner) return null;
  const content = (
    <div className="relative flex h-28 overflow-hidden rounded-2xl bg-ink-900 text-bone-50 md:h-auto md:aspect-[3/1]">
      {banner.image_url && (
        <Image
          src={banner.image_url}
          alt={banner.title || "promoção"}
          fill
          sizes="(min-width: 768px) 800px, 100vw"
          className="object-cover object-center"
          priority
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-l from-ink-900/65 via-ink-900/20 to-transparent" />
      <div className="relative z-10 flex h-full w-full items-center justify-between gap-3 p-4 md:p-6">
        <div className="flex min-w-0 max-w-[60%] flex-col gap-1">
          {banner.subtitle && (
            <div className="text-[10px] font-bold uppercase tracking-wide text-gold-400 md:text-xs">
              {banner.subtitle}
            </div>
          )}
          {banner.title && (
            <div className="font-display text-lg font-bold leading-tight line-clamp-2 md:text-2xl lg:text-3xl">
              {banner.title}
            </div>
          )}
        </div>
        {banner.button_label && (
          <span className="pointer-events-none inline-flex shrink-0 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-ink-900 md:px-4 md:py-2 md:text-sm">
            {banner.button_label}
          </span>
        )}
      </div>
    </div>
  );

  return banner.link_url ? (
    <a href={banner.link_url} target="_blank" rel="noopener noreferrer" className="block">
      {content}
    </a>
  ) : (
    content
  );
}
