# Saul Goodman — Attorney at Law (恶搞站)

一个《风骚律师》风格的浮夸律师广告官网恶搞站。全英文，含注册、电话快答小游戏、全玩家排行榜。

## 本地运行

后端（同时 serve 前端与 API）：

    cd backend
    pip install -r requirements.txt
    uvicorn main:app --reload

打开 http://127.0.0.1:8000

## 测试

    cd backend && python -m pytest -v      # 后端
    cd frontend && npm test                # 前端游戏逻辑

## 图片替换

`frontend/images/` 下当前是 SVG 占位图。把你的剧照按同名保存为 `.jpg` 即可自动替换（HTML 已引用 `.jpg`，占位 SVG 仅兜底）：

- `saul-hero.jpg` — 主角大图，建议 1200×900
- `saul-1.jpg` … `saul-4.jpg` — 四张小图，建议 600×400

放进去后无需改代码。剧照请自行确认版权/用途。

## 部署到 render.com

1. 新建 Web Service，连接仓库，Root Directory 填 `saul-goodman/backend`。
2. Build Command：`pip install -r requirements.txt`
3. Start Command：`uvicorn main:app --host 0.0.0.0 --port $PORT`
4. 环境变量：`DATABASE_URL`（可选；默认 `saul.db`）。

注意：render 免费层磁盘 ephemeral，重启/部署会重置 SQLite 数据；要持久排行榜请接 render Postgres 或 persistent disk（把 `DATABASE_URL` 指向外部库）。

## 环境变量

- `DATABASE_URL` — SQLite 文件路径，默认 `saul.db`

## 版权

恶搞站，与任何真实律所/机构无关。招牌短句引用自剧集，其余文案原创。
