# 阶段2：用户系统完善 + 老师资料 + 头像上传 + 审核 — 实现计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 完善老师资料编辑（技能标签、考试类型、简介），头像上传（裁剪+压缩+S3），管理员审核老师入驻，学生浏览老师列表。

**Architecture:** 后端新增文件上传模块（multer + S3/OSS），前端新增老师资料编辑页、老师列表页、管理员审核页。头像在前端 canvas 裁剪压缩后上传。

**Tech Stack:** multer（文件上传）、@aws-sdk/client-s3（S3/OSS 存储）、react-image-crop（前端裁剪）、canvas（前端压缩）

## 全局约束

- 学生和老师之间联系方式完全隔离
- 所有 API `/api/*`，平台 `/app/*`，管理后台 `/admin/*`
- JWT access token 15min + refresh token 7d，bcrypt 哈希
- 所有数据库表 UUID 主键
- 头像限制 2MB，存储为 200×200 缩略图
- 老师审核通过前头像为默认占位图

---

### Task 1: 文件上传后端基础设施

**Files:**
- Create: `english-platform/backend/src/upload/upload.module.ts`
- Create: `english-platform/backend/src/upload/upload.controller.ts`
- Create: `english-platform/backend/src/upload/upload.service.ts`
- Create: `english-platform/backend/src/upload/s3.config.ts`
- Modify: `english-platform/backend/src/app.module.ts`

**Interfaces:**
- Produces: `POST /api/upload/avatar` — multipart form, field "file", 返回 `{ url: string }`
- Produces: `UploadService.uploadAvatar(file: Express.Multer.File): Promise<string>`
- 本地开发模式：文件存到 `backend/uploads/` 目录，返回相对路径
- 生产模式：上传到 S3/OSS，返回完整 URL

- [ ] **Step 1: 安装依赖**

```bash
cd english-platform/backend
npm install multer @aws-sdk/client-s3 @aws-sdk/lib-storage
npm install -D @types/multer
```

- [ ] **Step 2: 创建 src/upload/s3.config.ts**

```typescript
import { S3Client } from '@aws-sdk/client-s3';

// 生产环境使用 S3/OSS，开发环境使用本地存储
export function createS3Client(): S3Client | null {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION;
  const accessKeyId = process.env.S3_ACCESS_KEY;
  const secretAccessKey = process.env.S3_SECRET_KEY;

  if (!endpoint || !accessKeyId || !secretAccessKey) {
    return null; // 本地开发模式
  }

  return new S3Client({
    region: region || 'us-east-1',
    endpoint,
    credentials: { accessKeyId, secretAccessKey },
    forcePathStyle: true, // MinIO / 阿里云 OSS 兼容
  });
}
```

- [ ] **Step 3: 创建 src/upload/upload.service.ts**

```typescript
import { Injectable, BadRequestException } from '@nestjs/common';
import { createS3Client } from './s3.config';
import { PutObjectCommand } from '@aws-sdk/client-s3';
import * as path from 'path';
import * as fs from 'fs';
import { v4 as uuid } from 'uuid';

@Injectable()
export class UploadService {
  async uploadAvatar(file: Express.Multer.File): Promise<string> {
    if (!file) throw new BadRequestException('请选择文件');

    // 限制文件类型
    const allowed = ['image/jpeg', 'image/png', 'image/webp'];
    if (!allowed.includes(file.mimetype)) {
      throw new BadRequestException('仅支持 JPG、PNG、WebP 格式');
    }

    // 限制文件大小（2MB，multer 已做初步限制，这里二次确认）
    if (file.size > 2 * 1024 * 1024) {
      throw new BadRequestException('文件大小不能超过 2MB');
    }

    const ext = path.extname(file.originalname) || '.jpg';
    const filename = `avatars/${uuid()}${ext}`;

    const s3 = createS3Client();
    if (s3) {
      // 生产模式：上传到 S3/OSS
      const bucket = process.env.S3_BUCKET || 'english-platform';
      await s3.send(new PutObjectCommand({
        Bucket: bucket,
        Key: filename,
        Body: file.buffer,
        ContentType: file.mimetype,
        ACL: 'public-read',
      }));
      const endpoint = process.env.S3_ENDPOINT;
      return `${endpoint}/${bucket}/${filename}`;
    } else {
      // 开发模式：存本地
      const uploadDir = path.join(__dirname, '..', '..', 'uploads', 'avatars');
      if (!fs.existsSync(uploadDir)) {
        fs.mkdirSync(uploadDir, { recursive: true });
      }
      const filepath = path.join(uploadDir, `${uuid()}${ext}`);
      fs.writeFileSync(filepath, file.buffer);
      return `/uploads/avatars/${path.basename(filepath)}`;
    }
  }
}
```

- [ ] **Step 4: 创建 src/upload/upload.controller.ts**

```typescript
import { Controller, Post, UseGuards, UseInterceptors, UploadedFile } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { JwtAuthGuard } from '../common/guards/jwt-auth.guard';
import { UploadService } from './upload.service';

@Controller('upload')
export class UploadController {
  constructor(private uploadService: UploadService) {}

  @Post('avatar')
  @UseGuards(JwtAuthGuard)
  @UseInterceptors(FileInterceptor('file', {
    limits: { fileSize: 2 * 1024 * 1024 }, // 2MB
  }))
  async uploadAvatar(@UploadedFile() file: Express.Multer.File) {
    const url = await this.uploadService.uploadAvatar(file);
    return { url };
  }
}
```

- [ ] **Step 5: 创建 src/upload/upload.module.ts**

```typescript
import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import { UploadController } from './upload.controller';
import { UploadService } from './upload.service';

@Module({
  imports: [MulterModule.register({ storage: require('multer').memoryStorage() })],
  controllers: [UploadController],
  providers: [UploadService],
  exports: [UploadService],
})
export class UploadModule {}
```

- [ ] **Step 6: 更新 app.module.ts，导入 UploadModule**

在 `app.module.ts` 的 imports 数组中添加 `UploadModule`。

- [ ] **Step 7: 更新 backend/.env，添加 S3 配置（可选）**

```
# S3/OSS 配置（生产环境才需要，开发环境留空即使用本地存储）
S3_ENDPOINT=
S3_REGION=
S3_ACCESS_KEY=
S3_SECRET_KEY=
S3_BUCKET=english-platform
```

- [ ] **Step 8: 提交**

```bash
git add backend/src/upload/ backend/src/app.module.ts backend/.env backend/package.json
git commit -m "feat: add avatar upload endpoint with local/S3 storage"
```

---

### Task 2: 头像上传前端组件

**Files:**
- Create: `english-platform/frontend/src/components/ui/AvatarUpload.tsx`
- Add: `package.json` 中无需额外依赖（用原生 canvas 裁剪 + fetch 上传）

**Interfaces:**
- Consumes: `POST /api/upload/avatar`（Task 1）
- Produces: `<AvatarUpload currentUrl={string} onUploaded={(url) => void} />`

- [ ] **Step 1: 创建 AvatarUpload.tsx**

```tsx
'use client';
import { useState, useRef } from 'react';
import api from '@/lib/api';

interface AvatarUploadProps {
  currentUrl?: string;
  onUploaded: (url: string) => void;
}

export function AvatarUpload({ currentUrl, onUploaded }: AvatarUploadProps) {
  const [preview, setPreview] = useState(currentUrl || '');
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef<HTMLInputElement>(null);

  async function handleFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setError('');

    // 检查类型
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
      setError('仅支持 JPG、PNG、WebP');
      return;
    }

    // 检查大小
    if (file.size > 2 * 1024 * 1024) {
      setError('文件不能超过 2MB');
      return;
    }

    // Canvas 裁剪为 200x200 正方形
    try {
      const cropped = await cropToSquare(file, 200);
      setPreview(cropped.dataUrl);

      // 上传
      setUploading(true);
      const formData = new FormData();
      const blob = dataURLtoBlob(cropped.dataUrl);
      formData.append('file', blob, 'avatar.jpg');

      const { data } = await api.post('/upload/avatar', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      onUploaded(data.url);
    } catch (err: any) {
      setError(err.response?.data?.message || '上传失败');
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        onClick={() => fileRef.current?.click()}
        className="w-32 h-32 rounded-full border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer overflow-hidden hover:border-blue-400 transition-colors"
      >
        {preview ? (
          <img src={preview} alt="头像" className="w-full h-full object-cover" />
        ) : (
          <span className="text-gray-400 text-xs text-center">点击上传<br/>200×200</span>
        )}
      </div>
      {uploading && <span className="text-xs text-blue-500">上传中...</span>}
      {error && <span className="text-xs text-red-500">{error}</span>}
      <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={handleFile} />
    </div>
  );
}

// Canvas 裁剪为正方形
function cropToSquare(file: File, size: number): Promise<{ dataUrl: string }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const min = Math.min(img.width, img.height);
      const sx = (img.width - min) / 2;
      const sy = (img.height - min) / 2;
      const canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      const ctx = canvas.getContext('2d')!;
      ctx.drawImage(img, sx, sy, min, min, 0, 0, size, size);
      resolve({ dataUrl: canvas.toDataURL('image/jpeg', 0.85) });
    };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

function dataURLtoBlob(dataUrl: string): Blob {
  const parts = dataUrl.split(',');
  const mime = parts[0].match(/:(.*?);/)![1];
  const bytes = atob(parts[1]);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/components/ui/AvatarUpload.tsx
git commit -m "feat: add avatar upload component with crop and compress"
```

---

### Task 3: 老师资料编辑页面

**Files:**
- Create: `english-platform/backend/src/users/dto/update-teacher-profile.dto.ts`
- Modify: `english-platform/backend/src/users/users.controller.ts`（添加 PATCH /api/users/teacher-profile）
- Modify: `english-platform/backend/src/users/users.service.ts`（添加 updateTeacherProfile 方法）
- Create: `english-platform/frontend/src/app/app/profile/page.tsx`

**Interfaces:**
- Consumes: `AvatarUpload`（Task 2）、`/api/users/me`（Phase 1）
- Produces: `PATCH /api/users/teacher-profile` — body: { display_name?, intro?, exam_types?, skills?, tags?, avatar_url? }
- Produces: `/app/profile` — 资料编辑页

- [ ] **Step 1: 创建 update-teacher-profile.dto.ts**

```typescript
import { IsArray, IsOptional, IsString } from 'class-validator';

export class UpdateTeacherProfileDto {
  @IsString()
  @IsOptional()
  display_name?: string;

  @IsString()
  @IsOptional()
  intro?: string;

  @IsArray()
  @IsOptional()
  exam_types?: string[];

  @IsArray()
  @IsOptional()
  skills?: string[];

  @IsArray()
  @IsOptional()
  tags?: string[];

  @IsString()
  @IsOptional()
  avatar_url?: string;
}
```

- [ ] **Step 2: 在 users.service.ts 添加 updateTeacherProfile 方法**

```typescript
async updateTeacherProfile(userId: string, dto: UpdateTeacherProfileDto) {
  const profile = await this.teacherProfileRepository.findOne({ where: { user_id: userId } });
  if (!profile) throw new NotFoundException('老师资料不存在');

  Object.assign(profile, dto);
  return this.teacherProfileRepository.save(profile);
}
```

注入 `NotFoundException`：在顶部 import 中添加。

- [ ] **Step 3: 在 users.controller.ts 添加 PATCH 端点**

```typescript
@Patch('teacher-profile')
@UseGuards(JwtAuthGuard)
async updateTeacherProfile(@CurrentUser() user: User, @Body() dto: UpdateTeacherProfileDto) {
  if (user.role !== 'teacher') throw new ForbiddenException('仅老师可编辑资料');
  return this.usersService.updateTeacherProfile(user.id, dto);
}
```

注入 `ForbiddenException`、`Patch`、`Body` 到 import。

- [ ] **Step 4: 创建资料编辑页 src/app/app/profile/page.tsx**

```tsx
'use client';
import { useState, useEffect } from 'react';
import { useAuth } from '@/hooks/useAuth';
import { useRouter } from 'next/navigation';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { AvatarUpload } from '@/components/ui/AvatarUpload';

const EXAM_TYPES = [
  { value: 'PTE-A', label: 'PTE Academic' },
  { value: 'PTE-C', label: 'PTE Core' },
  { value: 'IELTS', label: '雅思' },
];

const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

export default function ProfilePage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  const [form, setForm] = useState({
    display_name: '',
    intro: '',
    exam_types: [] as string[],
    skills: [] as string[],
    tags: [] as string[],
    avatar_url: '',
  });

  useEffect(() => {
    if (!loading && user?.role !== 'teacher') {
      router.push('/app');
    }
    if (user?.teacherProfile) {
      setForm({
        display_name: user.teacherProfile.display_name || '',
        intro: user.teacherProfile.intro || '',
        exam_types: user.teacherProfile.exam_types || [],
        skills: user.teacherProfile.skills || [],
        tags: user.teacherProfile.tags || [],
        avatar_url: user.teacherProfile.avatar_url || '',
      });
    }
  }, [user, loading]);

  function toggle(arr: string[], val: string): string[] {
    return arr.includes(val) ? arr.filter((v) => v !== val) : [...arr, val];
  }

  async function handleSave() {
    setSaving(true);
    setMessage('');
    try {
      await api.patch('/users/teacher-profile', form);
      setMessage('保存成功');
    } catch (err: any) {
      setMessage(err.response?.data?.message || '保存失败');
    } finally {
      setSaving(false);
    }
  }

  if (loading || user?.role !== 'teacher') return null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">编辑资料</h1>

      {/* 头像 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-2">头像</label>
        <AvatarUpload
          currentUrl={form.avatar_url}
          onUploaded={(url) => setForm((f) => ({ ...f, avatar_url: url }))}
        />
      </div>

      {/* 展示名 */}
      <Input
        label="对外展示名"
        value={form.display_name}
        onChange={(e) => setForm((f) => ({ ...f, display_name: e.target.value }))}
        className="mb-4"
      />

      {/* 个人简介 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-1">个人简介</label>
        <textarea
          value={form.intro}
          onChange={(e) => setForm((f) => ({ ...f, intro: e.target.value }))}
          rows={4}
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="介绍你的教学经验、风格..."
        />
      </div>

      {/* 考试类型 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">擅长考试类型</label>
        <div className="flex gap-2 flex-wrap">
          {EXAM_TYPES.map((et) => (
            <Chip
              key={et.value}
              label={et.label}
              active={form.exam_types.includes(et.value)}
              onClick={() => setForm((f) => ({ ...f, exam_types: toggle(f.exam_types, et.value) }))}
            />
          ))}
        </div>
      </div>

      {/* 技能维度 */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">擅长技能</label>
        <div className="flex gap-2 flex-wrap">
          {SKILLS.map((s) => (
            <Chip
              key={s.value}
              label={s.label}
              active={form.skills.includes(s.value)}
              onClick={() => setForm((f) => ({ ...f, skills: toggle(f.skills, s.value) }))}
            />
          ))}
        </div>
      </div>

      {/* 标签 */}
      <div className="mb-6">
        <label className="block text-sm font-medium text-gray-700 mb-1">标签（用逗号分隔）</label>
        <input
          type="text"
          value={form.tags.join(', ')}
          onChange={(e) =>
            setForm((f) => ({
              ...f,
              tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean),
            }))
          }
          placeholder="如：口语专家, 7分保底, 十年教龄"
          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {message && (
        <p className={`text-sm mb-4 ${message === '保存成功' ? 'text-green-600' : 'text-red-500'}`}>
          {message}
        </p>
      )}
      <Button onClick={handleSave} disabled={saving}>{saving ? '保存中...' : '保存'}</Button>
    </div>
  );
}

function Chip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`px-3 py-1.5 text-sm rounded-full border transition-colors ${
        active ? 'bg-blue-600 text-white border-blue-600' : 'bg-white text-gray-600 border-gray-300 hover:border-blue-400'
      }`}
    >
      {label}
    </button>
  );
}
```

- [ ] **Step 5: 在导航栏添加"编辑资料"入口**

修改 `frontend/src/app/app/layout.tsx`，在 nav 的老师端部分添加：

```tsx
<Link href="/app/profile" className="text-sm text-gray-500 hover:text-blue-600">编辑资料</Link>
```

- [ ] **Step 6: 提交**

```bash
git add backend/src/users/ frontend/src/app/app/profile/ frontend/src/app/app/layout.tsx
git commit -m "feat: add teacher profile editing with avatar upload"
```

---

### Task 4: 老师列表页（学生浏览）

**Files:**
- Modify: `english-platform/backend/src/users/users.controller.ts`（添加 GET /api/users/teachers）
- Modify: `english-platform/backend/src/users/users.service.ts`（添加 listTeachers 方法）
- Create: `english-platform/frontend/src/app/app/teachers/page.tsx`

**Interfaces:**
- Produces: `GET /api/users/teachers?exam_types=PTE-A&skills=speaking` — 公开列表，只看已通过的老师
- Produces: `/app/teachers` — 老师卡片列表 + 筛选

- [ ] **Step 1: 在 users.service.ts 添加 listTeachers**

```typescript
async listTeachers(filters: { exam_types?: string[]; skills?: string[] }) {
  const qb = this.teacherProfileRepository
    .createQueryBuilder('profile')
    .leftJoinAndSelect('profile.user', 'user')
    .where('profile.review_status = :status', { status: ReviewStatus.APPROVED });

  if (filters.exam_types?.length) {
    qb.andWhere('profile.exam_types @> :examTypes', { examTypes: JSON.stringify(filters.exam_types) });
  }
  if (filters.skills?.length) {
    qb.andWhere('profile.skills @> :skills', { skills: JSON.stringify(filters.skills) });
  }

  const profiles = await qb.getMany();
  return profiles.map((p) => ({
    id: p.id,
    display_name: p.display_name,
    avatar_url: p.avatar_url,
    intro: p.intro,
    exam_types: p.exam_types,
    skills: p.skills,
    tags: p.tags,
    // 脱敏：不返回 user.email、user.phone
    review_status: p.review_status,
  }));
}
```

- [ ] **Step 2: 在 users.controller.ts 添加 GET /teachers**

```typescript
@Get('teachers')
async listTeachers(@Query('exam_types') exam_types?: string, @Query('skills') skills?: string) {
  return this.usersService.listTeachers({
    exam_types: exam_types ? exam_types.split(',') : undefined,
    skills: skills ? skills.split(',') : undefined,
  });
}
```

导入 `Query`。

- [ ] **Step 3: 创建老师列表页 src/app/app/teachers/page.tsx**

```tsx
'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import Link from 'next/link';

const EXAM_TYPES = ['PTE-A', 'PTE-C', 'IELTS'];
const SKILLS = [
  { value: 'speaking', label: '口语' },
  { value: 'writing', label: '写作' },
  { value: 'reading', label: '阅读' },
  { value: 'listening', label: '听力' },
];

export default function TeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filterExam, setFilterExam] = useState('');
  const [filterSkill, setFilterSkill] = useState('');

  async function fetchTeachers() {
    setLoading(true);
    const params = new URLSearchParams();
    if (filterExam) params.set('exam_types', filterExam);
    if (filterSkill) params.set('skills', filterSkill);
    try {
      const { data } = await api.get(`/users/teachers?${params}`);
      setTeachers(data);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { fetchTeachers(); }, [filterExam, filterSkill]);

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">老师列表</h1>

      {/* 筛选 */}
      <div className="flex gap-4 mb-6 flex-wrap">
        <select value={filterExam} onChange={(e) => setFilterExam(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">全部考试类型</option>
          {EXAM_TYPES.map((et) => (<option key={et} value={et}>{et}</option>))}
        </select>
        <select value={filterSkill} onChange={(e) => setFilterSkill(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm">
          <option value="">全部技能</option>
          {SKILLS.map((s) => (<option key={s.value} value={s.value}>{s.label}</option>))}
        </select>
      </div>

      {/* 老师卡片 */}
      {loading ? (
        <p className="text-gray-500">加载中...</p>
      ) : teachers.length === 0 ? (
        <p className="text-gray-500">暂无符合条件的老师</p>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {teachers.map((t) => (
            <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-6 hover:shadow-md transition-shadow">
              <div className="flex items-center gap-4 mb-4">
                <img
                  src={t.avatar_url || '/default-avatar.png'}
                  alt={t.display_name}
                  className="w-16 h-16 rounded-full object-cover bg-gray-100"
                />
                <div>
                  <h3 className="font-bold text-lg">{t.display_name}</h3>
                </div>
              </div>
              <p className="text-sm text-gray-500 mb-3 line-clamp-2">{t.intro || '暂无简介'}</p>
              <div className="flex gap-1 flex-wrap mb-2">
                {t.exam_types?.map((et: string) => (
                  <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
                ))}
              </div>
              <div className="flex gap-1 flex-wrap">
                {t.skills?.map((s: string) => {
                  const label = SKILLS.find((sk) => sk.value === s)?.label;
                  return <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{label}</span>;
                })}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
```

- [ ] **Step 4: 在导航栏添加"老师列表"入口**

修改 `frontend/src/app/app/layout.tsx`，学生角色时显示 `<Link href="/app/teachers">老师列表</Link>`。

- [ ] **Step 5: 提交**

```bash
git add backend/src/users/ frontend/src/app/app/teachers/ frontend/src/app/app/layout.tsx
git commit -m "feat: add teacher listing with exam type and skill filters"
```

---

### Task 5: 管理员审核老师

**Files:**
- Create: `english-platform/backend/src/users/dto/review-teacher.dto.ts`
- Modify: `english-platform/backend/src/users/users.controller.ts`（添加 PATCH /api/users/teachers/:id/review）
- Modify: `english-platform/backend/src/users/users.service.ts`（添加 reviewTeacher 方法）
- Create: `english-platform/frontend/src/app/admin/teachers/page.tsx`

**Interfaces:**
- Produces: `PATCH /api/users/teachers/:id/review` — body: { review_status: 'approved' | 'rejected', base_rate?: number }
- Produces: `/admin/teachers` — 待审核老师列表 + 审核操作

- [ ] **Step 1: 创建 review-teacher.dto.ts**

```typescript
import { IsEnum, IsNumber, IsOptional, Min } from 'class-validator';
import { ReviewStatus } from '../entities/teacher-profile.entity';

export class ReviewTeacherDto {
  @IsEnum(ReviewStatus)
  review_status: ReviewStatus;

  @IsNumber()
  @Min(0)
  @IsOptional()
  base_rate?: number;
}
```

- [ ] **Step 2: 在 users.service.ts 添加 reviewTeacher 和 listPendingTeachers**

```typescript
async listPendingTeachers() {
  return this.teacherProfileRepository
    .createQueryBuilder('profile')
    .leftJoinAndSelect('profile.user', 'user')
    .where('profile.review_status = :status', { status: ReviewStatus.PENDING })
    .getMany();
}

async reviewTeacher(profileId: string, dto: ReviewTeacherDto) {
  const profile = await this.teacherProfileRepository.findOne({ where: { id: profileId } });
  if (!profile) throw new NotFoundException('老师资料不存在');

  profile.review_status = dto.review_status;
  if (dto.base_rate !== undefined) {
    profile.base_rate = dto.base_rate;
  }

  // 审核通过 → 用户状态改为 active
  if (dto.review_status === ReviewStatus.APPROVED) {
    await this.usersRepository.update(profile.user_id, { status: UserStatus.ACTIVE });
  }

  return this.teacherProfileRepository.save(profile);
}
```

需要在构造函数注入 `usersRepository`：
```typescript
@InjectRepository(User)
private usersRepository: Repository<User>,
```

- [ ] **Step 3: 在 users.controller.ts 添加管理员端点**

```typescript
@Get('admin/teachers/pending')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async listPendingTeachers() {
  return this.usersService.listPendingTeachers();
}

@Patch('teachers/:id/review')
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('admin')
async reviewTeacher(@Param('id') id: string, @Body() dto: ReviewTeacherDto) {
  return this.usersService.reviewTeacher(id, dto);
}
```

导入 `Param`、`Roles`、`RolesGuard`。

- [ ] **Step 4: 创建审核页 src/app/admin/teachers/page.tsx**

```tsx
'use client';
import { useState, useEffect } from 'react';
import api from '@/lib/api';
import { Button } from '@/components/ui/Button';

const SKILL_LABELS: Record<string, string> = {
  speaking: '口语', writing: '写作', reading: '阅读', listening: '听力',
};

export default function AdminTeachersPage() {
  const [teachers, setTeachers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);

  async function fetchTeachers() {
    const { data } = await api.get('/users/admin/teachers/pending');
    setTeachers(data);
    setLoading(false);
  }

  useEffect(() => { fetchTeachers(); }, []);

  async function handleReview(id: string, status: 'approved' | 'rejected') {
    await api.patch(`/users/teachers/${id}/review`, { review_status: status });
    fetchTeachers();
  }

  if (loading) return <p>加载中...</p>;
  if (teachers.length === 0) return <p className="text-gray-500">暂无待审核老师</p>;

  return (
    <div>
      <h1 className="text-2xl font-bold mb-6">老师审核</h1>
      <div className="space-y-4">
        {teachers.map((t) => (
          <div key={t.id} className="bg-white border border-gray-200 rounded-lg p-6">
            <div className="flex justify-between items-start">
              <div>
                <h3 className="font-bold text-lg">{t.display_name}</h3>
                <p className="text-sm text-gray-500">实名：{t.user?.name} | 邮箱：{t.user?.email}</p>
                <p className="text-sm text-gray-600 mt-2">{t.intro || '暂无简介'}</p>
                <div className="flex gap-2 mt-2">
                  {t.exam_types?.map((et: string) => (
                    <span key={et} className="px-2 py-0.5 bg-blue-50 text-blue-700 text-xs rounded">{et}</span>
                  ))}
                  {t.skills?.map((s: string) => (
                    <span key={s} className="px-2 py-0.5 bg-green-50 text-green-700 text-xs rounded">{SKILL_LABELS[s] || s}</span>
                  ))}
                </div>
              </div>
              <div className="flex gap-2">
                <Button size="sm" onClick={() => handleReview(t.id, 'approved')}>通过</Button>
                <Button size="sm" variant="secondary" onClick={() => handleReview(t.id, 'rejected')}>拒绝</Button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
```

- [ ] **Step 5: 在管理导航添加"老师审核"入口**

修改 `frontend/src/app/admin/layout.tsx`，添加：

```tsx
<Link href="/admin/teachers" className="text-sm text-gray-300 hover:text-white">老师审核</Link>
```

- [ ] **Step 6: 提交**

```bash
git add backend/src/users/ frontend/src/app/admin/
git commit -m "feat: add admin teacher review flow"
```

---

### Task 6: 学生个人信息页

**Files:**
- Create: `english-platform/frontend/src/app/app/me/page.tsx`

**Interfaces:**
- Consumes: `GET /api/users/me`（Phase 1）
- Produces: `/app/me` — 显示基本信息 + 课时余额占位

- [ ] **Step 1: 创建 src/app/app/me/page.tsx**

```tsx
'use client';
import { useAuth } from '@/hooks/useAuth';

export default function MePage() {
  const { user } = useAuth();
  if (!user) return null;

  return (
    <div className="max-w-2xl">
      <h1 className="text-2xl font-bold mb-6">个人信息</h1>
      <div className="bg-white border border-gray-200 rounded-lg p-6 space-y-4">
        <InfoRow label="姓名" value={user.name} />
        <InfoRow label="角色" value={user.role === 'student' ? '学生' : user.role === 'teacher' ? '老师' : '管理员'} />
        <InfoRow label="账户状态" value={user.status === 'active' ? '正常' : '待审核'} />
        <InfoRow label="注册时间" value={new Date(user.created_at).toLocaleDateString('zh-CN')} />

        {user.role === 'student' && (
          <div>
            <h3 className="font-medium text-gray-700 mt-6 mb-3">我的课时余额</h3>
            <p className="text-gray-500 text-sm">暂无课时（课包购买功能即将上线）</p>
          </div>
        )}
      </div>
    </div>
  );
}

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-2 border-b border-gray-100 last:border-0">
      <span className="text-sm text-gray-500">{label}</span>
      <span className="text-sm font-medium">{value}</span>
    </div>
  );
}
```

- [ ] **Step 2: 提交**

```bash
git add frontend/src/app/app/me/
git commit -m "feat: add student profile page"
```

---

### Task 7: 路由整合和导航完善

**Files:**
- Modify: `english-platform/frontend/src/app/app/layout.tsx`（整合所有导航入口）
- Modify: `english-platform/frontend/src/app/app/page.tsx`（按角色显示快捷入口）

- [ ] **Step 1: 更新 app/layout.tsx 导航栏**

```tsx
{/* 在 nav 中按角色显示不同导航项 */}
<div className="flex items-center gap-4">
  {user?.role === 'student' && (
    <>
      <Link href="/app/teachers" className="text-sm text-gray-500 hover:text-blue-600">找老师</Link>
      <Link href="/app/me" className="text-sm text-gray-500 hover:text-blue-600">我的</Link>
    </>
  )}
  {user?.role === 'teacher' && (
    <>
      <Link href="/app/profile" className="text-sm text-gray-500 hover:text-blue-600">编辑资料</Link>
      <Link href="/app/me" className="text-sm text-gray-500 hover:text-blue-600">我的</Link>
    </>
  )}
  <span className="text-sm text-gray-400">
    {user?.role === 'teacher' ? (user?.teacherProfile?.display_name || user?.name) : user?.name}
  </span>
</div>
```

- [ ] **Step 2: 更新 app/page.tsx 快捷入口**

```tsx
{user.role === 'student' && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
    <QuickLink href="/app/teachers" title="找老师" desc="浏览老师，选择适合你的课程" />
    <QuickLink href="/app/me" title="我的课时" desc="查看课时余额和预约记录" />
  </div>
)}
{user.role === 'teacher' && (
  <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mt-6">
    <QuickLink href="/app/profile" title="编辑资料" desc="设置技能标签、简介和头像" />
    <QuickLink href="/app/me" title="我的" desc="查看个人信息" />
  </div>
)}

// QuickLink 组件
function QuickLink({ href, title, desc }: { href: string; title: string; desc: string }) {
  return (
    <Link href={href} className="block p-4 bg-white border border-gray-200 rounded-lg hover:border-blue-300 transition-colors">
      <h3 className="font-bold text-lg mb-1">{title}</h3>
      <p className="text-sm text-gray-500">{desc}</p>
    </Link>
  );
}
```

- [ ] **Step 3: 提交**

```bash
git add frontend/src/app/app/
git commit -m "feat: integrate navigation with role-based links and quick actions"
```

---

## 自审

- [x] 每个 Task 可独立测试
- [x] 无 TBD/TODO
- [x] 所有接口签名一致（upload → avatar url → profile save → teacher listing → admin review）
- [x] 全局约束遵守（隐私隔离、JWT、UUID、2MB 限制、200×200 头像）
