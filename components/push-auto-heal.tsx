"use client";

import { useEffect } from "react";
import { healPushSubscription } from "@/lib/push-client";

// Sem UI. Montado no layout → corre em TODAS as páginas da app. A cada
// abertura repõe/renova a subscrição de push quando a permissão já está
// concedida. Rede de segurança para iOS, onde a subscrição morre sozinha
// e o `pushsubscriptionchange` pode não disparar.
export function PushAutoHeal() {
  useEffect(() => {
    void healPushSubscription();
  }, []);
  return null;
}
