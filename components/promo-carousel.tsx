"use client";

import Image from "next/image";
import { useEffect, useRef, useState } from "react";

export type PromoBanner = {
  id: string;
  title: string;
  subtitle?: string | null;
  image_url?: string | null;
  button_label?: string | null;
  link_url?: string | null;
};

// SEC (C-B audit jun/2026): defesa em profundidade contra
// `javascript:`/`data:` URIs em link_url. O server action valida
// antes de gravar, mas dados antigos podem existir e React não
// bloqueia esquemas perigosos em `<a href={...}>`. Só renderizamos
// `<a>` quando a string começa por http(s):.
function safeHref(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  return /^https?:\/\//i.test(url) ? url : undefined;
}

// ── Auto-advance ───────────────────────────────────────────────────────
// Roda automaticamente para o próximo slide a cada 5 s, com loop ao
// chegar ao fim. Pausa quando o utilizador interage (touch / pointer /
// scroll manual) por uns segundos, para não combater o gesto. Mobile e
// desktop usam exactamente o mesmo timer.
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

  function markInteract() {
    lastInteractRef.current = Date.now();
  }

  useEffect(() => {
    if (banners.length <= 1) return;
    const id = window.setInterval(() => {
      const el = ref.current;
      if (!el) return;
      if (Date.now() - lastInteractRef.current < RESUME_AFTER_INTERACT_MS) return;
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
          const href = safeHref(b.link_url);
          return (
            <div key={b.id} className="shrink-0 basis-full snap-center">
              {href ? (
                <a href={href} target="_blank" rel="noopener noreferrer" className="block h-full cursor-pointer">
                  <PromoCard b={b} />
                </a>
              ) : (
                <PromoCard b={b} />
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

// ── Slide individual ─────────────────────────────────────────────────
// MOBILE: altura fixa h-28 + object-cover (full-bleed; pode cortar — é o
// look pretendido).
// DESKTOP (md+): a altura do slide passa a ser ditada pelo RÁCIO NATURAL
// da imagem do banner. Ao carregar, lemos `naturalWidth / naturalHeight`
// e aplicamos esse rácio via `aspect-ratio` inline. Resultado: a imagem
// preenche o slide INTEIRO sem cortes nem barras laterais, independente-
// mente do rácio que o autor do banner usou. Antes de a imagem carregar,
// fallback a `aspect-[3/1]` (típico de banners promocionais).
function PromoCard({ b }: { b: PromoBanner }) {
  // PERF (QW-14 audit jun/2026): antes, ao carregar a imagem
  // injectávamos uma <style> tag por banner com `aspect-ratio: X
  // !important` numa media query. Cada injecção causa style
  // recalculation + reflow — visível como jank no mobile quando o
  // carrossel passa para um banner novo. Agora aplicamos via inline
  // `style` no próprio div em md+, sem injectar CSS.
  const [aspect, setAspect] = useState<number | null>(null);

  function onImageLoad(e: React.SyntheticEvent<HTMLImageElement>) {
    const img = e.currentTarget;
    if (img.naturalWidth && img.naturalHeight) {
      setAspect(img.naturalWidth / img.naturalHeight);
    }
  }

  // Em desktop (md:h-auto), aspect-ratio inline ganha. Em mobile o
  // h-28 explícito ganha, e o aspect-ratio é ignorado.
  const styleObj: React.CSSProperties | undefined = aspect
    ? { aspectRatio: aspect }
    : undefined;

  return (
    <div
      className="relative flex h-28 overflow-hidden rounded-2xl bg-ink-900 text-bone-50 transition active:scale-[0.99] md:h-auto md:aspect-[3/1]"
      style={styleObj}
    >
      {b.image_url && (
        <Image
          src={b.image_url}
          alt={b.title || "slide"}
          fill
          sizes="(min-width: 768px) 800px, 100vw"
          onLoad={onImageLoad}
          className="object-cover object-center"
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
}
