import { redirect } from "next/navigation";

export default async function NewClientNotePage({ searchParams }: {
  searchParams: Promise<{ booking?: string }>;
}) {
  const { booking } = await searchParams;
  redirect(booking ? `/app/mensagens?treino=${encodeURIComponent(booking)}` : "/app/mensagens");
}
