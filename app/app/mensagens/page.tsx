import Link from "next/link";
import { chatContext } from "@/lib/chat";
import { ChatThread } from "@/components/chat-thread";

export default async function ClientMessages({ searchParams }: {
  searchParams: Promise<{ treino?: string; antes?: string }>;
}) {
  const [context, params] = await Promise.all([chatContext(), searchParams]);
  return (
    <div className="space-y-4">
      <Link href="/app/dashboard" className="text-sm font-semibold text-gold-700 dark:text-gold-300">← Início</Link>
      <h1 className="font-display text-2xl font-bold">Mensagens</h1>
      {context ? <ChatThread context={context} bookingId={params.treino} before={params.antes} /> :
        <p className="card p-4 text-sm">A conversa fica disponível assim que tiveres um treinador associado.</p>}
    </div>
  );
}
