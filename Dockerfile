# ============ 构建阶段 ============
FROM node:24-alpine AS builder

WORKDIR /app

# 依赖层单独缓存：package.json 不变时跳过 npm install
COPY package.json package-lock.json* ./
RUN npm ci --no-audit --no-fund || npm install --no-audit --no-fund

COPY . .

ENV NEXT_TELEMETRY_DISABLED=1
RUN npm run build

# ============ 运行阶段 ============
FROM node:24-alpine AS runner

WORKDIR /app

ENV NODE_ENV=production \
    NEXT_TELEMETRY_DISABLED=1 \
    PORT=3080 \
    HOSTNAME=0.0.0.0 \
    DATA_DIR=/app/data \
    TZ=Asia/Shanghai

# curl 用于健康检查，tzdata 用于本地时间，noto 字体供打印预览中文渲染
RUN apk add --no-cache tzdata font-noto-cjk curl \
    && ln -snf /usr/share/zoneinfo/$TZ /etc/localtime \
    && echo $TZ > /etc/timezone

# Next standalone 产物
COPY --from=builder /app/.next/standalone ./
COPY --from=builder /app/.next/static ./.next/static
COPY --from=builder /app/public ./public

# 数据目录（挂载到 NAS）
RUN mkdir -p /app/data && chown -R node:node /app

USER node

EXPOSE 3080

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3080/api/health || exit 1

# Node 24 的 node:sqlite 已稳定，无需实验性标志
CMD ["node", "server.js"]
