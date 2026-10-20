'use client';

import { useCallback, useEffect, useState } from 'react';
import { ConfirmDialog, PageHeader, Pill } from '@/components/admin/ui';
import adminApi from '@/lib/admin-api';
import { errorMessage } from '@/lib/api';
import { formatDateTime } from '@/lib/orders';

interface TermView {
  id: string;
  version: number;
  title: string;
  content_md: string;
  published_at: string;
}

export default function AdminTermsPage() {
  const [current, setCurrent] = useState<TermView | null>(null);
  const [title, setTitle] = useState('');
  const [contentMd, setContentMd] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const { data } = await adminApi.get<TermView>('/terms/current');
      setCurrent(data);
      setTitle(data.title);
      setContentMd(data.content_md);
    } catch (err) {
      setError(errorMessage(err, '加载当前条款失败'));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openConfirm() {
    setError('');
    if (!title.trim()) {
      setError('条款标题不能为空');
      return;
    }
    if (!contentMd.trim()) {
      setError('条款内容不能为空');
      return;
    }
    setConfirming(true);
  }

  async function handlePublish() {
    setBusy(true);
    setError('');
    try {
      const { data } = await adminApi.post<TermView>('/admin/terms', {
        title: title.trim(),
        contentMd,
      });
      setCurrent(data);
      setTitle(data.title);
      setContentMd(data.content_md);
      setConfirming(false);
      setNotice(`已发布新版本 v${data.version}。用户下次登录需重新同意条款。`);
    } catch (err) {
      const message = errorMessage(err, '发布条款失败');
      setError(message);
    } finally {
      setBusy(false);
    }
  }

  const nextVersion = current ? current.version + 1 : 1;
  const dirty =
    !!current && (title !== current.title || contentMd !== current.content_md);

  return (
    <div className="space-y-4">
      <PageHeader
        title="服务条款"
        description="编辑 Markdown 并发布新版本；版本号由后端自动 +1，所有用户下次登录需重新同意。"
        actions={
          <button
            type="button"
            className="btn-secondary py-1.5"
            onClick={() => void load()}
            disabled={loading || busy}
          >
            重新加载
          </button>
        }
      />

      {error ? <div className="alert-error">{error}</div> : null}
      {notice ? <div className="alert-info">{notice}</div> : null}

      {current ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-slate-600">
          <Pill tone="indigo">当前版本 v{current.version}</Pill>
          <span>标题：{current.title}</span>
          <span className="text-slate-400">发布于 {formatDateTime(current.published_at)}</span>
          {dirty ? <Pill tone="amber">有未发布的修改</Pill> : null}
        </div>
      ) : null}

      {loading ? <p className="text-sm text-slate-500">正在加载当前条款…</p> : null}

      {current ? (
        <div className="grid gap-4 lg:grid-cols-2">
          <section className="card space-y-3">
            <h2 className="text-base font-semibold text-slate-900">编辑</h2>
            <div>
              <label className="label" htmlFor="terms-title">
                标题
              </label>
              <input
                id="terms-title"
                className="input"
                value={title}
                maxLength={200}
                onChange={(event) => setTitle(event.target.value)}
                disabled={busy}
              />
            </div>
            <div>
              <label className="label" htmlFor="terms-content">
                Markdown 内容
              </label>
              <textarea
                id="terms-content"
                className="input min-h-[420px] resize-y font-mono text-xs leading-5"
                value={contentMd}
                onChange={(event) => setContentMd(event.target.value)}
                disabled={busy}
              />
              <p className="mt-1 text-xs text-slate-500">
                {contentMd.length} 字符 · 支持 Markdown，前台登录页按纯文本展示全文。
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn-primary"
                disabled={busy || !dirty}
                onClick={openConfirm}
              >
                发布新版本 v{nextVersion}…
              </button>
              <button
                type="button"
                className="btn-secondary"
                disabled={busy || !dirty}
                onClick={() => {
                  setTitle(current.title);
                  setContentMd(current.content_md);
                  setError('');
                }}
              >
                放弃修改
              </button>
            </div>
          </section>

          <section className="card space-y-3">
            <h2 className="text-base font-semibold text-slate-900">预览</h2>
            <div className="rounded-lg border border-slate-200 bg-slate-50 p-4">
              <p className="text-sm font-semibold text-slate-900">{title || '（无标题）'}</p>
              <pre className="mt-3 max-h-[520px] overflow-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                {contentMd || '（无内容）'}
              </pre>
            </div>
          </section>
        </div>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="确认发布新版本？"
        danger
        busy={busy}
        confirmLabel={`发布 v${nextVersion}`}
        onCancel={() => {
          if (!busy) setConfirming(false);
        }}
        onConfirm={() => void handlePublish()}
        description={
          current ? (
            <div className="space-y-1">
              <p>
                当前版本 <strong>v{current.version}</strong> 将停用，发布后版本号自动变为{' '}
                <strong>v{nextVersion}</strong>。
              </p>
              <p className="text-amber-700">
                所有用户下次登录时必须重新阅读并同意新条款；旧版本保留历史记录。
              </p>
              <p className="text-xs text-slate-500">
                标题：{title.trim()} · 正文 {contentMd.length} 字符
              </p>
              {error ? <div className="alert-error">{error}</div> : null}
            </div>
          ) : null
        }
      />
    </div>
  );
}
