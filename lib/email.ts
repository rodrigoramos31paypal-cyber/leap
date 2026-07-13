// ════════════════════════════════════════════════════════════════
// Email dispatcher · Resend
// ════════════════════════════════════════════════════════════════
// Liga via NOTIFICATIONS_EMAIL_ENABLED + RESEND_API_KEY no .env.local.
// Se não configurado, sendEmail() é no-op (loga e segue).
import { EMAIL_LOGO_BASE64, EMAIL_LOGO_CID, EMAIL_LOGO_FILENAME } from "@/lib/email-logo";

type Attachment = {
  filename: string;
  content: string; // base64
  content_id?: string; // imagens inline → referência via cid:content_id no HTML
  content_type?: string;
};

type SendArgs = {
  to: string;
  subject: string;
  html: string;
  text?: string;
  replyTo?: string;
};

export function emailEnabled(): boolean {
  return (
    process.env.NOTIFICATIONS_EMAIL_ENABLED === "true" &&
    !!process.env.RESEND_API_KEY
  );
}

export async function sendEmail(args: SendArgs): Promise<{ ok: boolean; error?: string }> {
  if (!emailEnabled()) {
    if (process.env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.log("[email] skipped (disabled):", args.subject, "→", args.to);
    }
    return { ok: false, error: "disabled" };
  }

  const from = process.env.NOTIFICATION_FROM_EMAIL ?? "no-reply@leapfitnesstudio.com";

  // Logo embebido como anexo INLINE (CID). Viaja dentro do email, por isso
  // não há fetch remoto → os clientes (Apple Mail, Gmail, Outlook) deixam de
  // bloquear a imagem e de mostrar "Download Images". O HTML referencia-o via
  // src="cid:leap-logo" (ver shell()).
  const attachments: Attachment[] = [
    {
      filename: EMAIL_LOGO_FILENAME,
      content: EMAIL_LOGO_BASE64,
      content_id: EMAIL_LOGO_CID,
      content_type: "image/png",
    },
  ];

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
        reply_to: args.replyTo,
        attachments,
      }),
    });

    if (!res.ok) {
      const body = await res.text();
      return { ok: false, error: `${res.status} ${body}` };
    }
    return { ok: true };
  } catch (err: any) {
    return { ok: false, error: err?.message ?? "fetch_failed" };
  }
}

// ─── Templates ───────────────────────────────────────────────────────

// URL base usada para links/CTAs nos emails.
const EMAIL_APP_URL = (process.env.NEXT_PUBLIC_APP_URL ?? "https://leapfitnesstudio.com").replace(/\/$/, "");
// Logo dos emails: referência ao anexo INLINE (CID), embebido por sendEmail.
// O PNG tem o BADGE CLARO OPACO cozido, por isso fica sempre visível em light
// e dark mode (clientes em dark mode só recolorem fundo/texto CSS, nunca
// imagens). Como é inline, não há fetch remoto → sem "Download Images".
const LOGO_SRC = `cid:${EMAIL_LOGO_CID}`;
// Marca: nome canónico em "Title Case". NÃO usamos NEXT_PUBLIC_APP_NAME
// aqui — historicamente esse env veio como "LEAP-FITNESS STUDIO" e
// poluía o cabeçalho. Mantém-se hardcoded para garantir consistência.
const BRAND_NAME = "LEAP Fitness Studio";

function shell(title: string, body: string, cta?: { label: string; href: string }) {
  // Botão CTA opcional. Renderizado como bulletproof button (table-based)
  // para Outlook e clientes mais antigos.
  const ctaHtml = cta
    ? `<table cellpadding="0" cellspacing="0" border="0" style="margin:8px 0 4px"><tr><td style="border-radius:10px;background:#caa14a">
         <a href="${escapeHtml(cta.href)}" style="display:inline-block;padding:13px 28px;font-size:15px;font-weight:600;color:#1a1a1a;text-decoration:none;border-radius:10px">
           ${escapeHtml(cta.label)}
         </a>
       </td></tr></table>`
    : "";

  return `<!doctype html>
<html><body style="margin:0;padding:0;background:#faf8f4;font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Helvetica,Arial,sans-serif;color:#1a1a1a">
<table width="100%" cellpadding="0" cellspacing="0" style="padding:32px 16px;background:#faf8f4">
  <tr><td align="center">
    <table width="560" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border:1px solid #ece8de;border-radius:16px;overflow:hidden;box-shadow:0 1px 2px rgba(26,26,26,0.04)">
      <tr><td align="center" style="padding:28px 28px 8px;background:#ffffff">
        <img src="${LOGO_SRC}" alt="${escapeHtml(BRAND_NAME)}" width="56" height="56" style="display:block;width:56px;height:56px;border:0;outline:none;text-decoration:none" />
        <div style="margin-top:10px;font-weight:700;font-size:13px;letter-spacing:.08em;color:#1a1a1a;text-transform:uppercase">${escapeHtml(BRAND_NAME)}</div>
      </td></tr>
      <tr><td style="padding:8px 36px 4px"><div style="height:1px;background:#f1ede4;line-height:1px;font-size:0">&nbsp;</div></td></tr>
      <tr><td style="padding:24px 36px 32px">
        <h1 style="margin:0 0 14px;font-size:22px;font-weight:800;line-height:1.25;color:#1a1a1a">${escapeHtml(title)}</h1>
        <div style="font-size:15px;line-height:1.6;color:#3a3a3a">${body}</div>
        ${ctaHtml}
      </td></tr>
      <tr><td style="padding:18px 36px;background:#faf8f4;color:#7a7466;font-size:11px;line-height:1.6;border-top:1px solid #f1ede4">
        ${escapeHtml(BRAND_NAME)} · este é um email automático. Se tiveres dúvidas responde a esta mensagem.
      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c] as string));
}

export const emailTemplates = {
  bookingCreated(args: { clientName: string; when: string; type: string }) {
    return {
      subject: "Sessão marcada",
      html: shell(
        "Sessão marcada",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">A tua sessão <strong>${escapeHtml(args.type)}</strong> ficou marcada para <strong>${escapeHtml(args.when)}</strong>.</p>
         <p style="margin:0 0 0">Vê as tuas sessões e próximas marcações no portal.</p>`,
      ),
      text: `Sessão marcada para ${args.when} (${args.type}).`,
    };
  },
  bookingCancelled(args: { clientName: string; when: string; refunded: boolean }) {
    return {
      subject: "Sessão cancelada",
      html: shell(
        "Sessão cancelada",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">A tua sessão de <strong>${escapeHtml(args.when)}</strong> foi cancelada.</p>
         <p style="margin:0">${args.refunded ? "A sessão foi devolvida ao teu saldo." : "Por cancelamento tardio, a sessão não foi devolvida."}</p>`,
      ),
      text: `Sessão de ${args.when} cancelada. ${args.refunded ? "Sessão devolvida." : "Sem devolução."}`,
    };
  },
  bookingConfirmed(args: { clientName: string; when: string }) {
    return {
      subject: "Presença confirmada",
      html: shell(
        "Presença confirmada",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0">A tua sessão de <strong>${escapeHtml(args.when)}</strong> foi confirmada pelo trainer. Bom trabalho!</p>`,
      ),
      text: `Sessão de ${args.when} confirmada.`,
    };
  },
  purchaseConfirmed(args: { clientName: string; packName: string; sessions: number }) {
    // CTA removido: o iOS não permite abrir a PWA instalada a partir de um link
    // de email (sem URL scheme/Universal Links para PWAs); o link só abria o
    // browser e exigia novo login. O texto remete para o portal.
    return {
      subject: "Pack ativo",
      html: shell(
        "Pack ativo",
        `<p style="margin:0 0 12px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 12px">O teu pack <strong>${escapeHtml(args.packName)}</strong> foi ativado.</p>
         <p style="margin:0 0 18px">Tens <strong>${args.sessions} ${args.sessions === 1 ? "sessão" : "sessões"}</strong> disponíveis para marcar no portal.</p>`,
      ),
      text: `${args.packName} ativo (${args.sessions} sessões). Marca em ${EMAIL_APP_URL}/app/agenda`,
    };
  },
  adminBookingCreated(args: { clientName: string; when: string; type: string }) {
    return {
      subject: "Nova marcação",
      html: shell(
        "Nova marcação no portal",
        `<p style="margin:0 0 10px">${escapeHtml(args.clientName)} marcou uma sessão <strong>${escapeHtml(args.type)}</strong>.</p>
         <p style="margin:0">Horário: <strong>${escapeHtml(args.when)}</strong></p>`,
      ),
      text: `${args.clientName} marcou ${args.type} para ${args.when}.`,
    };
  },
  adminPurchasePending(args: { clientName: string; packName: string; amountEur: string }) {
    return {
      subject: "Pagamento pendente",
      html: shell(
        "Pagamento pendente de confirmação",
        `<p style="margin:0 0 10px">${escapeHtml(args.clientName)} iniciou a compra <strong>${escapeHtml(args.packName)}</strong> (${escapeHtml(args.amountEur)}).</p>
         <p style="margin:0">Confirma o recebimento em /admin/pagamentos.</p>`,
      ),
      text: `${args.clientName} → ${args.packName} (${args.amountEur}). Confirmar em /admin/pagamentos.`,
    };
  },
  sessionReminder(args: { clientName: string; when: string }) {
    return {
      subject: "Lembrete de sessão",
      html: shell(
        "Lembrete de sessão",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">Este é um lembrete da tua sessão marcada para <strong>${escapeHtml(args.when)}</strong>.</p>
         <p style="margin:0">Até já! Se precisares de cancelar, fá-lo com antecedência no portal.</p>`,
      ),
      text: `Lembrete: sessão a ${args.when}.`,
    };
  },
  sessionReminderTrainer(args: { trainerName: string; clientName: string; when: string }) {
    return {
      subject: "Lembrete de sessão",
      html: shell(
        "Lembrete de sessão",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.trainerName)},</p>
         <p style="margin:0 0 10px">Lembrete: tens uma sessão com <strong>${escapeHtml(args.clientName)}</strong> a <strong>${escapeHtml(args.when)}</strong>.</p>`,
      ),
      text: `Lembrete: sessão com ${args.clientName} a ${args.when}.`,
    };
  },
  creditLow(args: { clientName: string; total: number }) {
    const out = args.total <= 0;
    return {
      subject: out ? "Ficaste sem sessões" : "Restam-te poucas sessões",
      html: shell(
        out ? "Ficaste sem sessões" : "Restam-te poucas sessões",
        out
          ? `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
             <p style="margin:0 0 10px">Já não tens sessões disponíveis. Para continuares a treinar, compra um novo pack.</p>`
          : `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
             <p style="margin:0 0 10px">Tens apenas <strong>${args.total}</strong> ${args.total === 1 ? "sessão" : "sessões"} por usar. Renova o teu pack para não interromperes o teu progresso.</p>`,
      ),
      text: out ? "Ficaste sem sessões. Compra um pack." : `Restam-te ${args.total} sessões.`,
    };
  },
  packExpiring(args: { clientName: string; remaining: number; when: string; packName: string }) {
    return {
      subject: "O teu pack está a expirar",
      html: shell(
        "O teu pack está a expirar",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">O teu pack <strong>${escapeHtml(args.packName)}</strong> expira a <strong>${escapeHtml(args.when)}</strong> e ainda tens <strong>${args.remaining}</strong> ${args.remaining === 1 ? "sessão" : "sessões"} por usar.</p>
         <p style="margin:0">Marca as tuas sessões antes que expirem.</p>`,
      ),
      text: `O teu pack ${args.packName} expira a ${args.when} (${args.remaining} por usar).`,
    };
  },
  ratingPrompt(args: { clientName: string; when: string; bookingId: string; appUrl: string }) {
    const link = `${args.appUrl.replace(/\/$/, "")}/app/sessao/${args.bookingId}/avaliar`;
    // SEC (S-08, audit jun/2026): defense-in-depth -- escapar `link` no
    // atributo href. Hoje appUrl vem de env e bookingId e UUID server-
    // gerado; o caso patologico (aspas no URL) so e possivel com env mal
    // configurada. Custo zero, fecha a janela.
    const linkAttr = escapeHtml(link);
    return {
      subject: "Como correu a tua sessão?",
      html: shell(
        "Como correu a tua sessão?",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">A tua sessão de <strong>${escapeHtml(args.when)}</strong> já terminou. Avalia em 10 segundos — ajuda-nos a melhorar.</p>
         <p style="margin:18px 0"><a href="${linkAttr}" style="display:inline-block;padding:10px 18px;background:#caa14a;color:#1a1a1a;border-radius:8px;text-decoration:none;font-weight:600">Avaliar sessão</a></p>
         <p style="margin:0;color:#666;font-size:13px">É opcional. Podes ignorar este email sem problema.</p>`,
      ),
      text: `Avalia a tua sessão de ${args.when}: ${link}`,
    };
  },
  clientNote(args: { trainerName: string; clientName: string; when: string }) {
    return {
      subject: "Nova nota de cliente",
      html: shell(
        "Nova nota de cliente",
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.trainerName)},</p>
         <p style="margin:0 0 10px"><strong>${escapeHtml(args.clientName)}</strong> deixou uma nota na sessão marcada para <strong>${escapeHtml(args.when)}</strong>.</p>
         <p style="margin:0">Vê a nota na agenda, no popover dessa sessão.</p>`,
      ),
      text: `${args.clientName} deixou uma nota na sessão de ${args.when}.`,
    };
  },
  adminBookingCancelled(args: { clientName: string; when: string }) {
    return {
      subject: "Cliente cancelou",
      html: shell(
        "Cliente cancelou uma sessão",
        `<p style="margin:0 0 10px"><strong>${escapeHtml(args.clientName)}</strong> cancelou a sessão de <strong>${escapeHtml(args.when)}</strong>.</p>
         <p style="margin:0">O horário ficou livre na tua agenda.</p>`,
      ),
      text: `${args.clientName} cancelou a sessão de ${args.when}.`,
    };
  },
  recurringBookingCreated(args: { clientName: string; type: string; sessions: string[] }) {
    const items = args.sessions.map((s) => `<li style="margin:0 0 4px">${escapeHtml(s)}</li>`).join("");
    return {
      subject: `${args.sessions.length} sessões marcadas`,
      html: shell(
        `${args.sessions.length} sessões marcadas`,
        `<p style="margin:0 0 10px">Olá ${escapeHtml(args.clientName)},</p>
         <p style="margin:0 0 10px">Ficaram marcadas <strong>${args.sessions.length} sessões ${escapeHtml(args.type)}</strong> nos seguintes horários:</p>
         <ul style="margin:0 0 10px;padding-left:18px">${items}</ul>
         <p style="margin:0">Vê todas as tuas marcações no portal.</p>`,
      ),
      text:
        `${args.sessions.length} sessões ${args.type} marcadas:\n` +
        args.sessions.map((s) => `- ${s}`).join("\n"),
    };
  },
  adminRecurringBookingCreated(args: { clientName: string; type: string; sessions: string[] }) {
    const items = args.sessions.map((s) => `<li style="margin:0 0 4px">${escapeHtml(s)}</li>`).join("");
    return {
      subject: `Nova marcação recorrente · ${args.sessions.length} sessões`,
      html: shell(
        "Nova marcação recorrente",
        `<p style="margin:0 0 10px"><strong>${escapeHtml(args.clientName)}</strong> marcou <strong>${args.sessions.length} sessões ${escapeHtml(args.type)}</strong>:</p>
         <ul style="margin:0 0 10px;padding-left:18px">${items}</ul>`,
      ),
      text:
        `${args.clientName} marcou ${args.sessions.length} sessões ${args.type}:\n` +
        args.sessions.map((s) => `- ${s}`).join("\n"),
    };
  },
};
