/**
 * 基础控件：站台标识系统的部件。触控目标 ≥ 44px，按下有回弹，聚焦有黄绿描边。
 * 线路徽章（LineBadge）是这套界面的识别符号：每个学习模块一块带字母的色牌。
 */
import type { Icon } from '@phosphor-icons/react';
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode, SelectHTMLAttributes, TextareaHTMLAttributes } from 'react';
import { Link } from 'react-router-dom';
import { CaretLeft } from '@phosphor-icons/react';
import { ApiError } from '@/api/client';
import type { Line } from '@/lib/lines';

export const cx = (...xs: Array<string | false | null | undefined>) => xs.filter(Boolean).join(' ');

/* ───────────── 按钮 ───────────── */

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type Size = 'sm' | 'md' | 'lg';

const VARIANTS: Record<Variant, string> = {
  primary: 'bg-go text-go-ink hover:brightness-[1.04] shadow-[inset_0_-2px_0_rgb(0_0_0/0.12)]',
  secondary: 'bg-surface-2 text-ink hover:bg-rail/60',
  ghost: 'bg-transparent text-ink-2 hover:bg-surface-2 hover:text-ink',
  danger: 'bg-transparent text-danger ring-1 ring-inset ring-danger/35 hover:bg-danger-soft',
  outline: 'bg-surface text-ink ring-1 ring-inset ring-line hover:ring-rail',
};
const SIZES: Record<Size, string> = {
  sm: 'min-h-9 px-3 text-[13px] rounded-lg gap-1.5',
  md: 'min-h-11 px-4 text-sm rounded-xl gap-2',
  lg: 'min-h-13 px-5 text-base rounded-2xl gap-2.5',
};

export function Button({
  variant = 'primary',
  size = 'md',
  icon: IconC,
  loading,
  className,
  children,
  disabled,
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: Variant; size?: Size; icon?: Icon; loading?: boolean }) {
  return (
    <button
      className={cx(
        'inline-flex select-none items-center justify-center font-semibold transition-[transform,filter,background-color,box-shadow,color] duration-150 ease-out active:scale-[0.97] disabled:pointer-events-none disabled:opacity-45',
        VARIANTS[variant],
        SIZES[size],
        className,
      )}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      {...rest}
    >
      {loading ? <Spinner /> : IconC && <IconC weight="bold" className="size-[1.15em] shrink-0" />}
      {children}
    </button>
  );
}

export function IconButton({
  icon: IconC,
  label,
  className,
  tone = 'ghost',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { icon: Icon; label: string; tone?: 'ghost' | 'secondary' }) {
  return (
    <button
      aria-label={label}
      title={label}
      className={cx(
        'inline-grid size-11 shrink-0 place-items-center rounded-xl text-ink-2 transition duration-150 active:scale-95 disabled:opacity-40',
        tone === 'ghost' ? 'hover:bg-surface-2 hover:text-ink' : 'bg-surface-2 hover:bg-rail/60',
        className,
      )}
      {...rest}
    >
      <IconC weight="bold" className="size-5" />
    </button>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <span aria-hidden className={cx('inline-block size-4 animate-spin rounded-full border-2 border-current border-r-transparent', className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden className={cx('skeleton', className)} />;
}

/* ───────────── 表单 ───────────── */

export function Field({ label, hint, error, children, className }: { label: ReactNode; hint?: ReactNode; error?: string; children: ReactNode; className?: string }) {
  return (
    <label className={cx('block', className)}>
      <span className="mb-1.5 block text-[13px] font-semibold text-ink-2">{label}</span>
      {children}
      {error ? <span className="mt-1.5 block text-xs text-danger">{error}</span> : hint && <span className="mt-1.5 block text-xs text-ink-3">{hint}</span>}
    </label>
  );
}

const control =
  'block w-full rounded-xl bg-surface px-3.5 text-[15px] text-ink ring-1 ring-inset ring-line transition-shadow placeholder:text-ink-3 hover:ring-rail focus:outline-none focus:ring-2 focus:ring-go';

export function Input({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input className={cx(control, 'min-h-11', className)} {...rest} />;
}

export function Textarea({ className, ...rest }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return <textarea className={cx(control, 'min-h-28 py-3 leading-relaxed', className)} {...rest} />;
}

export function Select({ className, children, ...rest }: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select className={cx(control, 'min-h-11 pr-8', className)} {...rest}>
      {children}
    </select>
  );
}

/** 分段选择：互斥的 2–4 个选项 */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
  label,
  className,
}: {
  value: T;
  options: Array<{ value: T; label: ReactNode }>;
  onChange: (v: T) => void;
  label: string;
  className?: string;
}) {
  return (
    <div role="radiogroup" aria-label={label} className={cx('inline-flex rounded-xl bg-surface-2 p-1', className)}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={cx(
              'min-h-9 flex-1 whitespace-nowrap rounded-lg px-3 text-[13px] font-semibold transition-[background-color,color,box-shadow] duration-200',
              on ? 'bg-surface text-ink lift' : 'text-ink-3 hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={() => onChange(!checked)}
      className={cx('relative inline-flex h-7 w-12 shrink-0 items-center rounded-full transition-colors duration-200', checked ? 'bg-go' : 'bg-rail')}
    >
      <span className={cx('size-5 rounded-full bg-white shadow transition-transform duration-200 ease-out', checked ? 'translate-x-6' : 'translate-x-1')} />
    </button>
  );
}

/* ───────────── 容器与提示 ───────────── */

export function Card({
  title,
  action,
  children,
  className,
  padded = true,
}: {
  title?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  padded?: boolean;
}) {
  return (
    <section className={cx('rounded-2xl bg-surface lift', padded && 'p-4 sm:p-5', className)}>
      {(title || action) && (
        <header className={cx('flex items-center justify-between gap-3', padded ? 'mb-3' : 'px-4 pt-4 sm:px-5')}>
          {title && <h2 className="text-[15px] font-bold">{title}</h2>}
          {action}
        </header>
      )}
      {children}
    </section>
  );
}

export function Notice({ tone = 'info', children, className }: { tone?: 'info' | 'error' | 'ok' | 'warn'; children: ReactNode; className?: string }) {
  const tones = {
    info: 'bg-surface-2 text-ink-2',
    error: 'bg-danger-soft text-danger',
    ok: 'bg-go-soft text-ok',
    warn: 'bg-[color-mix(in_oklab,var(--warn)_14%,transparent)] text-warn',
  } as const;
  return (
    <div role={tone === 'error' ? 'alert' : 'status'} className={cx('rounded-xl px-3.5 py-2.5 text-sm leading-relaxed', tones[tone], className)}>
      {children}
    </div>
  );
}

export function EmptyState({ icon: IconC, title, children, action }: { icon: Icon; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-6 py-12 text-center">
      <div className="mb-4 grid size-14 place-items-center rounded-2xl bg-surface-2 text-ink-3">
        <IconC weight="duotone" className="size-7" />
      </div>
      <h3 className="text-base font-bold">{title}</h3>
      {children && <p className="mt-1.5 max-w-sm text-sm text-ink-3">{children}</p>}
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

/** 页头：标题 + 一句说明 + 右侧操作；有 back 时左侧给返回 */
export function PageHeader({ title, subtitle, actions, back, line }: { title: ReactNode; subtitle?: ReactNode; actions?: ReactNode; back?: string; line?: Line }) {
  return (
    <header className="mb-5 flex items-start gap-3">
      {back && (
        <Link to={back} aria-label="返回" className="-ml-2 mt-0.5 grid size-10 shrink-0 place-items-center rounded-xl text-ink-2 hover:bg-surface-2">
          <CaretLeft weight="bold" className="size-5" />
        </Link>
      )}
      {line && <LineBadge line={line} size="lg" className="mt-0.5" />}
      <div className="min-w-0 flex-1">
        <h1 className="text-[22px] font-extrabold leading-tight sm:text-2xl">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-ink-3">{subtitle}</p>}
      </div>
      {actions && <div className="flex shrink-0 items-center gap-2">{actions}</div>}
    </header>
  );
}

/* ───────────── 线路徽章 ───────────── */

/** 像车站编号牌：线路色的圆角方块里写字母，可选再跟一个站号 */
export function LineBadge({ line, number, size = 'md', className }: { line: Line; number?: number; size?: 'sm' | 'md' | 'lg'; className?: string }) {
  const box = { sm: 'h-6 min-w-6 text-[13px] rounded-md', md: 'h-8 min-w-8 text-base rounded-lg', lg: 'h-10 min-w-10 text-lg rounded-[11px]' }[size];
  return (
    <span
      aria-hidden
      className={cx('font-sign inline-flex shrink-0 items-center justify-center gap-0.5 px-1 font-bold leading-none', box, className)}
      style={{ background: 'var(--surface)', color: line.color, boxShadow: `inset 0 0 0 ${size === 'sm' ? 2.5 : 3}px ${line.color}` }}
    >
      {line.code}
      {number !== undefined && <span className="text-[0.72em] tabular">{String(number).padStart(2, '0')}</span>}
    </span>
  );
}

/** 细长的进度轨：比例用线路色填充 */
export function Rail({ value, color = 'var(--go)', className, label }: { value: number; color?: string; className?: string; label?: string }) {
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div role="progressbar" aria-label={label} aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(pct)} className={cx('h-1.5 overflow-hidden rounded-full bg-surface-2', className)}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${pct}%`, background: color }} />
    </div>
  );
}

/* ───────────── 错误文字 ───────────── */

/** 把任意错误化为一句可展示的话 */
export function errorText(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error) return e.message;
  return '出了点问题，请稍后再试';
}

/** ApiError 的字段级明细 → { 字段名: 提示 } */
export function fieldErrors(e: unknown): Record<string, string> {
  if (!(e instanceof ApiError) || !Array.isArray(e.details)) return {};
  const out: Record<string, string> = {};
  for (const d of e.details as Array<{ path?: string; message?: string }>) {
    const key = d.path?.split('/').filter(Boolean).pop();
    if (key && d.message) out[key] ??= d.message;
  }
  return out;
}
