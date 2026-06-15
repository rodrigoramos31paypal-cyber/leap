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
            // Imagem do slide como fundo full-bleed; o texto fica por cima
            // com um gradiente (scrim) à esquerda para garantir legibilidade.
            <div className="relative flex h-28 overflow-hidden rounded-2xl bg-ink-900 text-bone-50">
              {b.image_url && (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.image_url}
                  alt={b.title}
                  className="absolute inset-0 h-full w-full object-cover"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-r from-ink-900/90 via-ink-900/55 to-ink-900/10" />
              <div className="relative z-10 flex max-w-[70%] flex-col justify-center gap-1 p-4">
                {b.subtitle && (
                  <div className="text-[10px] font-bold uppercase tracking-wide text-gold-400">
                    {b.subtitle}
                  </div>
                )}
                <div className="font-display text-lg font-bold leading-tight line-clamp-2">
                  {b.title}
                </div>
                {b.button_label && (
                  <span className="mt-1 inline-flex w-fit rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-ink-900">
                    {b.button_label}
                  </span>
                )}
              </div>
            </div>
          );
          return (
            <div key={b.id} className="shrink-0 basis-full snap-center">
              {b.link_url ? (
                <a href={b.link_url} target="_blank" rel="noopener noreferrer" className="block h-full">
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
