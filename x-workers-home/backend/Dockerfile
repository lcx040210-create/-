# syntax=docker/dockerfile:1

# 构建上下文为仓库根目录（docker-compose.prod.yml），以便携带 tools/x.py。
FROM node:20-bookworm-slim AS build

WORKDIR /app
RUN apt-get update \
    && apt-get install -y --no-install-recommends ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/package.json backend/package-lock.json ./
RUN npm ci

COPY backend/tsconfig.json backend/nest-cli.json ./
COPY backend/src ./src
RUN npm run build

FROM node:20-bookworm-slim AS runtime

# python3 供 X 核验脚本 tools/x.py 使用（仅标准库）。
# 平台不保存任何钱包私钥：打款由运营者用自己的钱包手动完成。
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 ca-certificates \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    PORT=4001 \
    XSCRAPER_PYTHON=python3 \
    XSCRAPER_SCRIPT=/app/tools/x.py

COPY backend/package.json backend/package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY tools/x.py /app/tools/x.py

USER node
EXPOSE 4001

# 生产迁移：node ./node_modules/typeorm/cli.js migration:run -d dist/config/database.config.js
CMD ["node", "dist/main.js"]
