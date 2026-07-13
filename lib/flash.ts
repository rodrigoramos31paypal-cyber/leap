// ════════════════════════════════════════════════════════════════
// Flash messages · cookie de uma única utilização para mostrar
// toasts depois de server actions.
//
// Server action: setFlash("Sessões atribuídas", "success")
// Layout (RSC):  const flash = consumeFlash() — lê e apaga
//
// NOTA: os tipos (`Flash`, `FlashKind`) vivem em `lib/flash-types.ts`
// para que client components possam importar a forma sem trazer
// `next/headers` para o bundle do browser (webpack quebrava).
// ════════════════════════════════════════════════════════════════
import { cookies } from "next/headers";
import type { Flash, FlashKind } from "./flash-types";

export type { Flash, FlashKind } from "./flash-types";

const COOKIE_NAME = "leap_flash";

export async function setFlash(title: string, kind: FlashKind = "success", body?: string) {
  try {
    const payload: Flash = { title, kind, ...(body ? { body } : {}) };
    (await cookies()).set(COOKIE_NAME, encodeURIComponent(JSON.stringify(payload)), {
      // muito curto — só sobrevive ao próximo render do layout
      maxAge: 30,
      path: "/",
      sameSite: "lax",
      httpOnly: false,
    });
  } catch {
    // ignora se chamado fora de contexto que permite setar cookies
  }
}

export async function consumeFlash(): Promise<Flash | null> {
  try {
    const store = await cookies();
    const c = store.get(COOKIE_NAME);
    if (!c?.value) return null;
    let parsed: Flash | null = null;
    try {
      parsed = JSON.parse(decodeURIComponent(c.value)) as Flash;
    } catch {
      parsed = null;
    }
    // apaga já — só queremos mostrar uma vez
    store.set(COOKIE_NAME, "", { maxAge: 0, path: "/" });
    return parsed;
  } catch {
    return null;
  }
}
