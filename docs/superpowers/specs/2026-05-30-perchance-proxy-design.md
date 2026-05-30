# Perchance AI 图片生成器 — 套壳代理站点

> 日期: 2026-05-30
> 状态: 设计完成

## 概述

为 Perchance.org 的 AI 文本生成图片功能（基于 Stable Diffusion）做一个套壳代理网站。
中国大陆用户无需 VPN 即可直接使用，部署在 Cloudflare Workers（免费方案），零成本。

## 目标与约束

| 项目 | 规格 |
|------|------|
| 目标网站 | https://perchance.org/ai-text-to-image-generator |
| 部署平台 | Cloudflare Workers（免费版） |
| 费用 | 零成本 |
| 国内访问 | 通过 Cloudflare CDN 边缘节点，国内可通 |
| 功能范围 | 完整版：prompt、负面提示词、分辨率、风格、CFG、种子、批量生成、历史记录 |
| 存储 | 浏览器 IndexedDB（图片 Base64 本地存储） |
| 等待方式 | 同步等待 + 加载动画 |
| UI 风格 | 简洁实用，原生实现 |

## 架构

```
用户浏览器 (国内)
  │
  │  POST /api/generate
  ▼
Cloudflare Worker (免费)
  ├── GET  /  → 返回单页 HTML
  └── POST /api/generate → 转发 Perchance 内部 API
                                │
                                ▼
                        Perchance.org 图片生成服务
                        (Stable Diffusion 后端)
```

**一个 Worker 文件搞定全部**：静态页面服务 + API 代理。
前端用原生 HTML/CSS/JS，不引入任何框架或构建工具。

## 前端功能

单个 HTML 文件，三个功能区：

### 输入区
- 提示词输入框（主 prompt）
- 负面提示词输入框（negative prompt）
- 参数行：
  - 分辨率下拉：512×512 / 512×768 / 768×512
  - 风格下拉：初次加载时通过 Worker 抓取 Perchance 页面上的风格列表（或硬编码常用风格兜底）
  - CFG 滑块（1-30，默认 7）
  - 随机种子输入（默认 -1，随机）
- 生成数量输入（1-10 张）
- 生成按钮

### 结果区
- 加载动画：CSS spinner + 文字"正在生成，预计 10-30 秒…"
- 生成完成展示图片网格
- 每张图可点击放大、右键下载
- 超时展示"重试"按钮

### 历史区
- IndexedDB 存储：提示词、参数、图片 Base64、生成时间
- 按时间倒序，缩略图网格
- 支持删除单条、一键清空
- 点击历史项回填参数到输入区

## API 设计

### POST /api/generate

**请求体：**
```json
{
  "prompt": "a cat wearing a hat",
  "negativePrompt": "ugly, blurry",
  "resolution": "512x768",
  "guidanceScale": 7,
  "seed": -1,
  "style": "fantasy-portrait",
  "count": 4
}
```

**成功响应：**
```json
{
  "success": true,
  "images": ["data:image/png;base64,..."],
  "error": null
}
```

**失败响应：**
```json
{
  "success": false,
  "images": [],
  "error": "生成超时，请重试"
}
```

### GET /

返回完整 HTML 页面（前端代码内嵌在 Worker 中）。

## Worker 核心逻辑

1. 接收前端 POST → 校验参数
2. 构造请求体 → 转发给 Perchance 内部图片生成端点
3. 等待 Perchance 返回（前端 20 秒超时优先，Worker 被动等待）
4. 将图片 URL 下载 → Base64 编码 → 返回前端
5. 前端超时展示重试按钮；Worker 侧不设超时，等前端主动断开后自然结束

## 实现第一步：Perchance API 逆向

在浏览器中打开 https://perchance.org/ai-text-to-image-generator，
DevTools → Network 标签，输入 prompt 生成，抓取请求。

需确认：
- **端点 URL**：生成图片的 POST 地址
- **请求格式**：JSON 还是 FormData
- **认证方式**：是否需要 session cookie 或 CSRF token
- **响应格式**：直接返回图片数据还是包含 URL 的 JSON
- **CORS**：Worker 代理可绕过，但需确认是否有其他校验

## 图片处理策略

- Perchance 大概率返回图片 URL
- Worker 下载图片后转 Base64 返回前端
- 避免原始域名暴露给国内用户
- Base64 存 IndexedDB：注意浏览器配额（通常 50% 磁盘空闲空间）

## 错误处理

| 场景 | 处理 |
|------|------|
| Perchance 无响应 | 前端 20s 超时，展示重试按钮 |
| Perchance 返回错误 | Worker 透传错误信息给前端 |
| Worker 自身异常 | 前端展示通用错误 + 重试 |
| IndexedDB 满 | 提示用户清理历史记录 |
| 网络断开 | 前端 fetch 捕获异常，展示"网络错误" |

## 项目结构

```
perchance-proxy/
├── worker.js         # Cloudflare Worker（前端 HTML + API 代理）
├── wrangler.toml     # Cloudflare 部署配置
└── README.md         # 部署说明
```

## Cloudflare Workers 免费版限制

| 项目 | 额度 |
|------|------|
| 请求次数 | 100,000 次/天 |
| CPU 时间 | 10 ms/请求 |
| 墙钟时间 | 免费版较短（需实测），前端 20s 超时优先 |
| 脚本大小 | 1 MB |

> 注意：免费版墙钟限制是潜在瓶颈。若 Perchance 生成超时频繁，需考虑升级到 Workers Paid（$5/月，30s 墙钟）。

## 待确认项

- [ ] Perchance 内部生成 API 的具体端点、参数格式、响应格式
- [ ] 是否有 session 或 CSRF token 要求
- [ ] CF Workers 免费版实际墙钟上限（官方未明确文档化）
- [ ] 国内访问 `*.workers.dev` 的实际可用性
