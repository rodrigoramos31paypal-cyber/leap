import "server-only";
import { createAdminClient } from "@/lib/supabase/server";
import { emailEnabled, emailTemplates, sendEmail } from "@/lib/email";

export async function dispatchProspectEmails(id?: string): Promise<"sent" | "queued"> {
  const db = createAdminClient() as any;
  if (!emailEnabled()) {
    await db.rpc("leap_prospect_claim_emails", { p_id: null, p_limit: 0 });
    return "queued";
  }
  const { data: events, error } = await db.rpc("leap_prospect_claim_emails", { p_id: id ?? null, p_limit: id ? 1 : 3 });
  if (error) return "queued";
  await Promise.all((events ?? []).map(async (event: {
    id: string; recipient: string; body: string | null; href: string | null; kind: string; lease_token: string;
  }) => {
    const template = event.kind === "account_removed" ? emailTemplates.prospectAccountRemoved()
      : emailTemplates.prospectInvitation({ body: event.body ?? "", href: event.href ?? "/login", continuation: event.kind === "continuation" });
    // Identical retries retain the same provider key; retries stop before its 24h lifetime.
    const result = await sendEmail({ to: event.recipient, ...template, idempotencyKey: `leap-prospect/${event.id}`, timeoutMs: 8000 });
    await db.rpc("leap_prospect_finish_email", { p_id: event.id, p_lease: event.lease_token, p_sent: result.ok });
  }));
  if (!id) return "queued";
  const { data: event } = await db.from("leap_prospect_emails").select("status").eq("id", id).maybeSingle();
  return event?.status === "sent" ? "sent" : "queued";
}
