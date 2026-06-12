// ════════════════════════════════════════════════════════════════
// Security headers · CSP nonce-based (H2 do audit de segurança)
//
// Esta parte vive em middleware (e não em next.config.mjs) porque
// precisamos de gerar um nonce por request e injectá-lo na
// directiva `script-src` do CSP. Esse mesmo nonce é passado ao
// `app/layout.tsx` via header `x-nonce`, que o usa no `<script>`
// inline do registo do service worker.
//
// Estratégia adoptada — `'strict-dynamic'` + nonce:
//   • Apenas scripts com o nonce certo correm.
//   • Scripts carregados POR esses scripts (chunks do Next.js)
//     herdam confiança via `'strict-dynamic'`.
//   • Domínios na allowlist (Supabase, Upstash REST, IfthenPay)
//     vão na directiva `connect-src`, não na `script-src`.
//
// Sem nonce, a única alternativa era `'unsafe-inline'` em
// `script-src` — que torna o CSP cosmético.
// ════════════════════════════════════════════════════════════════

/**
 * Gera um nonce CSP edge-compatible: 16 bytes aleatórios em
 * base64. `crypto.getRandomValues` está disponível no Edge
 * runtime do Vercel sem importar nada.
 */
export function generateNonce(): string {
  const array = new Uint8Array(16);
  crypto.getRandomValues(array);
  // btoa funciona no Edge runtime
  return btoa(String.fromCharCode(...array));
}

/**
 * Constrói o header CSP completo dado o nonce. Mantém-se aqui
 * para que evoluir a política seja uma única edição.
 *
 * Decisões:
 *   • script-src · 'strict-dynamic' + nonce → bloqueia inline e
 *     scripts de origem desconhecida; deixa correr chunks
 *     carregados pelo Next.js.
 *   • style-src · 'unsafe-inline' é INFELIZMENTE necessário
 *     porque o Next 14 injecta styles inline para a hidratação
 *     do Tailwind (e o `nonce` não é propagado a todos eles).
 *     Mitigação: o vector de XSS via styles é muito mais limitado.
 *   • connect-src · só hosts que usamos legitimamente.
 *   • frame-ancestors · 'none' → equivalente a X-Frame-Options
 *     DENY mas reconhecido por mais browsers modernos.
 *   • form-action · 'self' → impede que um XSS futuro submeta
 *     forms para domínios externos.
 *   • upgrade-insecure-requests · força HTTPS em requests da
 *     página, redundância para HSTS.
 */
export function buildCsp(nonce: string): string {
  const directives: Record<string, string[]> = {
    "default-src": ["'self'"],
    "script-src": [
      "'self'",
      `'nonce-${nonce}'`,
      "'strict-dynamic'",
    ],
    "style-src": ["'self'", "'unsafe-inline'"],
    "img-src": ["'self'", "data:", "blob:"],
    "font-src": ["'self'", "data:"],
    "connect-src": [
      "'self'",
      // Supabase REST + Realtime (WebSocket)
      "https://*.supabase.co",
      "wss://*.supabase.co",
      // IfthenPay (caso evoluamos para chamadas client-side)
      "https://ifthenpay.com",
    ],
    "frame-ancestors": ["'none'"],
    "frame-src": ["'self'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "object-src": ["'none'"],
    "manifest-src": ["'self'"],
    "worker-src": ["'self'"],
  };

  const parts = Object.entries(directives).map(
    ([key, values]) => `${key} ${values.join(" ")}`,
  );
  // Directiva booleana — sem valores
  parts.push("upgrade-insecure-requests");

  return parts.join("; ");
}

/**
 * Aplica o CSP e o header `x-nonce` (para o layout consumir) a
 * uma resposta já construída pelo middleware. Mutates response
 * e devolve-a por conveniência.
 */
export function applyCsp(response: Response, nonce: string): Response {
  response.headers.set("Content-Security-Policy", buildCsp(nonce));
  response.headers.set("x-nonce", nonce);
  return response;
}
