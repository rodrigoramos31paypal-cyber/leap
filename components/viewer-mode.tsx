"use client";

// ════════════════════════════════════════════════════════════════
// Modo "só-de-consulta" (viewer).
//
// O papel `viewer` entra na área de admin e VÊ tudo, mas não pode
// escrever nada — o backend já recusa todas as escritas (server actions
// com requireStaff()/requireOwner(), RPCs com is_admin() e políticas RLS
// de escrita a exigir is_admin()). Isto aqui é só a camada de UI: esconde
// os controlos de escrita para que a área fique visualmente só-de-leitura
// e ninguém carregue num botão que, de qualquer forma, ia falhar.
//
// Uso:
//   • <ViewerModeProvider isViewer={...}> à volta da área de admin.
//   • const isViewer = useIsViewer()  →  esconder/desativar controlos.
//   • <HideFromViewer>…controlo de escrita…</HideFromViewer>  →  açúcar
//     sintático para não renderizar nada quando é viewer.
// ════════════════════════════════════════════════════════════════

import { createContext, useContext } from "react";

const ViewerModeContext = createContext<boolean>(false);

export function ViewerModeProvider({
  isViewer,
  children,
}: {
  isViewer: boolean;
  children: React.ReactNode;
}) {
  return (
    <ViewerModeContext.Provider value={isViewer}>{children}</ViewerModeContext.Provider>
  );
}

/** true quando o utilizador atual é um viewer (só-consulta). */
export function useIsViewer(): boolean {
  return useContext(ViewerModeContext);
}

/** Não renderiza os filhos quando o utilizador é viewer. */
export function HideFromViewer({ children }: { children: React.ReactNode }) {
  const isViewer = useIsViewer();
  if (isViewer) return null;
  return <>{children}</>;
}
