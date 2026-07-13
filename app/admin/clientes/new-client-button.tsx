"use client";

// ════════════════════════════════════════════════════════════════
// NewClientButton · botão "Novo cliente" + modal para criar um cliente
// directamente da lista de Clientes (staff/admin/owner/trainer). Reusa o
// estilo do BookingDialog. Em sucesso, navega para a ficha do novo cliente.
// ════════════════════════════════════════════════════════════════
import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UserPlus, X } from "lucide-react";
import { createClientAction } from "./new-client-action";

export function NewClientButton() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const nameRef = useRef<HTMLInputElement>(null);

  function reset() {
    setName("");
    setEmail("");
    setPhone("");
    setError(null);
  }

  // Foca o nome ao abrir.
  useEffect(() => {
    if (open) {
      const id = window.setTimeout(() => nameRef.current?.focus(), 50);
      return () => window.clearTimeout(id);
    }
  }, [open]);

  function submit() {
    if (!name.trim()) {
      setError("Indica o nome do cliente.");
      return;
    }
    setError(null);
    const fd = new FormData();
    fd.set("new_name", name);
    fd.set("new_email", email);
    fd.set("new_phone", phone);
    startTransition(async () => {
      const res = await createClientAction(fd);
      if (res?.error) {
        setError(res.error);
        return;
      }
      setOpen(false);
      reset();
      if (res?.clientId) {
        router.push(`/admin/clientes/${res.clientId}`);
      } else {
        router.refresh();
      }
    });
  }

  return (
    <>
      <button
        type="button"
        onClick={() => {
          reset();
          setOpen(true);
        }}
        className="btn-primary inline-flex items-center gap-1.5 whitespace-nowrap"
      >
        <UserPlus size={16} /> Novo cliente
      </button>

      {open && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-ink-900/40 p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setOpen(false);
          }}
        >
          <div className="max-h-[92vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-5 shadow-xl dark:bg-ink-800">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-display text-lg font-bold">Novo cliente</h2>
              <button
                type="button"
                onClick={() => setOpen(false)}
                className="rounded p-1 text-ink-500 hover:bg-ink-900/5"
                aria-label="Fechar"
              >
                <X size={18} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="label" htmlFor="nc_name">Nome *</label>
                <input
                  id="nc_name"
                  ref={nameRef}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      submit();
                    }
                  }}
                  placeholder="Nome do cliente"
                  className="input"
                />
              </div>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div>
                  <label className="label" htmlFor="nc_email">Email (opcional)</label>
                  <input
                    id="nc_email"
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="email@exemplo.pt"
                    className="input"
                  />
                </div>
                <div>
                  <label className="label" htmlFor="nc_phone">Telefone (opcional)</label>
                  <input
                    id="nc_phone"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="9xx xxx xxx"
                    className="input"
                  />
                </div>
              </div>
              <p className="inline-flex items-start gap-1.5 text-[11px] text-ink-500">
                <UserPlus size={12} className="mt-0.5 shrink-0" />
                O cliente é criado sem necessidade de login. Podes enviar-lhe acesso mais tarde.
              </p>

              {error && (
                <p className="rounded-lg bg-red-500/10 px-3 py-2 text-sm text-red-600 dark:text-red-400">
                  {error}
                </p>
              )}

              <div className="flex items-center justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  className="btn-ghost"
                  disabled={pending}
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={submit}
                  className="btn-primary inline-flex items-center gap-1.5"
                  disabled={pending}
                >
                  <UserPlus size={16} /> {pending ? "A criar…" : "Criar cliente"}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
