/** 登录 / 注册：同一张纸，两种写法 */
import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { AUTH } from '@shared/constants';
import { safeNext } from '@/components/guards';
import { Button, Field, Input, Notice, errorText } from '@/components/ui';
import { BrandMark } from '@/components/Layout';
import { useOnline } from '@/lib/hooks';
import { useAuth } from '@/stores/auth';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const isLogin = mode === 'login';
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const online = useOnline();
  const { login, register, offlineAtBoot } = useAuth();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [formError, setFormError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  function validate(): Record<string, string> {
    const e: Record<string, string> = {};
    if (!EMAIL_RE.test(email.trim())) e.email = '请输入有效的邮箱地址';
    if (!isLogin) {
      if (password.length < AUTH.passwordMinLength) e.password = `密码至少 ${AUTH.passwordMinLength} 位`;
      if (!displayName.trim()) e.displayName = '请填写昵称';
    } else if (!password) e.password = '请输入密码';
    return e;
  }

  async function onSubmit(ev: FormEvent) {
    ev.preventDefault();
    const e = validate();
    setErrors(e);
    setFormError(null);
    if (Object.keys(e).length) return;
    setBusy(true);
    try {
      if (isLogin) await login(email.trim(), password);
      else await register(email.trim(), password, displayName.trim());
      navigate(safeNext(params.get('next')), { replace: true });
    } catch (err) {
      setFormError(errorText(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="grid min-h-dvh place-items-center px-4 py-10">
      <div className="w-full max-w-sm">
        {/* 站名牌：这条线的起点站 */}
        <header className="mb-6 overflow-hidden rounded-2xl bg-surface text-center lift">
          <div className="px-5 pb-4 pt-6">
            <BrandMark className="mx-auto mb-3 h-11 px-2.5 text-lg" />
            <h1 lang="ja" className="text-[30px] font-black leading-tight tracking-wide">一駅</h1>
            <p className="text-sm font-semibold text-ink-2">每天一站，学到终点</p>
            <p lang="ja" className="mt-1 text-sm text-ink-3">{isLogin ? 'おかえりなさい。今日も一駅ずつ。' : 'はじめまして。一緒に出発しましょう。'}</p>
          </div>
          <div className="font-sign flex items-center justify-between bg-go px-4 py-2 text-sm font-semibold text-go-ink">
            <span lang="ja">← にほんご</span>
            <span>JP 01</span>
            <span lang="ja">ターミナル →</span>
          </div>
        </header>

        <form onSubmit={onSubmit} noValidate className="space-y-4 rounded-2xl bg-surface p-5 lift">
          {(!online || offlineAtBoot) && <Notice tone="warn">当前无法连接服务器，联网后再登录</Notice>}
          {formError && <Notice tone="error">{formError}</Notice>}

          {!isLogin && (
            <Field label="昵称" error={errors.displayName}>
              <Input value={displayName} onChange={(e) => setDisplayName(e.target.value)} maxLength={40} autoComplete="nickname" />
            </Field>
          )}
          <Field label="邮箱" error={errors.email}>
            <Input
              type="email"
              inputMode="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              autoComplete={isLogin ? 'username' : 'email'}
              autoCapitalize="off"
            />
          </Field>
          <Field label="密码" error={errors.password} hint={!isLogin ? `至少 ${AUTH.passwordMinLength} 位` : undefined}>
            <Input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              autoComplete={isLogin ? 'current-password' : 'new-password'}
              maxLength={AUTH.passwordMaxLength}
            />
          </Field>
          <Button type="submit" className="w-full" loading={busy} disabled={!online}>
            {isLogin ? '登录' : '注册并登录'}
          </Button>
        </form>

        <p className="mt-5 text-center text-sm text-ink-3">
          {isLogin ? (
            <>还没有账号？<Link to="/register" className="font-semibold text-ink underline decoration-go decoration-2 underline-offset-4">注册</Link></>
          ) : (
            <>已有账号？<Link to="/login" className="font-semibold text-ink underline decoration-go decoration-2 underline-offset-4">登录</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
