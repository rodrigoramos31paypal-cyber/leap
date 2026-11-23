import type { Enrollment } from "@/lib/enrollment-options";
export function EnrollmentSummary({ request }: { request?: Enrollment | null }) {
  if (!request) return <p className="rounded-xl bg-ink-900/5 p-3 text-xs text-ink-500 dark:bg-white/5">Ainda não respondeu à pré-inscrição.</p>;
  return <dl className="grid gap-3 rounded-xl bg-ink-900/5 p-3 text-sm dark:bg-white/5">
    {[["Procura", request.interest], ["Objetivo", request.goal], ["Disponibilidade", request.availability]].map(([label, value]) => <div key={label}><dt className="text-xs text-ink-500">{label}</dt><dd className="mt-0.5 whitespace-pre-wrap break-words font-medium">{value}</dd></div>)}
  </dl>;
}
