# 构建上下文为仓库根目录：docker build -f server/Dockerfile .
FROM node:22-bookworm-slim AS build
WORKDIR /app/server
COPY server/package.json server/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY shared /app/shared
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build && npm prune --omit=dev

FROM node:22-bookworm-slim
# 朗读音频（v1.5.0）：edge-tts 装在独立的 Python 虚拟环境里，由服务以子进程调用
RUN apt-get update && apt-get install -y --no-install-recommends python3 python3-venv ca-certificates \
 && python3 -m venv /opt/tts && /opt/tts/bin/pip install --no-cache-dir edge-tts==7.3.1 \
 && rm -rf /var/lib/apt/lists/*
ENV NODE_ENV=production \
    MIGRATIONS_DIR=/app/server/migrations \
    PATH=/opt/tts/bin:$PATH
WORKDIR /app/server
COPY --from=build /app/server/node_modules ./node_modules
COPY --from=build /app/server/dist ./dist
COPY server/package.json ./
COPY server/migrations ./migrations
# 离线识别结果的读音对照表（不是 .ts，tsc 不会带上）
COPY server/src/content/voskReadings.json.gz ./dist/server/src/content/voskReadings.json.gz
USER node
EXPOSE 3100
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:3100/api/v1/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["sh", "-c", "node dist/server/src/db/migrate.js && exec node dist/server/src/server.js"]
