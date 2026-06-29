/** @type {import('next').NextConfig} */
const supabaseHost = process.env.NEXT_PUBLIC_SUPABASE_URL
  ? new URL(process.env.NEXT_PUBLIC_SUPABASE_URL).hostname
  : undefined;

const nextConfig = {
  reactStrictMode: true,
  // Build self-contained para self-host (Coolify/Docker). Gera
  // `.next/standalone` com o server + um node_modules mínimo já traçado
  // — imagem final pequena e arranque rápido do container. Sem efeito no
  // `next dev`. O Dockerfile copia standalone + .next/static + public.
  output: "standalone",
  // H2 hardening: esconde `X-Powered-By: Next.js`. Information
  // disclosure trivial — diz ao atacante a stack e versão sem ele
  // ter de pedir. Zero custo a esconder.
  poweredByHeader: false,
  // PERF: serve modern formats from the Vercel image optimizer. AVIF is
  // opt-in (Next defaults to webp only); adding it shaves ~20-30% off the
  // logo lock-ups for supporting browsers. Pure delivery optimization —
  // next/image falls back to png/webp automatically when unsupported.
  images: {
    formats: ["image/avif", "image/webp"],
    // PERF (audit #4): autoriza o optimizer do Vercel a servir as imagens
    // do Supabase Storage (banners, fotos de produto, avatares) em
    // AVIF/WebP com resize/srcset. Sem este host, <Image> rejeitaria o URL.
    remotePatterns: supabaseHost
      ? [{ protocol: "https", hostname: supabaseHost, pathname: "/storage/v1/object/**" }]
      : [],
  },
  // Next 16 (jun/2026): a key `eslint` no next.config foi descontinuada —
  // ESLint passa a ser tarefa do CI/IDE, não do `next build`.
  //
  // M-2 (audit jun/2026): a antiga dívida de lint foi LIMPA. O
  // react-hooks/rules-of-hooks já não existe e os ~20
  // react/no-unescaped-entities foram corrigidos (aspas → &quot;). O
  // repo passa `npm run lint` a zero erros — adicionar esse comando
  // como step obrigatório no CI para manter o gate.
  //
  // type-check continua a bloquear o build (`tsc --noEmit` em CI); essa
  // camada não muda — uma action sem o guard `requireStaff`/`requireOwner`
  // ou um retorno mal tipado continua a falhar o build.
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
    // PERF (Q1): garante imports por-ícone do lucide-react em vez de puxar
    // o módulo inteiro — bundle de cliente menor e builds mais rápidas.
    optimizePackageImports: ["lucide-react"],
  },
  // PERF (QW-12 audit jun/2026): mantém estas deps SERVER-only fora do
  // bundle das funções serverless. exceljs (~1.2 MB) só é usado em
  // /api/relatorios/export; web-push em /api/push/dispatch; o cliente
  // Supabase tem dependências nativas que o webpack reempacotaria de
  // outra forma. Externalizá-las acelera cold starts dos endpoints.
  //
  // Next 16: renomeado de `experimental.serverComponentsExternalPackages`
  // para `serverExternalPackages` (top-level, GA).
  serverExternalPackages: ["exceljs", "web-push", "@supabase/supabase-js"],
  // ──────────────────────────────────────────────────────────────
  // H2 do audit · security headers
  //
  // Estes são os headers ESTÁTICOS que o Vercel pode setar a nível
  // de edge (sem precisar do middleware). O CSP é dinâmico (depende
  // de um nonce por request) e vive em `middleware.ts`.
  //
  // Headers omitidos aqui (geridos em middleware):
  //   • Content-Security-Policy — nonce-based
  // ──────────────────────────────────────────────────────────────
  headers: async () => [
    {
      source: "/manifest.json",
      headers: [{ key: "Cache-Control", value: "public, max-age=0, must-revalidate" }],
    },
    {
      source: "/sw.js",
      headers: [
        { key: "Content-Type", value: "application/javascript; charset=utf-8" },
        { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
        { key: "Service-Worker-Allowed", value: "/" },
      ],
    },
    {
      // Aplica-se a TODAS as rotas. Os assets estáticos do _next/static
      // recebem-nos na mesma — não há razão para os excluir.
      source: "/:path*",
      headers: [
        // HSTS: força HTTPS por 2 anos + subdomínios + preload list.
        // Só faz efeito quando servido sob HTTPS (Vercel sempre).
        { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
        // Bloqueia embed em iframes (clickjacking sobre botões de
        // cancelar/atribuir/etc.). Redundante com `frame-ancestors 'none'`
        // no CSP mas mantemos para browsers antigos.
        { key: "X-Frame-Options", value: "DENY" },
        // Impede o browser de "adivinhar" Content-Type → bloqueia
        // ataques de MIME-sniff que dependem de servir .json com
        // payload script.
        { key: "X-Content-Type-Options", value: "nosniff" },
        // Não envia o URL completo como Referer para domínios
        // externos — só o origin. Protege PII em query strings.
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
        // Desactiva APIs do browser que não usamos. Reduz superfície
        // se um XSS escapar ao CSP. `interest-cohort=()` opta-out do
        // FLoC do Chrome.
        { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()" },
        // Bloqueia que browsers velhos exponham informação cross-origin
        // sobre o documento.
        { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
      ],
    },
  ],
};

export default nextConfig;
