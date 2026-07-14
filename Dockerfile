FROM node:24 AS builder
WORKDIR /app
COPY package.json pnpm-lock.yaml ./
RUN corepack enable
RUN pnpm install --frozen-lockfile
COPY . .
RUN pnpm build


FROM node:24-slim
WORKDIR /app
RUN groupadd --system --gid 1001 ragx \
 && useradd  --system --uid 1001 --gid ragx ragx
COPY --chown=ragx:ragx --from=builder /app/.next/standalone /app/
COPY --chown=ragx:ragx --from=builder /app/.next/static /app/.next/static
ENV HOSTNAME=0.0.0.0
ENV PORT=8888
EXPOSE 8888
USER ragx
CMD ["node", "server.js"]
