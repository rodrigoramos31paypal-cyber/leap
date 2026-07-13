# syntax=docker/dockerfile:1.7
# ════════════════════════════════════════════════════════════════
# Build otimizado para deploys rápidos no Coolify.
#
# PORQUÊ (vs Nixpacks, que arranca "a frio" a cada deploy):
#   • cache mount BuildKit em ~/.npm        → npm ci não volta a
#     descarregar pacotes que já tem.
#   • cache mount BuildKit em .next/cache   → o compilador do Next
#     (SWC/webpack) reutiliza módulos não alterados. Mudar 1 página
#     (ex.: a tab Agenda) passa a recompilar essa página + o que dela
#     depende, em vez da app inteira.
#   • layer de dependências separada do código → mudar código NÃO
#     corre npm ci outra vez.
#   • output standalone → imagem pequena e arranque rápido.
#
# REQUISITOS NO COOLIFY:
#   • Build Pack = "Dockerfile".
#   • BuildKit ativo (default nas versões recentes do Coolify).
#   • As 5 variáveis NEXT_PUBLIC_* marcadas "Available at Buildtime"
#     (são embebidas no bundle pelo next build — bloco ARG abaixo).
#   • As variáveis de servidor (chaves Supabase service, web-push,
#     Upstash, etc.) marcadas "Available at Runtime".
# ════════════════════════════════════════════════════════════════

ARG NODE_IMAGE=node:22-slim

# ── deps · instala node_modules (camada cacheável) ───────────────
FROM ${NODE_IMAGE} AS deps
WORKDIR /app
# Só os ficheiros de lock → esta layer só invalida quando as deps
# mudam. Com o cache mount do npm, mesmo aí reutiliza tarballs.
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci

# ── builder · compila a app ──────────────────────────────────────
FROM ${NODE_IMAGE} AS builder
WORKDIR /app

# NEXT_PUBLIC_* TÊM de existir no build (o Next inline-a estes valores
# no bundle — não são lidos em runtime). O Coolify passa-as como
# --build-arg quando marcadas "Available at Buildtime". Promovemos cada
# ARG a ENV antes do build.
ARG NEXT_PUBLIC_APP_URL
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_PT_MBWAY_PHONE
ENV NEXT_PUBLIC_APP_URL=$NEXT_PUBLIC_APP_URL \
    NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_PT_MBWAY_PHONE=$NEXT_PUBLIC_PT_MBWAY_PHONE \
    NEXT_TELEMETRY_DISABLED=1

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# M-1 (audit jul/2026): GATE DE TIPOS dentro do build de deploy.
# `next build` corre com typescript.ignoreBuildErrors:true (perf), logo
# NÃO valida tipos. O CI valida, mas o Coolify faz deploy por webhook e
# não espera pelo CI — um erro de tipos (ex.: uma server action sem o
# guard requireStaff/requireOwner, um retorno mal tipado) podia ser
# publicado à mesma. Corremo-lo aqui: se falhar, a imagem NÃO é
# construída e o Coolify mantém a versão anterior no ar, em vez de
# publicar silenciosamente um deploy com regressões de tipo.
# Custo: um `tsc --noEmit` por deploy (o cache do .next não o acelera).
RUN npm run type-check

# O cache mount no .next/cache é o ganho incremental. Persiste entre
# builds → só recompila o que mudou desde o último deploy.
RUN --mount=type=cache,target=/app/.next/cache \
    npm run build

# ── runner · imagem final mínima (standalone) ────────────────────
FROM ${NODE_IMAGE} AS runner
WORKDIR /app
ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3000 \
    HOSTNAME=0.0.0.0

# public/ e os assets estáticos (standalone NÃO os copia sozinho).
COPY --from=builder /app/public ./public
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static

# sharp: necessário para o optimizer de imagens do next/image em modo
# standalone. Não vem no trace porque não é dependência direta no
# package.json; instalamo-lo aqui (cache mount → rápido nos próximos).
RUN --mount=type=cache,target=/root/.npm \
    npm install --no-save sharp@0.33.5

# Utilizador não-root.
RUN groupadd -g 1001 nodejs \
    && useradd -u 1001 -g nodejs -m nextjs \
    && chown -R nextjs:nodejs /app
USER nextjs

EXPOSE 3000
# server.js é o entrypoint gerado pelo output standalone.
CMD ["node", "server.js"]
