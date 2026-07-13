"use client";

// Botões de atalho para o formulário "Marcar-me indisponível".
// É um client component porque os listeners têm de funcionar
// também após navegação SPA (scripts inline não re-executam).

type Preset = { id: string; label: string; time: string; from: string; to: string };

const PRESETS: Preset[] = [
  { id: "morning", label: "Manhã", time: "08:00 – 12:00", from: "08:00", to: "12:00" },
  { id: "afternoon", label: "Tarde", time: "13:00 – 18:00", from: "13:00", to: "18:00" },
  { id: "evening", label: "Noite", time: "18:00 – 22:00", from: "18:00", to: "22:00" },
  { id: "day", label: "Dia inteiro", time: "07:00 – 22:00", from: "07:00", to: "22:00" },
];

export function BlockPresets({
  fromId,
  toId,
}: {
  fromId: string;
  toId: string;
}) {
  function apply(p: Preset, btn: HTMLButtonElement) {
    const from = document.getElementById(fromId) as HTMLSelectElement | null;
    const to = document.getElementById(toId) as HTMLSelectElement | null;
    if (from) from.value = p.from;
    if (to) to.value = p.to;
    // realce visual
    btn.parentElement
      ?.querySelectorAll<HTMLElement>("[data-preset-btn]")
      .forEach((el) => el.classList.remove("border-gold-400", "bg-gold-50"));
    btn.classList.add("border-gold-400", "bg-gold-50");
  }

  return (
    <div className="flex flex-wrap gap-2">
      {PRESETS.map((p) => (
        <button
          key={p.id}
          type="button"
          data-preset-btn
          onClick={(e) => apply(p, e.currentTarget)}
          className="inline-flex flex-col items-start gap-0.5 rounded-lg border border-ink-900/10 bg-white px-3 py-2 text-left text-xs transition hover:border-gold-400 hover:bg-gold-50"
        >
          <span className="font-semibold text-ink-900">{p.label}</span>
          <span className="text-[10px] text-ink-500 tabular-nums">{p.time}</span>
        </button>
      ))}
    </div>
  );
}
