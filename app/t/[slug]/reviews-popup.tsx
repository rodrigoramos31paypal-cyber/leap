"use client";

import { useState } from "react";
import { Star, X } from "lucide-react";
import type { TrainerReview } from "@/lib/ratings";

// Pop-up de reviews. Trigger = caixa com as estrelas e a contagem;
// ao clicar abre um <dialog> com a lista. Server passa as reviews
// como prop (já carregadas) para evitar uma round-trip extra.
export function ReviewsPopup({
  avgStars,
  reviewCount,
  reviews,
}: {
  avgStars: number | null;
  reviewCount: number;
  reviews: TrainerReview[];
}) {
  const [open, setOpen] = useState(false);

  const trigger = (
    <button
      type="button"
      onClick={() => reviewCount > 0 && setOpen(true)}
      disabled={reviewCount === 0}
      className="flex items-center gap-2 rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2 text-sm hover:bg-bone-100 disabled:cursor-default disabled:opacity-60"
      aria-label={reviewCount === 0 ? "Sem avaliações" : "Ver avaliações"}
    >
      <Stars value={avgStars ?? 0} />
      <span className="font-semibold tabular-nums">
        {avgStars != null ? avgStars.toFixed(1) : "—"}
      </span>
      <span className="text-ink-500">({reviewCount})</span>
    </button>
  );

  if (!open) return trigger;

  return (
    <>
      {trigger}
      <div
        className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-4"
        onClick={() => setOpen(false)}
      >
        <div
          className="card max-h-[85vh] w-full max-w-lg overflow-hidden p-0 sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          <div className="flex items-center justify-between border-b border-ink-900/10 px-5 py-4">
            <div>
              <div className="text-sm font-semibold uppercase tracking-wide text-ink-500">
                Avaliações
              </div>
              <div className="mt-0.5 flex items-center gap-2">
                <Stars value={avgStars ?? 0} />
                <span className="font-display text-lg font-bold tabular-nums">
                  {avgStars != null ? avgStars.toFixed(1) : "—"}
                </span>
                <span className="text-sm text-ink-500">({reviewCount})</span>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="rounded-lg p-2 hover:bg-bone-100"
              aria-label="Fechar"
            >
              <X size={18} />
            </button>
          </div>

          <ul className="max-h-[70vh] divide-y divide-ink-900/10 overflow-y-auto">
            {reviews.length === 0 ? (
              <li className="p-5 text-center text-sm text-ink-500">Sem avaliações ainda.</li>
            ) : (
              reviews.map((r, i) => (
                <li key={i} className="space-y-1 px-5 py-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm font-semibold">{r.reviewerName}</div>
                    <Stars value={r.stars} size={14} />
                  </div>
                  {r.comment && (
                    <p className="text-sm text-ink-700 whitespace-pre-line">{r.comment}</p>
                  )}
                  <div className="text-xs text-ink-500">
                    {new Date(r.createdAt).toLocaleDateString("pt-PT", {
                      day: "2-digit",
                      month: "long",
                      year: "numeric",
                    })}
                  </div>
                </li>
              ))
            )}
          </ul>
        </div>
      </div>
    </>
  );
}

function Stars({ value, size = 16 }: { value: number; size?: number }) {
  // Mostra 5 estrelas com fill proporcional a `value` (0–5).
  const full = Math.floor(value);
  const hasHalf = value - full >= 0.25 && value - full < 0.75;
  const fullCount = hasHalf ? full : Math.round(value);
  return (
    <span className="inline-flex items-center gap-0.5">
      {[0, 1, 2, 3, 4].map((i) => (
        <Star
          key={i}
          size={size}
          className={
            i < fullCount
              ? "fill-gold-400 text-gold-400"
              : i === fullCount && hasHalf
                ? "fill-gold-400 text-gold-400 opacity-60"
                : "text-ink-900/25"
          }
        />
      ))}
    </span>
  );
}
