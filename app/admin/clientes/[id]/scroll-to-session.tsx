"use client";

import { useEffect } from "react";

/**
 * Faz scroll até à sessão alvo de um deep-link (?session=<booking>) no
 * perfil do cliente — p.ex. sessão cancelada com nota do cliente.
 */
export function ScrollToSession({ id }: { id: string }) {
  useEffect(() => {
    const el = document.getElementById(id);
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [id]);
  return null;
}
