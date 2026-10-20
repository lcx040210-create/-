'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import api, {
  AuthUser,
  clearTokens,
  errorMessage,
  setTokens,
  TokenPair,
  XBindingStatus,
} from '@/lib/api';
import { connectWallet, hasWallet, personalSign } from '@/lib/wallet';

interface CurrentTerms {
  id: string;
  version: number;
  title: string;
  content_md: string;
  published_at: string;
}

interface BindingStart {
  code: string;
  handle: string;
  expiresAt: string;
}

type Mode = 'wallet' | 'manual';
type Step = 'login' | 'bind';

const ADDRESS_PATTERN = /^0x[a-fA-F0-9]{40}$/;
const HANDLE_PATTERN = /^@?[A-Za-z0-9_]{1,15}$/;

const STATUS_LABEL: Record<XBindingStatus['status'], string> = {
  none: '未绑定',
  pending: '等待验证',
  active: '已通过',
  manual_review: '人工审核中',
};

export default function LoginPage() {
  const router = useRouter();

  const [step, setStep] = useState<Step>('login');
  const [mode, setMode] = useState<Mode>('wallet');
  const [walletAvailable, setWalletAvailable] = useState(false);

  const [address, setAddress] = useState('');
  const [manualAddress, setManualAddress] = useState('');

  const [terms, setTerms] = useState<CurrentTerms | null>(null);
  const [termsError, setTermsError] = useState('');
  const [agreed, setAgreed] = useState(false);
  const [referralCode, setReferralCode] = useState('');

  const [nonceMessage, setNonceMessage] = useState('');
  const [signature, setSignature] = useState('');

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const [userStatus, setUserStatus] = useState('');
  const [bindingStatus, setBindingStatus] = useState<XBindingStatus['status']>('none');
  const [bindingHandle, setBindingHandle] = useState<string | null>(null);
  const [bindingCode, setBindingCode] = useState('');
  const [handleInput, setHandleInput] = useState('');

  useEffect(() => {
    const available = hasWallet();
    setWalletAvailable(available);
    if (!available) setMode('manual');

    const ref = new URLSearchParams(window.location.search).get('ref');
    if (ref) setReferralCode(ref.trim());
  }, []);

  useEffect(() => {
    let cancelled = false;
    api
      .get<CurrentTerms>('/terms/current')
      .then(({ data }) => {
        if (!cancelled) setTerms(data);
      })
      .catch((err) => {
        if (!cancelled) setTermsError(errorMessage(err, '服务条款加载失败'));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // 绑定阶段每 5 秒轮询一次；active 后进入首页。
  useEffect(() => {
    if (step !== 'bind') return;
    let cancelled = false;

    const poll = async () => {
      try {
        const { data } = await api.get<XBindingStatus>('/bindings/x/status');
        if (cancelled) return;
        setBindingStatus(data.status);
        setBindingHandle(data.handle);
        if (data.status === 'active') {
          router.push('/');
        }
      } catch {
        // 轮询失败忽略，下一轮重试
      }
    };

    void poll();
    const timer = setInterval(poll, 5000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [step, router]);

  function requireConsent(): boolean {
    if (!terms) {
      setError(termsError || '服务条款尚未加载，请稍后重试');
      return false;
    }
    if (!agreed) {
      setError('请先阅读并勾选同意服务条款');
      return false;
    }
    return true;
  }

  async function handleConnect() {
    setError('');
    if (!walletAvailable) {
      setMode('manual');
      setError('未检测到浏览器钱包，请使用手动签名');
      return;
    }
    setBusy(true);
    const account = await connectWallet();
    setBusy(false);
    if (!account) {
      setMode('manual');
      setError('钱包连接失败或已取消，可改用手动签名');
      return;
    }
    setAddress(account);
  }

  async function fetchNonce(addr: string) {
    const { data } = await api.post<{ nonce: string; message: string }>('/auth/nonce', {
      address: addr,
    });
    return data.message;
  }

  async function verifyAndEnter(addr: string, sig: string) {
    if (!terms) throw new Error('服务条款尚未加载');
    const { data } = await api.post<TokenPair>('/auth/verify', {
      address: addr,
      signature: sig,
      termsVersion: terms.version,
      ...(referralCode.trim() ? { referralCode: referralCode.trim() } : {}),
    });
    setTokens(data);
    await enterAfterLogin(data.user);
  }

  async function enterAfterLogin(user: AuthUser) {
    setUserStatus(user.status);

    let binding: XBindingStatus = { status: 'none', handle: null };
    try {
      const { data } = await api.get<XBindingStatus>('/bindings/x/status');
      binding = data;
    } catch {
      // 绑定状态查询失败不阻断登录，进入绑定步骤后可重试
    }
    setBindingStatus(binding.status);
    setBindingHandle(binding.handle);

    if (user.status === 'active' && binding.status === 'active') {
      router.push('/');
      return;
    }

    setStep('bind');
    if (binding.status === 'pending' && binding.handle) {
      setHandleInput(binding.handle);
    }
  }

  async function handleWalletLogin() {
    setError('');
    if (!address) {
      setError('请先连接钱包');
      return;
    }
    if (!requireConsent()) return;

    setBusy(true);
    try {
      const message = await fetchNonce(address);
      setNonceMessage(message);
      const sig = await personalSign(message, address);
      if (!sig) {
        setMode('manual');
        setManualAddress(address);
        setError('签名失败或已取消，可改用手动签名粘贴签名');
        return;
      }
      setSignature(sig);
      await verifyAndEnter(address, sig);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleLoadManualMessage() {
    setError('');
    const addr = manualAddress.trim();
    if (!ADDRESS_PATTERN.test(addr)) {
      setError('请输入 0x 开头的 40 位十六进制钱包地址');
      return;
    }
    if (!requireConsent()) return;

    setBusy(true);
    try {
      const message = await fetchNonce(addr);
      setAddress(addr);
      setNonceMessage(message);
      setSignature('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleManualLogin() {
    setError('');
    if (!address) {
      setError('请先输入地址并获取签名消息');
      return;
    }
    if (!nonceMessage) {
      setError('请先点击「获取签名消息」');
      return;
    }
    if (!signature.trim()) {
      setError('请粘贴钱包签名');
      return;
    }
    if (!requireConsent()) return;

    setBusy(true);
    try {
      await verifyAndEnter(address, signature.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  async function handleStartBinding() {
    setError('');
    const handle = handleInput.trim();
    if (!HANDLE_PATTERN.test(handle)) {
      setError('X handle 格式不正确');
      return;
    }

    setBusy(true);
    try {
      const { data } = await api.post<BindingStart>('/bindings/x/start', { handle });
      setBindingCode(data.code);
      setBindingHandle(data.handle);
      setBindingStatus('pending');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  function handleSwitchWallet() {
    clearTokens();
    window.location.reload();
  }

  const errorBox = error ? <div className="alert-error">{error}</div> : null;

  if (step === 'bind') {
    const suspended = userStatus === 'suspended';
    return (
      <div className="mx-auto max-w-2xl space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">绑定 X 账号</h1>
          <p className="mt-2 text-sm text-slate-600">
            登录成功。完成 X 账号绑定并通过验证后，即可使用任务与钱包功能。
          </p>
        </div>

        {errorBox}

        {suspended ? (
          <div className="card space-y-4">
            <p className="text-sm text-red-700">账号已被封禁，无法绑定 X。如有疑问请联系管理员。</p>
            <button type="button" className="btn-secondary" onClick={handleSwitchWallet}>
              退出登录
            </button>
          </div>
        ) : (
          <div className="card space-y-5">
            {bindingStatus === 'active' ? (
              <div className="alert-info">X 绑定已通过，正在进入首页…</div>
            ) : (
              <>
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm text-slate-500">当前状态</p>
                    <p className="text-lg font-semibold">
                      {STATUS_LABEL[bindingStatus]}
                      {bindingHandle ? (
                        <span className="ml-2 text-sm font-normal text-slate-500">
                          @{bindingHandle}
                        </span>
                      ) : null}
                    </p>
                  </div>
                  <span className="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-600">
                    每 5 秒自动检测
                  </span>
                </div>

                {bindingCode ? (
                  <div className="space-y-4 rounded-xl border border-indigo-200 bg-indigo-50 p-4">
                    <div>
                      <p className="text-sm text-indigo-900">你的验证码</p>
                      <p className="mt-1 font-mono text-2xl font-bold tracking-wider text-indigo-700">
                        {bindingCode}
                      </p>
                    </div>
                    <div className="space-y-2 text-sm leading-6 text-indigo-900">
                      <p className="font-medium">任选一种方式完成验证：</p>
                      <p>
                        1. 打开 X，进入「个人资料 → 编辑资料」，把验证码加入简介（bio）并保存；
                      </p>
                      <p>2. 或发布一条公开推文，正文包含该验证码。</p>
                      <p className="text-xs text-indigo-700">
                        验证码 24 小时内有效。请保持账号公开，验证通常在一分钟内完成。
                      </p>
                    </div>
                  </div>
                ) : bindingStatus === 'pending' ? (
                  <div className="alert-info">
                    已发起绑定 @{bindingHandle}，请在 X 简介或推文中保留验证码。若验证码遗失，
                    可在下方重新获取。
                  </div>
                ) : (
                  <div className="alert-info">
                    请输入要绑定的 X 账号，并按照提示把验证码写入 X 简介或推文。
                  </div>
                )}

                {bindingStatus === 'manual_review' ? (
                  <div className="alert-info">
                    自动验证未通过，已进入人工审核。请保留含验证码的简介或推文，审核通过后自动进入首页。
                  </div>
                ) : null}

                <form
                  className="space-y-3 border-t border-slate-200 pt-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleStartBinding();
                  }}
                >
                  <label className="label" htmlFor="x-handle">
                    {bindingStatus === 'pending' ? '更换 handle / 重新获取验证码' : 'X handle'}
                  </label>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <input
                      id="x-handle"
                      className="input"
                      placeholder="例如 @your_handle（可省略 @）"
                      value={handleInput}
                      onChange={(event) => setHandleInput(event.target.value)}
                      disabled={busy}
                    />
                    <button type="submit" className="btn-primary sm:w-40" disabled={busy}>
                      {busy ? '提交中…' : bindingStatus === 'pending' ? '重新获取' : '开始绑定'}
                    </button>
                  </div>
                </form>
              </>
            )}

            <button
              type="button"
              className="text-sm text-slate-500 underline-offset-2 hover:text-slate-700 hover:underline"
              onClick={handleSwitchWallet}
            >
              使用其他钱包登录
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">登录 / 注册</h1>
        <p className="mt-2 text-sm text-slate-600">
          使用钱包签名登录，无需密码。首次登录将自动创建账号。
        </p>
      </div>

      {errorBox}

      <section className="card space-y-4">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-base font-semibold">1. 连接钱包</h2>
          <div className="flex rounded-lg border border-slate-200 p-0.5 text-xs">
            <button
              type="button"
              className={`rounded-md px-3 py-1 transition ${
                mode === 'wallet' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
              onClick={() => {
                setMode('wallet');
                setError('');
              }}
            >
              浏览器钱包
            </button>
            <button
              type="button"
              className={`rounded-md px-3 py-1 transition ${
                mode === 'manual' ? 'bg-slate-900 text-white' : 'text-slate-600'
              }`}
              onClick={() => {
                setMode('manual');
                setError('');
              }}
            >
              手动签名
            </button>
          </div>
        </div>

        {mode === 'wallet' ? (
          <div className="space-y-3">
            {address ? (
              <div className="alert-info break-all font-mono text-xs">已连接：{address}</div>
            ) : null}
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleConnect()}
              disabled={busy}
            >
              {address ? '重新连接钱包' : busy ? '连接中…' : '连接钱包'}
            </button>
            {!walletAvailable ? (
              <p className="text-xs text-slate-500">
                未检测到浏览器钱包（如 MetaMask）。请安装后刷新页面，或切换到「手动签名」。
              </p>
            ) : null}
          </div>
        ) : (
          <div className="space-y-2">
            <label className="label" htmlFor="manual-address">
              钱包地址
            </label>
            <input
              id="manual-address"
              className="input font-mono"
              placeholder="0x…（40 位十六进制）"
              value={manualAddress}
              onChange={(event) => {
                setManualAddress(event.target.value);
                setNonceMessage('');
                setSignature('');
              }}
              disabled={busy}
            />
            <p className="text-xs text-slate-500">
              无法唤起钱包时使用：先在下方获取签名消息，在任意钱包中对该消息签名，再粘贴签名登录。
            </p>
          </div>
        )}
      </section>

      <section className="card space-y-4">
        <h2 className="text-base font-semibold">2. 服务条款</h2>

        {termsError ? <div className="alert-error">{termsError}</div> : null}
        {!terms && !termsError ? (
          <p className="text-sm text-slate-500">正在加载服务条款…</p>
        ) : null}

        {terms ? (
          <>
            <div className="rounded-lg bg-slate-50 p-3">
              <p className="text-sm font-medium text-slate-800">
                {terms.title}
                <span className="ml-2 text-xs font-normal text-slate-500">
                  版本 {terms.version}
                </span>
              </p>
              <details className="mt-2">
                <summary className="cursor-pointer text-sm text-indigo-600 hover:text-indigo-700">
                  查看条款全文
                </summary>
                <pre className="mt-3 max-h-64 overflow-y-auto whitespace-pre-wrap break-words text-xs leading-5 text-slate-600">
                  {terms.content_md}
                </pre>
              </details>
            </div>

            <label className="flex items-start gap-2 text-sm text-slate-700">
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
                checked={agreed}
                onChange={(event) => setAgreed(event.target.checked)}
              />
              <span>
                我已阅读并同意《{terms.title}》（版本 {terms.version}）
              </span>
            </label>
          </>
        ) : null}

        <div>
          <label className="label" htmlFor="referral-code">
            邀请码（选填）
          </label>
          <input
            id="referral-code"
            className="input uppercase"
            placeholder="6 位邀请码"
            value={referralCode}
            onChange={(event) => setReferralCode(event.target.value)}
            disabled={busy}
          />
          <p className="mt-1 text-xs text-slate-500">通过邀请链接进入时会自动填入。</p>
        </div>
      </section>

      <section className="card space-y-4">
        <h2 className="text-base font-semibold">3. 签名登录</h2>

        {mode === 'wallet' ? (
          <>
            <p className="text-sm text-slate-600">
              点击后钱包会弹出签名请求。签名仅用于证明地址归属，不产生链上交易。
            </p>
            <button
              type="button"
              className="btn-primary"
              onClick={() => void handleWalletLogin()}
              disabled={busy || !address}
            >
              {busy ? '处理中…' : '签名并登录'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void handleLoadManualMessage()}
              disabled={busy}
            >
              {busy ? '获取中…' : '获取签名消息'}
            </button>

            {nonceMessage ? (
              <div className="space-y-3">
                <div>
                  <p className="label">待签名消息</p>
                  <textarea
                    className="input min-h-[88px] resize-y font-mono text-xs"
                    readOnly
                    value={nonceMessage}
                  />
                </div>
                <div>
                  <label className="label" htmlFor="manual-signature">
                    签名结果
                  </label>
                  <textarea
                    id="manual-signature"
                    className="input min-h-[88px] resize-y font-mono text-xs"
                    placeholder="粘贴 personal_sign 返回的签名（0x…）"
                    value={signature}
                    onChange={(event) => setSignature(event.target.value)}
                    disabled={busy}
                  />
                </div>
                <button
                  type="button"
                  className="btn-primary"
                  onClick={() => void handleManualLogin()}
                  disabled={busy}
                >
                  {busy ? '验证中…' : '提交签名登录'}
                </button>
              </div>
            ) : null}
          </>
        )}
      </section>
    </div>
  );
}
