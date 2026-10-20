# syntax=docker/dockerfile:1

# 构建上下文为仓库根目录（docker-compose.prod.yml）。
FROM node:20-bookworm-slim AS build

WORKDIR /app

# NEXT_PUBLIC_* 在 next build 时被内联进前端产物，必须在构建期注入。
ARG NEXT_PUBLIC_API_URL=/api
ARG NEXT_PUBLIC_SITE_URL=https://example.com
ENV NEXT_PUBLIC_API_URL=$NEXT_PUBLIC_API_URL \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_TELEMETRY_DISABLED=1

RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates curl \
    && rm -rf /var/lib/apt/lists/*

COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci

COPY frontend/next.config.mjs \
     frontend/tsconfig.json \
     frontend/postcss.config.js \
     frontend/tailwind.config.ts \
     ./
COPY frontend/src ./src

# OG 图中文需要静态 TTF/OTF（satori 不支持 ttc，也不能解析可变字体的 fvar 表）。
# 注意：google/fonts 仓库的 NotoSansSC[wght].ttf 是可变字体，satori 会抛
# "Cannot read properties of undefined (reading '265')" 并导致 OG 路由 500，
# 因此这里使用静态实例（@expo-google-fonts 的 400 Regular，OTTO/CFF）。
# 下载失败 / 文件异常必须让构建失败，不能静默产出缺字或 500 的镜像。
RUN set -eux; \
    mkdir -p /app/fonts /app/public; \
    if ! curl -fL --retry 2 --connect-timeout 15 --max-time 180 \
        -o /app/fonts/NotoSansSC.ttf \
        "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.2.3/NotoSansSC_400Regular.ttf"; then \
      echo "Expo 字体下载失败，改用 noto-cjk 静态 OTF"; \
      curl -fL --retry 2 --connect-timeout 15 --max-time 240 \
        -o /app/fonts/NotoSansSC.ttf \
        "https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf"; \
    fi; \
    [ "$(stat -c %s /app/fonts/NotoSansSC.ttf)" -gt 1000000 ] || { \
      echo "错误：中文字体下载不完整，OG 图会缺字。请检查构建机网络后重试。" >&2; \
      exit 1; \
    }; \
    MAGIC=$(head -c 4 /app/fonts/NotoSansSC.ttf | od -An -tx1 | tr -d ' \n'); \
    [ "$MAGIC" = "00010000" ] || [ "$MAGIC" = "4f54544f" ] || { \
      echo "错误：中文字体既不是 TrueType 也不是 OpenType（magic=$MAGIC），satori 无法使用。" >&2; \
      exit 1; \
    }

RUN npm run build

FROM node:20-alpine AS runner

RUN apk add --no-cache libc6-compat

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4000 \
    HOSTNAME=0.0.0.0 \
    NEXT_TELEMETRY_DISABLED=1 \
    OG_FONT_PATH=/app/fonts/NotoSansSC.ttf

RUN addgroup -g 1001 -S nodejs \
    && adduser -S nextjs -u 1001

COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/fonts ./fonts

USER nextjs
EXPOSE 4000

CMD ["node", "server.js"]
