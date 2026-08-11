# PTE/雅思在线教学平台 — 设计文档

## 概述

面向全球华语考生的 PTE/雅思在线教学平台。多角色（学生/老师/管理员），学生购买课包后预约老师上课，平台通过课时差价盈利。

**模式**：平台型 — 学生买课包 → 选老师约课 → 外部工具上课 → 平台记录 → 老师结算

## 整体架构

### 技术栈

| 层 | 选型 | 理由 |
|---|------|------|
| 前端 | Next.js + Tailwind CSS | SSR 对官网 SEO 友好，App Router 结构清晰 |
| 后端 | Nest.js | 类型安全、模块化、适合多角色复杂业务 |
| 数据库 | PostgreSQL | 结构化数据，关系型建模 |
| 缓存/队列 | Redis | 会话管理、预约冲突检测、通知队列 |
| 文件存储 | S3/OSS | 老师头像上传 |
| 部署 | Vercel（前端）+ VPS（后端） | 官网 SSR 放 Vercel，API 放服务器 |

### 路由边界

```
/                   官网（公开营销页，SSR）
/app/*              平台主体（学生端 + 老师端，SPA）
/admin/*            管理后台（仅 admin 角色可访问）
/api/*              后端 REST API
```

### 数据流核心路径

```
学生注册 → 浏览课包 → 下单购买 → 支付成功 → 分类余额入账
→ 选老师浏览时段 → 预约课时 → 扣减余额
→ 上课（外部工具，平台记录状态）
→ 课后双向评价 → 评价计入老师绩效
→ 周期结算 → 管理员审核 → 打款老师
```

---

## 子系统 1：用户系统

### 三种角色

| 角色 | 权限概要 |
|------|---------|
| 学生 | 注册 → 买课包 → 预约 → 上课 → 评价 |
| 老师 | 注册 → 上传头像 → 设置技能标签 → 设可约时段 → 查看课时 → 查看收入 |
| 管理员 | 所有数据管理 → 审核老师 → 审核结算 → 管理课包 → 查看报表 |

### 注册/登录

- 注册时选择角色（学生/老师）
- 登录方式：邮箱 + 密码，或微信扫码登录
- 老师注册后需管理员审核通过才能上线接课（`review_status: pending → approved`）

### 老师技能标签（二维组合）

```
考试类型（可多选）：PTE Academic / PTE Core / 雅思
技能维度（可多选）：口语 / 写作 / 阅读 / 听力
```

学生浏览老师时可按考试类型 + 技能维度组合筛选。

### 头像上传

- 老师注册后可上传头像，前端裁剪为正方形
- 存储到 S3/OSS，生成 200×200 缩略图
- 前端压缩后再上传，限制 2MB
- 审核前为默认占位图

### 数据模型

**user 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| email | varchar | 唯一 |
| phone | varchar | 选填 |
| password_hash | varchar | |
| role | enum | student / teacher / admin |
| name | varchar | 账号实名（登录/结算用） |
| wechat_openid | varchar | 微信登录绑定，可空 |
| status | enum | active / pending_review / suspended |
| created_at | timestamp | |

**teacher_profile 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK → user.id | 一对一 |
| display_name | varchar | 对外展示名（如 "Luna老师"） |
| intro | text | 个人简介 |
| exam_types | jsonb | `["PTE-A", "PTE-C", "IELTS"]` |
| skills | jsonb | `["speaking", "writing", "reading", "listening"]` |
| avatar_url | varchar | 头像地址 |
| tags | jsonb | 自定义标签 `["口语专家", "7分保底"]` |
| review_status | enum | pending / approved / rejected |
| base_rate | decimal | 基础课时费（管理员设定） |
| max_daily_lessons | int | 单日最大课时数，默认无限制 |

---

## 子系统 2：课包系统

### 课包结构

固定档位的课时套餐，管理员在后台创建和管理。

**package 表：**

| 字段 | 类型 | 说明 | 示例 |
|------|------|------|------|
| id | uuid PK | | |
| name | varchar | 课包名称 | "PTE 口语冲刺包" |
| lesson_count | int | 课时数 | 10 / 20 / 50 |
| price | decimal | 售价（人民币） | 2999 |
| valid_days | int | 有效期（天） | 180 |
| exam_types | jsonb | 适用考试类型 | `["PTE-A", "PTE-C"]` |
| skills | jsonb | 适用技能维度 | `["speaking"]` |
| description | text | 详细介绍 | |
| status | enum | draft / active / archived | |
| created_at | timestamp | | |

### 分类课时余额模型

购买课包时，课包的 `exam_types` 和 `skills` 锁定在余额记录中。学生约课时，系统必须匹配到对应的余额才能扣减。

**balance_record 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| student_id | uuid FK → user.id | |
| order_id | uuid FK → order.id | 购买来源 |
| exam_types | jsonb | 锁定的考试类型 |
| skills | jsonb | 锁定的技能维度 |
| total_lessons | int | 初始课时数 |
| remaining | int | 剩余课时数 |
| expires_at | date | 过期日期 |
| created_at | timestamp | |

### 预约扣减匹配逻辑

```
1. 获取要约的课的老师所教的 exam_types + skills
2. 查找学生余额中：exam_types 包含目标 && skills 包含目标 && remaining > 0 && 未过期
3. 匹配成功 → 扣 1 节（多条余额时按 expires_at FIFO，即将到期的先扣）
4. 匹配失败 → 提示"课时不足，请购买对应课包"
```

---

## 子系统 3：预约系统

### 老师设置可用时段

老师按周模板设置固定可用时间块：

```
周一：18:00-21:00
周三：14:00-17:00, 19:00-21:00
周六：09:00-12:00, 14:00-18:00
```

每节课固定 **1 小时**。系统将周模板展开为未来 30 天的具体时间槽。

### 预约规则

| 规则 | 说明 |
|------|------|
| 提前预约 | 至少提前 4 小时 |
| 取消规则 | 开课前 12 小时可免费取消，退回课时；超时则扣课时 |
| 冲突检测 | 同一时间一个老师只能被一个学生约 |
| 单日上限 | 老师可设单日最大课时数 |

### 两种预约入口

| 入口 | 操作人 | 场景 |
|------|--------|------|
| 学生端 | 学生自己 | 浏览老师 → 选时段 → 约课 |
| 老师端 | 老师代约 | 选择学生 + 选自己的空时段 → 系统检查余额 → 成功/失败 |

老师代约限制：只能约自己的课，学生必须有匹配余额。

### 数据模型

**booking 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| student_id | uuid FK → user.id | |
| teacher_id | uuid FK → user.id | |
| start_time | timestamp | 上课时间 |
| end_time | timestamp | start_time + 1h |
| status | enum | booked / completed / cancelled / no_show |
| balance_record_id | uuid FK | 扣的哪条余额 |
| created_by | enum | student / teacher |
| cancelled_at | timestamp | 可空 |
| created_at | timestamp | |

**teacher_schedule 表（周模板）：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| teacher_id | uuid FK | |
| day_of_week | int | 0=周日, 1=周一, ... 6=周六 |
| start_time | time | 如 18:00 |
| end_time | time | 如 21:00 |
| is_active | bool | |

---

## 子系统 4：支付系统

### 支付场景

仅学生购买课包时支付，无其他支付场景。

### 支付通道

前期只接入：

| 通道 | 方式 |
|------|------|
| 微信支付 | Native 支付（扫码付） |
| 支付宝 | 当面付（扫码付） |

### 支付流程

```
学生选课包 → 下单 → 生成支付二维码 → 学生扫码支付
→ 支付成功回调 → 自动创建 balance_record → 通知学生
→ 超时 30 分钟未付 → 订单自动过期
```

### 数据模型

**order 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | 订单号 |
| student_id | uuid FK | |
| package_id | uuid FK → package.id | |
| amount | decimal | 实付金额 |
| pay_channel | enum | wechat / alipay |
| pay_status | enum | pending / paid / expired / refunded |
| pay_url | varchar | 支付二维码链接 |
| paid_at | timestamp | |
| expired_at | timestamp | 创建后 30 分钟 |
| created_at | timestamp | |

### 退费

暂不做自动退费。退费由管理员后台手动处理（线下退款 + 手动扣减/作废余额）。

---

## 子系统 5：结算系统

### 结算模型

**基础课时费 + 绩效奖金**

### 基础课时费

每个老师在 `teacher_profile.base_rate` 中设定，如 ¥180/节。

### 绩效奖金规则

| 类型 | 触发条件 | 奖励 | 示例 |
|------|---------|------|------|
| 课时量奖金 | 周期内课时 ≥ N | 固定金额 | ≥50 节 → ¥500 |
| 好评率奖金 | 周期好评率 ≥ X% | 按基础收入比例 | ≥95% → 额外 5% |
| 续报率奖金 | 学生续购课包 | 按人数固定金额 | 每续报 1 人 → ¥100/人 |

### 结算周期

- 按周：每周一生成上周结算单
- 按月：每月 1 日生成上月结算单
- 管理员可选结算方式

### 结算流程

```
周期结束 → 系统自动计算（课时×base_rate + 绩效奖金）
→ 生成结算单（draft）
→ 管理员审核 → approved → 管理员线下打款 → 标记 paid
→ 通知老师
```

### 数据模型

**settlement 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| teacher_id | uuid FK | |
| period_start | date | |
| period_end | date | |
| total_lessons | int | 完成课时数 |
| base_amount | decimal | 基础课时费合计 |
| bonus_amount | decimal | 绩效奖金合计 |
| total_amount | decimal | 应付总额 |
| status | enum | draft / pending_review / approved / paid |
| reviewed_by | uuid FK | 审核人（管理员） |
| paid_at | timestamp | |
| remark | text | 备注 |

**bonus_rule 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| type | enum | volume / rating / renewal |
| threshold | decimal | 触发阈值 |
| reward_type | enum | fixed / percent |
| reward_value | decimal | 固定金额或百分比（如 0.05 = 5%） |
| is_active | bool | |

---

## 子系统 6：评价系统

### 双向评价

上课完成后，学生和老师互相评价，双方独立进行。

### 学生评老师

| 字段 | 类型 |
|------|------|
| rating | 1-5 星 |
| content | 文字（选填） |
| tags | 多选标签：讲解清晰 / 有耐心 / 方法实用 / 提分快 |

**公开显示在老师主页。**

### 老师评学生

| 字段 | 类型 |
|------|------|
| rating | 1-5 星 |
| content | 文字（选填） |
| tags | 多选标签：认真准备 / 互动积极 / 作业按时完成 / 需要加强基础 |

**仅学生本人和老师可见**（非公开，作为老师内部参考）。

### 评价规则

| 规则 | 说明 |
|------|------|
| 评价时机 | 课后 24 小时内系统提醒 |
| 评价窗口 | 课后 7 天内，超时不可评 |
| 双方独立 | 一方评价不依赖另一方 |
| 互不可见 | 提交前看不到对方写了什么 |
| 匿名选项 | 学生可选"匿名评价"，老师端显示"匿名学生" |
| 修改 | 提交后 48 小时内可修改一次 |

### 数据模型

**review 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| booking_id | uuid FK → booking.id | |
| from_user_id | uuid FK | 评价人 |
| to_user_id | uuid FK | 被评价人 |
| rating | int | 1-5 |
| content | text | 选填 |
| tags | jsonb | 预设标签 |
| is_anonymous | bool | 仅学生评老师时可用 |
| created_at | timestamp | |
| updated_at | timestamp | |

---

## 子系统 7：通知系统

### 通知类型

| 触发事件 | 通知对象 | 渠道 |
|---------|---------|------|
| 课包购买成功 | 学生 | 站内 + 邮件 |
| 预约成功 | 学生 + 老师 | 站内 + 邮件 |
| 预约取消 | 学生 + 老师 | 站内 + 邮件 |
| 上课提醒（课前 1h / 15min） | 学生 + 老师 | 站内 + 邮件 |
| 课后评价提醒 | 学生 + 老师 | 站内 + 邮件 |
| 余额即将到期（剩余 7 天） | 学生 | 站内 + 邮件 |
| 老师入驻审核通过/拒绝 | 老师 | 站内 + 邮件 |
| 结算已打款 | 老师 | 站内 + 邮件 |
| 新老师入驻申请 | 管理员 | 站内 |

### 通知渠道

| 渠道 | 实现 |
|------|------|
| 站内消息 | 平台消息中心 + 红点未读标记 |
| 邮件 | SMTP / Resend |

短信暂不做，后期按需追加。

### 数据模型

**notification 表：**

| 字段 | 类型 | 说明 |
|------|------|------|
| id | uuid PK | |
| user_id | uuid FK | 接收人 |
| type | varchar | 通知类型 |
| title | varchar | |
| content | text | |
| is_read | bool | 默认 false |
| related_type | varchar | booking / order / settlement / review |
| related_id | uuid | 关联对象 ID，方便跳转 |
| channel | enum | in_app / email |
| sent_at | timestamp | |
| created_at | timestamp | |

---

## 子系统 8：管理后台

### 功能模块

| 模块 | 功能 |
|------|------|
| 用户管理 | 查看/搜索/筛选所有用户，查看详情，启用/停用 |
| 老师审核 | 审核入驻申请，通过/拒绝 |
| 课包管理 | 创建/编辑/上架/下架课包 |
| 订单管理 | 查看购买记录，支付状态 |
| 结算管理 | 查看结算单，审核通过，标记已打款，配置绩效规则 |
| 预约管理 | 查看所有预约，处理异常（no_show 等） |
| 数据报表 | 核心指标仪表盘 |

### 数据报表指标

| 指标 | 说明 |
|------|------|
| 本月收入 | 课包销售总额 |
| 本月课时完成量 | 所有老师完成课时总数 |
| 平台利润 | 收入 - 老师结算支出 |
| 活跃学生数 | 本月至少有一节课的学生数 |
| 活跃老师数 | 本月至少有一节课的老师数 |
| 课包销量排行 | 各课包销售对比 |
| 学生续购率 | 购买 ≥2 次的学生占比（至少续购过一次） |
| 平台好评率 | 整体评价情况 |

### 技术实现

管理后台与平台共享后端 API，通过 `role: admin` 权限控制。前端独立路由分组 `/admin/*`。

---

## 子系统 9：对外官网

### 定位

公开营销页面，与平台主体分离。SEO 友好（SSR），引导访客注册。

### 页面结构

```
首页
├── Hero 区        工作室名称 + Slogan + CTA
├── 课程介绍        PTE Academic / PTE Core / 雅思
├── 课包展示        在售课包 + 价格 + 购买按钮
├── 师资展示        老师卡片（头像、姓名、擅长、评分）
├── 学员反馈        精选评价轮播
├── 常见问题        上课方式、退费、有效期等
└── 页脚            联系方式（微信、邮箱）、备案号
```

### 关键交互

| 交互 | 行为 |
|------|------|
| 点击"购买课包" | 跳转至平台 → 登录/注册 → 支付 |
| 点击老师名片 | 查看老师详情（可约时段需登录） |
| "成为老师" | 跳转入驻页面 |

---

## 隐私守则

学生和老师之间联系方式完全隔离：

| 信息 | 学生可见 | 老师可见 | 管理员可见 |
|------|---------|---------|-----------|
| 学生联系方式 | ❌ | ❌ | ✅ |
| 老师联系方式 | ❌ | ❌ | ✅ |
| 学生评价内容 | ✅（公开在老师主页） | ✅（自己收到的） | ✅ |
| 老师评学生内容 | ✅（仅自己） | ✅（仅自己和被评学生） | ✅ |

学生与老师之间的所有沟通由管理员通过微信线下中转，平台不提供学生与老师之间的直接通讯功能。

---

## UI 设计

整体 UI 将在实现阶段通过 `/frontend-design` 命令完成设计。
