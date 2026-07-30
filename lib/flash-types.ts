// ════════════════════════════════════════════════════════════════
// Tipos partilhados entre server actions (que escrevem cookies)
// e o Toaster client (que apenas lê a forma). Mantém este ficheiro
// SEM imports de server-only APIs (`next/headers`) — pode ser
// importado por client components em segurança.
// ════════════════════════════════════════════════════════════════

export type FlashKind = "success" | "error" | "info";

export type Flash = {
  title: string;
  body?: string;
  kind: FlashKind;
};
