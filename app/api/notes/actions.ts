"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export async function createGeneralNoteAction(formData: FormData): Promise<{ error?: string; ok?: true } | void> {
  const subjectId = String(formData.get("subjectId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 5000);
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (!subjectId || !body) return { error: "Preenche a nota." };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase
    .from("session_notes")
    .insert({ subject_id: subjectId, author_id: user.id, body });
  if (error) return { error: error.message };

  revalidatePath("/app/notas");
  revalidatePath("/admin/notas");
  if (redirectTo) redirect(redirectTo);
}

export async function createBookingNoteAction(formData: FormData): Promise<{ error?: string; ok?: true } | void> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 5000);
  const redirectTo = String(formData.get("redirectTo") ?? "");
  if (!bookingId || !body) return { error: "Preenche a nota." };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  // delete-then-insert (Supabase upsert não suporta partial unique index)
  await supabase
    .from("session_notes")
    .delete()
    .eq("booking_id", bookingId)
    .eq("author_id", user.id);

  const { error } = await supabase
    .from("session_notes")
    .insert({ booking_id: bookingId, author_id: user.id, body });
  if (error) return { error: error.message };

  revalidatePath("/app/notas");
  revalidatePath("/admin/notas");
  revalidatePath("/app/historico");
  revalidatePath("/admin/agenda");
  if (redirectTo) redirect(redirectTo);
}

export async function updateNoteByIdAction(formData: FormData): Promise<{ error?: string; ok?: true } | void> {
  const noteId = String(formData.get("noteId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 5000);
  if (!noteId || !body) return { error: "Preenche a nota." };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  const { error } = await supabase
    .from("session_notes")
    .update({ body })
    .eq("id", noteId)
    .eq("author_id", user.id);
  if (error) return { error: error.message };

  revalidatePath("/app/notas");
  revalidatePath("/admin/notas");
  revalidatePath("/app/historico");
  revalidatePath("/admin/agenda");
}

export async function deleteNoteByIdAction(formData: FormData) {
  const noteId = String(formData.get("noteId") ?? "");
  if (!noteId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("session_notes")
    .delete()
    .eq("id", noteId)
    .eq("author_id", user.id);
  revalidatePath("/app/notas");
  revalidatePath("/admin/notas");
  revalidatePath("/app/historico");
  revalidatePath("/admin/agenda");
}

export async function upsertNoteAction(formData: FormData): Promise<{ error?: string; ok?: true }> {
  const bookingId = String(formData.get("bookingId") ?? "");
  const body = String(formData.get("body") ?? "").trim().slice(0, 5000);
  if (!bookingId) return { error: "Sessão não encontrada." };

  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { error: "Não autenticado." };

  // Substituímos sempre por delete + insert (Supabase upsert não funciona com partial unique index)
  await supabase
    .from("session_notes")
    .delete()
    .eq("booking_id", bookingId)
    .eq("author_id", user.id);

  if (body) {
    const { error } = await supabase
      .from("session_notes")
      .insert({ booking_id: bookingId, author_id: user.id, body });
    if (error) return { error: error.message };
  }

  revalidatePath("/app/historico");
  revalidatePath("/app/notas");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/notas");
  return { ok: true };
}

export async function deleteNoteAction(formData: FormData) {
  const bookingId = String(formData.get("bookingId") ?? "");
  if (!bookingId) return;
  const supabase = createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return;
  await supabase
    .from("session_notes")
    .delete()
    .eq("booking_id", bookingId)
    .eq("author_id", user.id);
  revalidatePath("/app/historico");
  revalidatePath("/app/notas");
  revalidatePath("/admin/agenda");
  revalidatePath("/admin/notas");
}
