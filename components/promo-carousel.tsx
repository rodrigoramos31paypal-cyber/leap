"use client";

import { useRef, useState } from "react";

export type PromoBanner = {
  id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  button_label?: string | null;
  link_url?: string | null;
};

export function PromoCarousel({ banners }: { banners: PromoBanner[] }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);

  if (!banners.length) return null;

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }

  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {banners.map((b) => {
          const card = (
            // Imagem do slide como fundo full-bleed. A altura cresce com o
            // breakpoint para que o `object-cover` corte menos a imagem em
            // ecrãs largos (antes era sempre `h-28` ≈ 112 px: num desktop
            // de 1200 px, isso recortava a imagem para uma faixa ~10:1 e
            // dava sensação de "zoom in"). Texto à esquerda + botão à
            // direita, com gradiente subtil do lado direito.
            <div className="relative flex h-36 overflow-hidden rounded-2xl bg-ink-900 text-bone-50 transition active:scale-[0.99] sm:h-44 md:h-52 lg:h-60">
              {b.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.image_url}
                  alt={b.title || "slide"}
                  className="absolute inset-0 h-full w-full object-cover object-center"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-l from-ink-900/65 via-ink-900/20 to-transparent" />
              <div className="relative z-10 flex h-full w-full items-center justify-between gap-3 p-4 sm:p-5 md:p-6">
                <div className="flex min-w-0 max-w-[60%] flex-col gap-1">
                  {b.subtitle && (
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gold-400 sm:text-xs">
                      {b.subtitle}
                    </div>
                  )}
                  {b.title && (
                    <div className="font-display text-lg font-bold leading-tight line-clamp-2 sm:text-2xl md:text-3xl">
                      {b.title}
                    </div>
                  )}
                </div>
                {b.button_label && (
                  <span className="pointer-events-none inline-flex shrink-0 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-ink-900 sm:px-4 sm:py-2 sm:text-sm">
                    {b.button_label}
                  </span>
                )}
              </div>
            </div>
          );
          return (
            <div key={b.id} className="shrink-0 basis-full snap-center">
              {b.link_url ? (
                <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="block h-full cursor-pointer">
                  {card}
                </a>
              ) : (
                card
              )}
            </div>
          );
        })}
      </div>

      {banners.length > 1 && (
        <div className="mt-2 flex justify-center gap-1.5">
          {banners.map((_, i) => (
            <span
              key={i}
              className={`h-1.5 w-1.5 rounded-full transition-colors ${
                i === idx ? "bg-ink-900 dark:bg-bone-50" : "bg-ink-900/20 dark:bg-white/20"
              }`}
            />
          ))}
        </div>
      )}
    </div>
  );
}
