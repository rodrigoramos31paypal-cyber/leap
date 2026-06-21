"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Link2, Link2Off, Users } from "lucide-react";
import { linkDuoAction, unlinkDuoAction } from "./actions";

// Toast imediato (mesmo padrão do GrantPackForm): a server action via
// set-flash só apareceria na próxima navegação completa.
function clientToast(title: string, kind: "success" | "error" | "info" = "success") {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("leap:toast", { detail: { title, kind } }));
}

export type DuoPartner = { id: string; full_name: string; email: string };

export function DuoLinkSection({
  clientId,
  partner,
}: {
  clientId: string;
  partner: DuoPartner | null;
}) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [pending, startTransition] = useTransition();

  function onLink(formData: FormData) {
    formData.set("clientId", clientId);
    const e = String(formData.get("partnerEmail") ?? "").trim();
    if (!e) {
      clientToast("Indica o email da conta a ligar", "error");
      return;
    }
    startTransition(async () => {
      await linkDuoAction(formData);
      setEmail("");
      router.refresh();
    });
  }

  function onUnlink() {
    const fd = new FormData();
    fd.set("clientId", clientId);
    startTransition(async () => {
      await unlinkDuoAction(fd);
      router.refresh();
    });
  }

  return (
    <details className="card p-5">
      <summary className="flex cursor-pointer items-center gap-2 text-sm font-semibold uppercase tracking-wide text-ink-500">
        <Users size={16} /> Par Duo
      </summary>

      <p className="mt-3 text-xs text-ink-500">
        Liga esta conta a outra. Depois de ligadas, sempre que um dos dois marcar
        uma sessão ela conta como sessão dupla: desconta 1 sessão a cada conta e
        aparece no calendário de ambos.
      </p>

      {partner ? (
        <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-gold-200 bg-gold-50 p-3 dark:border-gold-400/30 dark:bg-gold-400/10">
          <div className="flex items-center gap-2 text-sm">
            <Link2 size={16} className="text-gold-700" />
            <div>
              <div className="font-semibold">Ligada a {partner.full_name}</div>
              <div className="text-xs text-ink-500">{partner.email}</div>
            </div>
          </div>
          <button
            type="button"
            onClick={onUnlink}
            disabled={pending}
            className="btn-outline inline-flex items-center gap-1.5 border-red-200 text-xs text-red-700 hover:bg-red-50"
          >
            <Link2Off size={12} /> {pending ? "A desligar…" : "Desligar"}
          </button>
        </div>
      ) : (
        <form action={onLink} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="clientId" value={clientId} />
          <div className="grow sm:max-w-xs">
            <label className="label">Email da conta a ligar</label>
            <input
              name="partnerEmail"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="input"
              placeholder="cliente@exemplo.pt"
            />
          </div>
          <button className="btn-primary inline-flex items-center gap-1.5" disabled={pending}>
            <Link2 size={14} /> {pending ? "A ligar…" : "Ligar contas"}
          </button>
        </form>
      )}
    </details>
  );
}
