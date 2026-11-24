/**
 * 轻量 SVG 图表（单系列）：柱状与折线，均带悬停提示；颜色用验证过的 --chart。
 * 每张图只有一个量纲 —— 不同量纲的指标各画一张，绝不共用双 y 轴。
 */
import { useId, useState, type ReactNode } from 'react';
import { cx } from './ui';

export interface Point {
  label: string;
  value: number;
}

const H = 140;
const PAD = { top: 12, right: 8, bottom: 22, left: 34 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  return Math.ceil(v / p) * p;
}

/** x、y 是 viewBox 坐标；图会随容器缩放，所以按百分比定位 */
function Tip({ x, y, children, width }: { x: number; y: number; children: ReactNode; width: number }) {
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-lg bg-ink px-2.5 py-1.5 text-xs font-semibold text-ground shadow-lg"
      style={{ left: `clamp(56px, ${(x / width) * 100}%, calc(100% - 56px))`, top: `calc(${(y / H) * 100}% - 8px)` }}
      role="status"
    >
      {children}
    </div>
  );
}

export function BarChart({ data, unit, width = 640, ariaLabel }: { data: Point[]; unit: string; width?: number; ariaLabel: string }) {
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(...data.map((d) => d.value), 0));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const step = innerW / Math.max(data.length, 1);
  const barW = Math.max(2, Math.min(18, step - 2));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];
  const labelEvery = Math.ceil(data.length / 6);

  return (
    <div className="relative">
      <svg viewBox={`0 0 ${width} ${H}`} className="w-full" role="img" aria-label={ariaLabel} onMouseLeave={() => setHover(null)}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" strokeWidth={1} />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3 font-sign text-[11px]">{Math.round(t)}</text>
          </g>
        ))}
        {data.map((d, i) => {
          const cx0 = PAD.left + step * i + step / 2;
          const h = Math.max(0, PAD.top + innerH - y(d.value));
          return (
            <g key={d.label} onMouseEnter={() => setHover(i)} onFocus={() => setHover(i)} tabIndex={0} aria-label={`${d.label}：${d.value}${unit}`}>
              {/* 命中区域比柱子宽，好点 */}
              <rect x={cx0 - step / 2} y={PAD.top} width={step} height={innerH} fill="transparent" />
              {h > 0 && (
                <rect x={cx0 - barW / 2} y={y(d.value)} width={barW} height={h} rx={Math.min(4, barW / 2)} fill="var(--chart)" opacity={hover === null || hover === i ? 1 : 0.45} />
              )}
              {i % labelEvery === 0 && (
                <text x={cx0} y={H - 6} textAnchor="middle" className="fill-ink-3 font-sign text-[11px]">{d.label}</text>
              )}
            </g>
          );
        })}
      </svg>
      {hover !== null && data[hover] && (
        <Tip x={PAD.left + step * hover + step / 2} y={y(data[hover].value)} width={width}>
          {data[hover].label} · {data[hover].value}{unit}
        </Tip>
      )}
    </div>
  );
}

export function LineChart({ data, unit, ariaLabel, width = 320, yMax }: { data: Point[]; unit: string; ariaLabel: string; width?: number; yMax?: number }) {
  const [hover, setHover] = useState<number | null>(null);
  const gid = useId();
  if (data.length === 0) return <p className="py-8 text-center text-sm text-ink-3">这段时间还没有数据</p>;
  const max = yMax ?? niceMax(Math.max(...data.map((d) => d.value)));
  const innerW = width - PAD.left - PAD.right;
  const innerH = H - PAD.top - PAD.bottom;
  const x = (i: number) => PAD.left + (data.length === 1 ? innerW / 2 : (innerW * i) / (data.length - 1));
  const y = (v: number) => PAD.top + innerH - (v / max) * innerH;
  const path = data.map((d, i) => `${i ? 'L' : 'M'}${x(i)},${y(d.value)}`).join('');
  const area = `${path}L${x(data.length - 1)},${PAD.top + innerH}L${x(0)},${PAD.top + innerH}Z`;

  return (
    <div className="relative">
      <svg
        viewBox={`0 0 ${width} ${H}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          const px = ((e.clientX - r.left) / r.width) * width;
          let best = 0;
          data.forEach((_, i) => {
            if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i;
          });
          setHover(best);
        }}
      >
        <defs>
          <linearGradient id={gid} x1="0" x2="0" y1="0" y2="1">
            <stop offset="0" stopColor="var(--chart)" stopOpacity="0.22" />
            <stop offset="1" stopColor="var(--chart)" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0, max].map((t) => (
          <g key={t}>
            <line x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)} stroke="var(--line)" />
            <text x={PAD.left - 6} y={y(t) + 4} textAnchor="end" className="fill-ink-3 font-sign text-[11px]">{Math.round(t)}</text>
          </g>
        ))}
        <path d={area} fill={`url(#${gid})`} />
        <path d={path} fill="none" stroke="var(--chart)" strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
        {hover !== null && <line x1={x(hover)} x2={x(hover)} y1={PAD.top} y2={PAD.top + innerH} stroke="var(--ink-3)" strokeDasharray="3 3" />}
        {data.map((d, i) => (
          <circle key={i} cx={x(i)} cy={y(d.value)} r={hover === i ? 5 : 4} fill="var(--chart)" stroke="var(--surface)" strokeWidth={2} />
        ))}
        <text x={PAD.left} y={H - 6} className="fill-ink-3 font-sign text-[11px]">{data[0].label}</text>
        {data.length > 1 && <text x={width - PAD.right} y={H - 6} textAnchor="end" className="fill-ink-3 font-sign text-[11px]">{data.at(-1)!.label}</text>}
      </svg>
      {hover !== null && (
        <Tip x={x(hover)} y={y(data[hover].value)} width={width}>
          {data[hover].label} · {data[hover].value}{unit}
        </Tip>
      )}
    </div>
  );
}

/** 横向比例条（单色，身份由左侧标签承担） */
export function HBar({ value, max, className }: { value: number; max: number; className?: string }) {
  return (
    <div className={cx('h-2 flex-1 overflow-hidden rounded-full bg-surface-2', className)}>
      <div className="h-full rounded-full transition-[width] duration-700 ease-[var(--ease-out-expo)]" style={{ width: `${max ? (value / max) * 100 : 0}%`, background: 'var(--chart)' }} />
    </div>
  );
}
