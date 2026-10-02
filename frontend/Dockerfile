# syntax=docker/dockerfile:1.7
# Multi-stage build for the FuelOps Next.js frontend.
# Stage 1: install deps + build the standalone bundle.
# Stage 2: minimal runtime that only contains the built artifact.

# ---- 1. deps + build ----
FROM node:20-alpine AS builder
WORKDIR /app

# pnpm via corepack
ENV PNPM_HOME="/pnpm"
ENV PATH="$PNPM_HOME:$PATH"
RUN corepack enable && corepack prepare pnpm@10.33.2 --activate

# Install dependencies (better layer caching when only source changes)
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

# Copy source and build. NEXT_PUBLIC_* values are inlined into the JS bundle,
# so they MUST be present at build time. They are passed via build args from
# docker-compose.yml.
COPY . .
ARG NEXT_PUBLIC_OPERATOR_TOKEN
ENV NEXT_PUBLIC_OPERATOR_TOKEN=${NEXT_PUBLIC_OPERATOR_TOKEN}
RUN pnpm build

# ---- 2. runtime ----
FROM node:20-alpine AS runner
WORKDIR /app

ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3000

# Non-root for safety
RUN addgroup --system --gid 1001 nodejs \
 && adduser  --system --uid 1001 nextjs

# Standalone output: copy just the runtime bits.
# next.config.js sets `output: 'standalone'`, which produces /app/.next/standalone
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static    ./.next/static
COPY --from=builder --chown=nextjs:nodejs /app/public           ./public

USER nextjs
EXPOSE 3000

# Lightweight liveness probe the container's HEALTHCHECK can call.
HEALTHCHECK --interval=10s --timeout=3s --start-period=20s --retries=5 \
  CMD wget --quiet --tries=1 --spider http://localhost:3000/ || exit 1

CMD ["node", "server.js"]