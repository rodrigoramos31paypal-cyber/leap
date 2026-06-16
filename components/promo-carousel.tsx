"use client";

import { useEffect, useRef, useState } from "react";

export type PromoBanner = {
  id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  button_label?: string | null;
  link_url?: string | null;
};

// ── Auto-advance ───────────────────────────────────────────────────────
// Roda automaticamente para o próximo slide a cada 5 s, com loop ao
// chegar ao fim. Pausa quando o utilizador interage (touch / pointer / scroll
// manual) por uns segundos, para não combater o gesto. Mobile e desktop
// usam exactamente o mesmo timer.
const ROTATE_MS = 5000;
const RESUME_AFTER_INTERACT_MS = 6000;

export function PromoCarousel({ banners }: { banners: PromoBanner[] }) {
  const [idx, setIdx] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const lastInteractRef = useRef<number>(0);

  if (!banners.length) return null;

  function onScroll() {
    const el = ref.current;
    if (!el) return;
    setIdx(Math.round(el.scrollLeft / Math.max(1, el.clientWidth)));
  }

  // Marca interação para o auto-advance pausar momentaneamente. Sem isto
  // o timer continuava a empurrar o slide para a frente enquanto o
  // utilizador estava a fazer swipe / scroll manual.
  function markInteract() {
    lastInteractRef.current = Date.now();
  }

  // Auto-advance — só faz sentido com mais de 1 slide.
  useEffect(() => {
    if (banners.length <= 1) return;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      // Pausa se o utilizador interagiu há pouco.
      if (Date.now() - lastInteractRef.current < RESUME_AFTER_INTERACT_MS) return;
      // Pausa se o tab está em background (poupa CPU/bateria).
      if (typeof document !== "undefined" && document.hidden) return;
      const w = Math.max(1, el.clientWidth);
      const current = Math.round(el.scrollLeft / w);
      const next = (current + 1) % banners.length;
      el.scrollTo({ left: next * w, behavior: "smooth" });
    }, ROTATE_MS);
    return () => window.clearInterval(id);
  }, [banners.length]);

  return (
    <div>
      <div
        ref={ref}
        onScroll={onScroll}
        onPointerDown={markInteract}
        onTouchStart={markInteract}
        onWheel={markInteract}
        className="flex snap-x snap-mandatory gap-3 overflow-x-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
      >
        {banners.map((b) => {
          const card = (
            // Mobile mantém o h-28 original; em desktop (md+) a altura
            // sobe para reduzir o corte vertical agressivo do object-cover
            // — a sensação de "zoom in" desaparece sem mexer no mobile.
            <div className="relative flex h-28 overflow-hidden rounded-2xl bg-ink-900 text-bone-50 transition active:scale-[0.99] md:h-44 lg:h-52">
              {b.image_url && (
                // Mobile: `object-cover` (full-bleed, pode cortar — é o que
                // estava bem). Desktop (md+): `object-contain` para mostrar
                // a imagem INTEIRA sem cortes. As barras laterais ficam
                // sobre o `bg-ink-900` do container e somem-se na maioria
                // dos banners (que já têm fundo escuro). object-center
                // centra o contido.
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={b.image_url}
                  alt={b.title || "slide"}
                  className="absolute inset-0 h-full w-full object-cover object-center md:object-contain"
                />
              )}
              <div className="absolute inset-0 bg-gradient-to-l from-ink-900/65 via-ink-900/20 to-transparent" />
              <div className="relative z-10 flex h-full w-full items-center justify-between gap-3 p-4 md:p-6">
                <div className="flex min-w-0 max-w-[60%] flex-col gap-1">
                  {b.subtitle && (
                    <div className="text-[10px] font-bold uppercase tracking-wide text-gold-400 md:text-xs">
                      {b.subtitle}
                    </div>
                  )}
                  {b.title && (
                    <div className="font-display text-lg font-bold leading-tight line-clamp-2 md:text-2xl lg:text-3xl">
                      {b.title}
                    </div>
                  )}
                </div>
                {b.button_label && (
                  <span className="pointer-events-none inline-flex shrink-0 rounded-lg bg-gold-400 px-3 py-1.5 text-xs font-semibold text-ink-900 md:px-4 md:py-2 md:text-sm">
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
