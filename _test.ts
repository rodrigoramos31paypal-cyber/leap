import { notFound } from "next/navigation";

async function f() {
  const profile: { id: string } | null = null as any;
  if (!profile) notFound();
  console.log(profile.id);
}
