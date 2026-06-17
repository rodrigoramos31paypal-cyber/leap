"use client";

// ════════════════════════════════════════════════════════════════
// Client wrapper · carrega BookingDialog + RescheduleDialog em
// lazy/no-SSR sem violar a regra do Next 16.
//
// Next 16 deixou de permitir `next/dynamic({ ssr: false })` em
// Server Components (o build falha com "ssr: false is not allowed
// with next/dynamic in Server Components"). Movemos o `dynamic()`
// para este Client Component dedicado para preservar o ganho de
// PERF original (QW-11 audit jun/2026): os bundles destes diálogos
// (BookingDialog ~842 LOC + RescheduleDialog ~195 LOC) saem do
// caminho crítico do /admin/agenda — só carregam quando o
// utilizador interage. Cap ~25 KB minified.
//
// API mantida: a page passa as mesmas props que passava ao
// BookingDialog directamente. RescheduleDialog não tem props.
// ════════════════════════════════════════════════════════════════
import dynamic from "next/dynamic";

type PackLite = { id: string; name: string; sessions: number; price_cents: number };

const BookingDialog = dynamic(
  () => import("./booking-dialog").then((m) => m.BookingDialog),
  { ssr: false },
);

const RescheduleDialog = dynamic(
  () => import("./reschedule-dialog").then((m) => m.RescheduleDialog),
  { ssr: false },
);

export function AgendaDialogs({
  trainerId,
  durations,
  defaultDuration,
  viewedDate,
  packs,
}: {
  trainerId: string;
  durations: number[];
  defaultDuration: number;
  viewedDate: string;
  packs: PackLite[];
}) {
  return (
    <>
      <BookingDialog
        trainerId={trainerId}
        durations={durations}
        defaultDuration={defaultDuration}
        viewedDate={viewedDate}
        packs={packs}
        hideTrigger
      />
      <RescheduleDialog />
    </>
  );
}
