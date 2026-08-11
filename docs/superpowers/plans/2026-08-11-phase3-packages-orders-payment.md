# 阶段3：课包 + 订单 + 支付 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development

**Goal:** 管理员创建课包，学生浏览购买，生成支付二维码（微信/支付宝），支付成功后自动创建分类课时余额。

**Tech Stack:** TypeORM entities, 微信支付 Native / 支付宝当面付 API

## 全局约束

- 所有 API `/api/*`，平台 `/app/*`，管理后台 `/admin/*`
- JWT access token 15min + refresh token 7d
- 所有表 UUID 主键
- 学生和老师联系方式隔离
- 订单 30 分钟超时自动过期
- 退费由管理员线下手动处理

---

### Task 1: Package 实体 + CRUD

**Files:**
- Create: `backend/src/packages/package.entity.ts`
- Create: `backend/src/packages/packages.module.ts`
- Create: `backend/src/packages/packages.service.ts`
- Create: `backend/src/packages/packages.controller.ts`
- Create: `backend/src/packages/dto/create-package.dto.ts`

- [ ] Step 1: 创建 package.entity.ts

```typescript
import { Entity, PrimaryGeneratedColumn, Column, CreateDateColumn } from 'typeorm';

export enum PackageStatus { DRAFT = 'draft', ACTIVE = 'active', ARCHIVED = 'archived' }

@Entity('packages')
export class Package {
  @PrimaryGeneratedColumn('uuid') id: string;
  @Column() name: string;
  @Column('int') lesson_count: number;
  @Column('decimal', { precision: 10, scale: 2 }) price: number;
  @Column('int') valid_days: number;
  @Column('jsonb', { default: '[]' }) exam_types: string[];
  @Column('jsonb', { default: '[]' }) skills: string[];
  @Column('text', { nullable: true }) description: string;
  @Column({ type: 'enum', enum: PackageStatus, default: PackageStatus.DRAFT }) status: PackageStatus;
  @CreateDateColumn() created_at: Date;
}
```

- [ ] Step 2: packages.service.ts — findAll(active only for public), findById, create, update, updateStatus
- [ ] Step 3: packages.controller.ts — GET /api/packages (public), GET /api/packages/:id, POST /api/packages (admin), PATCH /api/packages/:id (admin), PATCH /api/packages/:id/status (admin)
- [ ] Step 4: 更新 app.module.ts 导入 PackagesModule

### Task 2: BalanceRecord 实体 + Order 实体

- [ ] Step 1: 创建 balance-record.entity.ts — id, student_id, order_id, exam_types(jsonb), skills(jsonb), total_lessons, remaining, expires_at, created_at
- [ ] Step 2: 创建 order.entity.ts — id, student_id, package_id, amount, pay_channel(enum: wechat/alipay), pay_status(enum: pending/paid/expired/refunded), pay_url, paid_at, expired_at, created_at

### Task 3: 下单 + 支付二维码生成

- [ ] Step 1: 创建 orders/orders.module.ts, orders.service.ts, orders.controller.ts
- [ ] Step 2: POST /api/orders — body: { package_id, pay_channel } → 创建订单 + 生成支付二维码 + 返回 { order_id, amount, pay_url, qr_code_data }
- [ ] Step 3: 支付回调端点 POST /api/orders/payment-callback — 验证签名 → 更新订单 + 创建 balance_record
- [ ] Step 4: 支付二维码生成：微信Native支付和支付宝当面付，开发环境模拟返回假二维码URL

### Task 4: 课包购买前端页面

- [ ] Step 1: 学生端 `/app/packages` — 课包卡片列表 + 购买按钮
- [ ] Step 2: 购买弹窗：选择支付方式（微信/支付宝）→ 生成二维码 → 显示二维码

### Task 5: 管理端课包管理

- [ ] Step 1: `/admin/packages` — 课包列表 + 新建/编辑/上架/下架
- [ ] Step 2: 课包表单：名称、课时数、价格、有效期、考试类型、技能维度、描述

### Task 6: 学生余额显示

- [ ] Step 1: GET /api/users/me/balances — 返回学生当前有效课时余额列表
- [ ] Step 2: 在 `/app/me` 页面显示余额明细
