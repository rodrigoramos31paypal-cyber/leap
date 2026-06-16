"use client";

import { useState, useTransition } from "react";
import { Shield, Copy, Check } from "lucide-react";
import { startEnrollAction, confirmEnrollAction } from "./actions";

type Enrolling = { factorId: string; qrCode: string; secret: string } | null;

export function EnrollCard({ returnTo }: { returnTo?: string }) {
  const [enrolling, setEnrolling] = useState<Enrolling>(null);
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [pending, start] = useTransition();

  function startSetup() {
    setError(null);
    if (!password) {
      setError("Confirma a tua password para activar a 2FA.");
      return;
    }
    const fd = new FormData();
    fd.set("password", password);
    start(async () => {
      const res = await startEnrollAction(fd);
      if ("error" in res) {
        setError(res.error!);
        return;
      }
      setPassword("");
      setEnrolling({
        factorId: res.factorId!,
        qrCode: res.qrCode!,
        secret: res.secret!,
      });
    });
  }

  if (!enrolling) {
    return (
      <div className="card space-y-3 p-5">
        <div className="flex items-start gap-3">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-lg bg-bone-100 text-ink-700">
            <Shield size={18} />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Verificação em dois passos (2FA)</div>
            <div className="text-xs text-ink-500">
              Adiciona uma camada extra de segurança. Vais precisar de um app de
              autenticação (Google Authenticator, Authy, 1Password…).
            </div>
          </div>
        </div>
        <div>
          <label htmlFor="enroll-password" className="label">
            Confirma a tua password
          </label>
          <input
            id="enroll-password"
            type="password"
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="input"
            placeholder="Password da conta"
          />
          <p className="mt-1 text-xs text-ink-500">
            Por segurança, confirmamos a tua password antes de activar a 2FA.
          </p>
        </div>
        {error && <div className="rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>}
        <button onClick={startSetup} disabled={pending || !password} className="btn-gold w-full">
          {pending ? "A configurar…" : "Activar 2FA"}
        </button>
      </div>
    );
  }

  return (
    <form action={confirmEnrollAction} className="card space-y-4 p-5">
      <input type="hidden" name="factorId" value={enrolling.factorId} />
      {returnTo && <input type="hidden" name="returnTo" value={returnTo} />}
      <div>
        <div className="text-sm font-semibold">Configurar 2FA</div>
        <ol className="mt-2 list-decimal space-y-1 pl-5 text-xs text-ink-600">
          <li>Abre o app de autenticação no telemóvel.</li>
          <li>Lê o QR code abaixo (ou insere o secret manualmente).</li>
          <li>Cola o código de 6 dígitos que aparece e confirma.</li>
        </ol>
      </div>

      <div className="rounded-lg border border-ink-900/10 bg-white p-3">
        <div
          className="mx-auto h-48 w-48"
          dangerouslySetInnerHTML={{ __html: extractSvg(enrolling.qrCode) }}
        />
      </div>

      <div>
        <div className="label">Ou cola o secret manualmente</div>
        <div className="flex items-center gap-2 rounded-lg border border-ink-900/10 bg-bone-50 px-3 py-2">
          <code className="flex-1 break-all text-xs tabular-nums">{enrolling.secret}</code>
          <button
            type="button"
            onClick={async () => {
              await navigator.clipboard.writeText(enrolling.secret);
              setCopied(true);
              setTimeout(() => setCopied(false), 2000);
            }}
            className="shrink-0 rounded-md p-1.5 hover:bg-bone-100"
            aria-label="Copiar secret"
          >
            {copied ? <Check size={14} className="text-emerald-600" /> : <Copy size={14} />}
          </button>
        </div>
      </div>

      <div>
        <label htmlFor="code" className="label">
          Código de 6 dígitos
        </label>
        <input
          id="code"
          name="code"
          inputMode="numeric"
          pattern="[0-9]{6}"
          maxLength={6}
          required
          autoFocus
          autoComplete="one-time-code"
          className="input tracking-[0.5em] text-center font-mono text-xl"
          placeholder="000000"
        />
      </div>

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setEnrolling(null)}
          className="btn-outline flex-1"
        >
          Cancelar
        </button>
        <button type="submit" className="btn-gold flex-1">
          Activar
        </button>
      </div>
    </form>
  );
}

function extractSvg(src: string): string {
  if (src.startsWith("<svg")) return src;
  if (src.startsWith("data:image/svg+xml")) {
    const comma = src.indexOf(",");
    if (comma > 0) {
      const data = src.slice(comma + 1);
      try {
        return decodeURIComponent(data);
      } catch {
        return atob(data);
      }
    }
  }
  return `<img src="${src}" alt="QR code 2FA" class="h-48 w-48" />`;
}
