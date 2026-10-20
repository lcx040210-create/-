# X工作者之家 · 部署与上线冒烟

本文覆盖：VPS 准备 → 配置 → 构建启动 → 数据库迁移 → 管理员初始化 → BSC 充值游标 → 服务条款 → 备份 → 升级 → 上线冒烟。

> 生产编排文件：`docker-compose.prod.yml`（postgres / redis / api / web / caddy）。
> 所有 `docker compose` 命令都必须带 `--env-file .env.production`：它同时用于 compose 变量插值（`DOMAIN`、前端构建参数）和容器运行时环境。
>
> **路径约定**：`APP_DIR` 指**含 `docker-compose.prod.yml` 的目录**。本仓库位于 Desktop monorepo，
> 典型值为 `/opt/x-workers-home/x-workers-home`；若部署独立仓库则为 `/opt/x-workers-home`。
> 新开 shell 先执行 `export APP_DIR=/opt/x-workers-home/x-workers-home`，后文命令均以 `$APP_DIR` 为工作目录。

---

## 0. 架构与前置条件

```
浏览器 ──https──> Caddy :443
                   ├── /api/*  ──> api:4001 (NestJS)
                   └── 其余    ──> web:4000 (Next.js standalone)
api/web ──> postgres:5432 (pgdata 卷) / redis:6379
api ──> BSC RPC（充值监听 / 对账，只读）
api ──> python3 + /app/tools/x.py（X 核验，出站访问 api.fxtwitter.com）
```

- 服务器要求：Ubuntu 22.04/24.04（或同类 Linux），2 vCPU / 2 GB 内存 / 20 GB 磁盘起步。
- **服务器不保存任何钱包私钥**。提现由运营者用自己的钱包手动转账，平台只登记收款地址与 txHash。
- X 绑定/核验依赖 `x.py` 直连 `https://api.fxtwitter.com`；VPS 需在该服务的可达区域（通常香港/新加坡/美西），**不支持通过 socks 代理**。若 VPS 无法直连，绑 X 与自动核验会失败。
- 国内构建机访问 GitHub 可能失败；`frontend/Dockerfile` 已内置 jsdelivr 字体镜像，仍失败时见 §7。

### 0.1 安装 Docker

```bash
curl -fsSL https://get.docker.com | sh
sudo usermod -aG docker "$USER"
# 退出 SSH 重新登录（或 newgrp docker）后验证：
docker version
docker compose version
```

### 0.2 DNS 与防火墙

- 在域名服务商添加 A 记录：`xwh.example.com -> <VPS IPv4>`（按实际域名替换）。
- 放行 22/80/443：
  ```bash
  sudo ufw allow OpenSSH
  sudo ufw allow 80/tcp
  sudo ufw allow 443/tcp
  sudo ufw allow 443/udp   # HTTP/3
  sudo ufw enable
  ```
- 等 DNS 生效再启动 Caddy，否则证书申请会失败并重试。

### 0.3 部署代码与目录约定

```bash
sudo mkdir -p /opt && sudo chown "$USER":"$USER" /opt
cd /opt
git clone <你的仓库地址> x-workers-home

# Desktop monorepo 布局：仓库根是 Desktop，应用在 x-workers-home/ 子目录。
APP_DIR=/opt/x-workers-home/x-workers-home
cd "$APP_DIR"
git checkout main   # 或以实际发布分支为准
export APP_DIR
test -f "$APP_DIR/docker-compose.prod.yml" && echo "APP_DIR ok: $APP_DIR"
```

> - Desktop monorepo 布局：`APP_DIR=/opt/x-workers-home/x-workers-home`（本文示例值）。
> - 独立 `x-workers-home` 仓库（仓库根即应用目录）：`APP_DIR=/opt/x-workers-home`。
> - 后续所有命令、cron、升级步骤都以 `APP_DIR`（即含 `docker-compose.prod.yml` 的目录）为准；cron 不依赖交互 shell，已写完整路径。

---

## 1. 配置 `.env.production`

```bash
cd "$APP_DIR"
cp deploy/.env.production.example .env.production
chmod 600 .env.production
```

逐项填写（模板里所有 `CHANGE_ME` / `0x0{40}` 都必须替换）：

| 变量 | 要求 |
| --- | --- |
| `DB_USERNAME` / `DB_PASSWORD` / `DB_DATABASE` | 数据库账号；密码用 `openssl rand -hex 24` 生成 |
| `DOMAIN` | 纯域名，如 `xwh.example.com`（不带 `https://`） |
| `NEXT_PUBLIC_API_URL` | 固定 `/api`（同源，经 Caddy 反代） |
| `NEXT_PUBLIC_SITE_URL` | `https://` + `DOMAIN`，分享链接与 og:image 使用 |
| `FRONTEND_URL` | 与 `NEXT_PUBLIC_SITE_URL` 完全一致（CORS 白名单） |
| `JWT_SECRET` / `JWT_REFRESH_SECRET` | 两个**不同**的随机串，各 `openssl rand -hex 32` |
| `PLATFORM_WALLET_ADDRESS` | 平台 USDT(BEP20) 收款地址（小写或混合大小写均可） |
| `BSC_RPC_URL` | 建议付费私有节点；公共节点限流会导致充值延迟、对账失败 |
| `USDT_BEP20_CONTRACT` | 主网默认 `0x55d398326f99059fF775485246999027B3197955` |
| `DEPOSIT_MIN_CONFIRMATIONS` | 默认 15 |
| `BSC_START_BLOCK` | **首次启动前填当前 BSC 区块高度**（见 §3）；留空有回扫风险 |
| `ALERT_WEBHOOK_URL` | 可选，TG Bot 风格 `POST {"text": "..."}`；留空只写日志 |
| `ADMIN_ADDRESS` / `ADMIN_PASSWORD` | 管理员登录地址与密码（`/admin/login`），密码用强随机串 |

生成密钥示例：

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # JWT_REFRESH_SECRET
openssl rand -hex 24   # DB_PASSWORD
```

检查文件权限与占位符：

```bash
grep -nE 'CHANGE_ME|0x0{40}' .env.production   # 不应再有输出
stat -c '%a %n' .env.production                # 期望 600
```

> **API 启动会校验资金 env**：`JWT_SECRET` / `JWT_REFRESH_SECRET` 必须非空且不同；
> `PLATFORM_WALLET_ADDRESS` 必须是合法的非零 BSC 地址；`USDT_BEP20_CONTRACT` 必须是合法地址。
> 任一不满足会直接拒绝启动；`DEPOSIT_MIN_CONFIRMATIONS` 为空/非法时回退 15 并打印 warn。

---

## 2. 构建并启动

> **硬门（首次部署）**：未设置 `BSC_START_BLOCK` 且未初始化 `chain_cursors.last_block` 前，不要启动常驻 api。
> 推荐先在 §1 填好 `BSC_START_BLOCK`（§3 方式 A）；如走方式 B，请先用一次性容器完成 §2.1 迁移并初始化游标，
> 再启动 api。否则首个 tick 可能从区块 1 开始回扫，造成巨大 RPC 区间。

```bash
cd "$APP_DIR"

# 先起数据库（等 healthcheck 通过）
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis

# 构建并启动 API（Nest 构建产物 + python3 + tools/x.py）
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build api

# 构建并启动 Web + Caddy（NEXT_PUBLIC_* 在 build args 中注入）
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build web caddy
```

查看状态（api/web 应为 healthy）：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml ps
```

> 首次启动时数据库还没有表，API 会记录查询错误但进程保持运行；完成 §2.1 迁移后重启 API 即可。
>
> 本机没有可用 Docker daemon 时无法本地验证镜像构建，**镜像构建需在 VPS 上执行**（`up -d --build` 会拉取基础镜像并下载中文字体，需要出网）。

### 2.1 生产迁移（必须在镜像内用编译产物执行）

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node ./node_modules/typeorm/cli.js migration:run -d dist/config/database.config.js
```

成功输出应为 `No migrations are pending` 或逐条 `Migration ... has been executed successfully`。

### 2.2 初始化管理员

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node dist/database/seed-admin.js
```

输出 `Admin upserted: 0x...` 即成功。管理员可用 `ADMIN_ADDRESS` + `ADMIN_PASSWORD` 登录 `/admin/login`。

### 2.3 重启并验证

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart api

curl -fsS "https://$(grep '^DOMAIN=' .env.production | cut -d= -f2-)/api/health"
# {"status":"ok"}

curl -fsS -o /dev/null -w '%{http_code}\n' "https://$(grep '^DOMAIN=' .env.production | cut -d= -f2-)/"
# 200
```

---

## 3. 首次启动前的 BSC 充值游标（重要）

> **硬门**：未设置 `BSC_START_BLOCK` 且未初始化 `chain_cursors` 前，**不要启动 api**（§2 的 `up -d --build api`）。

`chain_cursors` 初始行为 `last_block = 0`。若首次 tick 时游标仍为 0 且未配置 `BSC_START_BLOCK`，监听器会从区块 1 开始查询，RPC 区间巨大（可能直接超时/限流）。**任选一种方式**：

### 方式 A（推荐）：首次启动前设置 `BSC_START_BLOCK`

1. 查询当前 BSC 区块高度：

   ```bash
   BSC_RPC_URL="$(grep '^BSC_RPC_URL=' .env.production | cut -d= -f2-)"
   BLOCK=$(curl -s -X POST "$BSC_RPC_URL" \
     -H 'content-type: application/json' \
     --data '{"jsonrpc":"2.0","id":1,"method":"eth_blockNumber","params":[]}' \
     | python3 -c 'import sys,json; print(int(json.load(sys.stdin)["result"],16))')
   echo "$BLOCK"
   ```

2. 把该数字写入 `.env.production` 的 `BSC_START_BLOCK=`（建议再减 100 个块留缓冲）。

3. 再执行 §2 的 `up -d --build api`。监听器仅在 `cursor=0` 时使用该起点（含该块），之后按正常游标推进。

### 方式 B：启动后手工初始化游标

```bash
# 确保 api 未启动（如已启动，先 stop，避免首 tick 已经开扫）
docker compose --env-file .env.production -f docker-compose.prod.yml stop api

# 用上面的方式取得 BLOCK 后（替换 <BLOCK>），写库：
# last_block 语义为「已处理到的最后一个块」，下一 tick 从 last_block + 1 开始；
# 因此写 BLOCK - 1，保证 BLOCK 本身也会被扫描。
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U xwh -d xwh -c "UPDATE chain_cursors SET last_block = <BLOCK> - 1 WHERE id = 'bsc';"

docker compose --env-file .env.production -f docker-compose.prod.yml start api
```

> 若修改过 `DB_USERNAME` / `DB_DATABASE`，同步替换 `psql -U` / `-d` 参数。
> 校验：`SELECT * FROM chain_cursors;` 的 `last_block` 应略低于当前链头（下一 tick 会补齐）。

---

## 4. 服务条款 v1 正文替换

迁移预置了 v1 占位条款。正式上线前必须替换完毕（注册会被要求同意当前版本）。

**方式 A（推荐）**：登录 `/admin/terms`，粘贴终稿 Markdown 后发布（版本号自动 +1）。

**方式 B**：调用 API：

```bash
DOMAIN="$(grep '^DOMAIN=' .env.production | cut -d= -f2-)"
ADMIN_ADDRESS="$(grep '^ADMIN_ADDRESS=' .env.production | cut -d= -f2-)"
ADMIN_PASSWORD="$(grep '^ADMIN_PASSWORD=' .env.production | cut -d= -f2-)"

TOKEN=$(curl -fsS -X POST "https://$DOMAIN/api/admin/login" \
  -H 'content-type: application/json' \
  -d "{\"address\":\"$ADMIN_ADDRESS\",\"password\":\"$ADMIN_PASSWORD\"}" \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["accessToken"])')

curl -fsS -X POST "https://$DOMAIN/api/admin/terms" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'content-type: application/json' \
  --data-binary @terms-v1.json
# terms-v1.json: {"title":"用户协议与免责声明","contentMd":"# ...markdown 全文..."}
```

发布后 `GET /api/terms/current` 应返回新版本。

---

## 5. 每日备份与恢复

`scripts/backup.sh` 使用 `pg_dump -Fc` 导出到 `backups/`，只保留最近 14 份。

手动执行：

```bash
cd "$APP_DIR"
bash scripts/backup.sh
```

cron（每天 03:15；cron 不继承交互 shell 的 `APP_DIR`，这里写 Desktop monorepo 的完整路径；独立仓库改为 `/opt/x-workers-home`）：

```bash
crontab -e
# 加入：
15 3 * * * cd /opt/x-workers-home/x-workers-home && bash scripts/backup.sh >> /var/log/xwh-backup.log 2>&1
```

恢复（会覆盖当前库，务必先停业务）：

```bash
cd "$APP_DIR"
docker compose --env-file .env.production -f docker-compose.prod.yml stop api web
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_restore -U xwh -d xwh --clean --if-exists --no-owner < backups/xwh-YYYYmmdd-HHMMSS.dump
docker compose --env-file .env.production -f docker-compose.prod.yml start api web
```

> 若修改过 `DB_USERNAME` / `DB_DATABASE`，同步替换 `pg_restore -U` / `-d` 参数。
> 建议定期把 `backups/` 同步到异地（对象存储/另一台机器）。备份文件含用户与资金数据，权限保持 600。

---

## 6. 升级流程

```bash
cd "$APP_DIR"
bash scripts/backup.sh                 # 1. 先备份
git pull                               # 2. 拉新代码
docker compose --env-file .env.production -f docker-compose.prod.yml build api web   # 3. 重建镜像
docker compose --env-file .env.production -f docker-compose.prod.yml up -d postgres redis
docker compose --env-file .env.production -f docker-compose.prod.yml up -d api       # 4. 新 API 容器
docker compose --env-file .env.production -f docker-compose.prod.yml exec api \
  node ./node_modules/typeorm/cli.js migration:run -d dist/config/database.config.js # 5. 迁移
docker compose --env-file .env.production -f docker-compose.prod.yml up -d web caddy # 6. 切换 Web
curl -fsS "https://$(grep '^DOMAIN=' .env.production | cut -d= -f2-)/api/health"
```

- 只改域名时需重建 web（`NEXT_PUBLIC_SITE_URL` 是构建期变量）。
- 回滚：`git checkout <上一个发布 tag>` → 重新 build；数据库迁移只前进不回退，回滚前先确认兼容性。

---

## 7. OG 中文字体与手动兜底

`frontend/Dockerfile` 构建时会把**静态** Noto Sans SC（satori 不支持 ttc，也不支持可变字体的 fvar 表）下载到镜像内 `/app/fonts/NotoSansSC.ttf`，并设置 `OG_FONT_PATH`。下载来源依次为：

1. `https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.2.3/NotoSansSC_400Regular.ttf`（约 8 MB，OTTO/CFF，已实测 next/og 可用）
2. `https://cdn.jsdelivr.net/gh/notofonts/noto-cjk@main/Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf`（约 16 MB）

> 不要使用 `google/fonts` 仓库的 `NotoSansSC[wght].ttf`：它是可变字体，实测 satori 解析 fvar 时会抛
> `Cannot read properties of undefined (reading '265')`，OG 路由直接 500。

下载失败、文件过小或 magic 既不是 TrueType 也不是 OpenType 时，**构建会失败并打印明确错误**（不会静默产出中文缺字镜像）。若 VPS 网络长期无法下载，可手工兜底：

```bash
# 在能联网的机器下载后 scp 到 VPS：
curl -fL -o NotoSansSC.ttf \
  "https://cdn.jsdelivr.net/npm/@expo-google-fonts/noto-sans-sc@0.2.3/NotoSansSC_400Regular.ttf"

# VPS 上放到构建上下文（$APP_DIR 为含 Dockerfile 的部署根目录）：
mkdir -p "$APP_DIR/fonts-local"
cp NotoSansSC.ttf "$APP_DIR/fonts-local/NotoSansSC.ttf"
```

然后把 `frontend/Dockerfile` 中下载字体的 `RUN set -eux; ...` 整段替换为：

```dockerfile
COPY fonts-local/NotoSansSC.ttf /app/fonts/NotoSansSC.ttf
```

再重新 `build web`。验证方式见 §9 冒烟第 1 项（OG 图中文不能是方框）。

---

## 8. 运维提示

- **日志**：`docker compose --env-file .env.production -f docker-compose.prod.yml logs -f api web caddy`
- **重启单个服务**：`... restart api`
- **停止但保留数据**：`... down`；**清空数据**：`... down -v`（会删 pgdata，慎用）。
- **健康检查**：`api` 探 `/api/health`，`web` 探 `/`，`postgres` 用 `pg_isready`；`web` 依赖 `api healthy`。
- **充值监听**：每 30s tick，`DEPOSIT_MIN_CONFIRMATIONS` 之前不入账；游标不前进时看 api 日志中的“BSC 充值监听失败”。
- **对账**：`/admin/reconciliation` 每 30 分钟巡检；`status=deficit` 时按 `ALERT_WEBHOOK_URL` 推送。USDT 余额来自链上 `balanceOf`，请保证平台钱包余额 ≥ 90% 全平台 XM + 待付提现。
- **提现**：全人工。管理员在 `/admin/withdrawals` 审核 → 用自己的钱包转账 → 回填 txHash 标记 paid。
- **安全**：`.env.production` 与备份文件不要进 git、不要放进镜像（`.dockerignore` 已排除 `.env*`）。

---

## 9. 上线冒烟清单（真钱小额，逐项打勾）

> 建议在正式对外前用两个 QA 账号、真实 11 USDT 走一遍；所有资金动作记录 txHash / 订单号 / 管理员操作时间。

### 9.1 基础可达性

- [ ] `curl https://<DOMAIN>/api/health` → `{"status":"ok"}`
- [ ] 浏览器打开 `https://<DOMAIN>/` → 大厅正常渲染，`/_next` 静态资源 200
- [ ] `https://<DOMAIN>/admin/login` → 管理员可登录
- [ ] OG 图（必须**经 Caddy 域名**访问，验证 `/api/og/*` 分流）：`curl -fsS -o og.png -w '%{content_type} %{http_code}\n' https://<DOMAIN>/api/og/order/<订单UUID>` → `image/png 200`；同法验证 `https://<DOMAIN>/api/og/u/<已绑定用户UUID>`，打开图片确认**中文不是方框**（若经域名 404 而本地 200，检查 Caddyfile 中 `/api/og/*` 是否排在 `/api/*` 之前）

### 9.2 账号与绑定

- [ ] 注册：钱包签名登录成功，注册前展示当前条款
- [ ] 绑定 X：`/api/bindings/x/start` 生成验证码，发推后轮询成功；评级出现（需 VPS 直连 fxtwitter）
- [ ] 封禁生效：管理员在 `/admin/users` 封禁一个 QA 账号 → 该账号请求被拒绝 / 无法登录

### 9.3 资金（真钱）

- [ ] 用已绑定钱包向 `PLATFORM_WALLET_ADDRESS` 转入 **11 USDT(BEP20)**；等待 ≥15 确认后自动入账 11 XM（`/wallet` 可见）
- [ ] 充值自动匹配：`deposits` 表该笔 `status=credited`、`user_id` 正确
- [ ] 未匹配认领：从**未绑定**地址小额转入 → 后台 `/admin/deposits` 出现 `unmatched` → 认领给指定账号 → 余额增加且只入账一次
- [ ] 提现 50 XM：`/wallet` 申请 → 后台审核 → 运营者钱包手动转 USDT → 回填 txHash 标记 paid → 用户余额与流水正确

### 9.4 商单闭环（真钱）

- [ ] 商家发单（1 个名额；含发单费）→ 托管金额正确
- [ ] 第二个账号抢单 → 名额 -1
- [ ] 交付推文链接 → 自动核验（或核验失败转人工，管理员 `/admin/manual` 放行）
- [ ] 商家确认 → 结算放款（`slots.status=paid`，接单者余额增加，平台手续费入账）
- [ ] 48h 自动放款分支：另一单不确认，确认窗到期后由 cron 自动放款
- [ ] 对账页 `/admin/reconciliation` → `status: ok`（需要 BSC RPC 可读余额且平台钱包余额充足）
- [ ] 争议：商家对 `passed` 名额发起质量争议 → 管理员裁决（payout / refund）→ 资金与状态正确
- [ ] 数据处置：冒烟产生的订单/争议/提现保留在库中并备注“上线冒烟”；如需清理，先确保资金守恒再删除。

> 上表中“真实链上充值 / 自动对账”依赖 BSC RPC 与链上真实转账；在无 RPC 的本地环境只能以 FakeChainProvider 覆盖，属环境阻塞，必须在 VPS 上补跑。

---

## 10. 常见问题

| 现象 | 排查 |
| --- | --- |
| Caddy 证书申请失败 | DNS 未生效 / 80,443 未放行 / DOMAIN 写了协议前缀 |
| `/api/health` 502 | `docker compose ps` 看 api 是否 healthy；`logs api` |
| 页面 SSR 报“无法连接服务器” | web 容器环境缺 `API_INTERNAL_URL`，或 api 未 healthy |
| 浏览器 API 跨域 | `FRONTEND_URL` 与 `NEXT_PUBLIC_SITE_URL` 不一致，或 web 构建时未注入 `/api` |
| 绑 X 失败 | VPS 无法访问 `api.fxtwitter.com`（换区域/换 VPS，x.py 不支持 socks） |
| 充值迟迟不到账 | 确认数未到 / 游标未推进 / RPC 限流；看 api 日志与 `chain_cursors` |
| 对账 `deficit` | 平台钱包 USDT 不足 90% 全平台 XM + 待付提现，或 RPC 读不到余额 |
| OG 图中文方框 / 路由 500 | 字体缺失或用了可变字体：确认 `OG_FONT_PATH` 指向 `/app/fonts/NotoSansSC.ttf`，按 §7 使用静态字体重建；`parseFvarAxis` 报错说明用了 `NotoSansSC[wght].ttf` |
| 经域名访问 OG 404、本地 standalone 200 | Caddy 把 `/api/og/*` 反向代理到了 NestJS：确认 `deploy/Caddyfile` 中 `/api/og/* → web:4000` 位于 `/api/* → api:4001` 之前，重建/重启 caddy |
