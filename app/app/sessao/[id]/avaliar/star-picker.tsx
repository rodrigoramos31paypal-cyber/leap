"use client";

import { useState } from "react";
import { Star } from "lucide-react";

// Selector de 1-5 estrelas controlado. Guarda a escolha num input
// hidden "stars" para o form submeter via action server-side.
export function StarPicker({ initial = 0 }: { initial?: number }) {
  const [value, setValue] = useState<number>(initial);
  const [hover, setHover] = useState<number>(0);
  const display = hover || value;

  return (
    <div className="flex items-center gap-1.5">
      <input type="hidden" name="stars" value={value} />
      {[1, 2, 3, 4, 5].map((n) => {
        const active = n <= display;
        return (
          <button
            key={n}
            type="button"
            aria-label={`${n} ${n === 1 ? "estrela" : "estrelas"}`}
            onClick={() => setValue(n)}
            onMouseEnter={() => setHover(n)}
            onMouseLeave={() => setHover(0)}
            className="rounded p-1 transition hover:scale-110"
          >
            <Star
              size={32}
              className={active ? "fill-gold-400 text-gold-400" : "text-ink-900/30"}
            />
          </button>
        );
      })}
      <span className="ml-3 text-sm font-medium text-ink-600">
        {value > 0 ? `${value}/5` : "Toca para avaliar"}
      </span>
    </div>
  );
}
