import Link from "next/link";
import { CheckCircle2, Clock, MessageCircle, LockKeyhole } from "lucide-react";
import type { Enrollment } from "@/lib/enrollment-options";
import { EnrollmentSummary } from "./summary";
export function EnrollmentStatus({ request }: { request: Enrollment }) {
 return <div className="space-y-4">
  <div className="flex items-center gap-2 text-sm font-semibold text-gold-700 dark:text-gold-300"><CheckCircle2 size={19} /> Pré-inscrição enviada</div>
  <h1 className="font-display text-xl font-bold">Vamos falar sobre o teu treino</h1>
  <p className="text-sm text-ink-500">A equipa vai analisar as tuas respostas. Podes falar com o PT aqui enquanto aguardas.</p>
  <div className="flex items-center gap-2 rounded-xl bg-gold-400/10 p-3 text-sm"><Clock size={18} className="shrink-0 text-gold-600" /> A aguardar aprovação da equipa</div>
  <EnrollmentSummary request={request} />
  <Link href="/aprovacao-pendente?chat=1" className="btn-primary flex w-full items-center justify-center gap-2"><MessageCircle size={18} /> Falar com o PT</Link>
  <Link href="/aprovacao-pendente?editar=1" className="block text-center text-xs font-semibold underline underline-offset-4">Editar respostas</Link>
  <p className="flex items-start gap-2 text-xs text-ink-500"><LockKeyhole size={15} className="shrink-0" /> O acesso às restantes áreas da app fica disponível após aprovação.</p>
 </div>;
}
