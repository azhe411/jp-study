/**
 * 课程：只存外链与进度（契约 §9 不嵌入视频）。看完一集点 +1，进度和"最近学习"一起更新。
 */
import { ArrowSquareOut, GraduationCap, Play, Plus, Trash } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { videoApi } from '@/api/endpoints';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState, type FormEvent } from 'react';
import { COURSE_STATUSES, type CoursePlatform, type CourseStatus } from '@shared/constants';
import type { Course } from '@shared/types';
import { coursesApi } from '@/api/endpoints';
import { Button, Card, EmptyState, Field, IconButton, Input, Notice, PageHeader, Rail, Select, Skeleton, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';
import { useStudyTimer } from '@/lib/study';

const LINE = lineOf('course');
const STATUS_ZH: Record<CourseStatus, string> = { planned: '计划中', inProgress: '在学', paused: '暂停', completed: '学完了' };

function platformOf(url: string): CoursePlatform {
  return /bilibili\.com|b23\.tv/.test(url) ? 'bilibili' : /youtube\.com|youtu\.be/.test(url) ? 'youtube' : 'other';
}

export function CoursesPage() {
  useStudyTimer('course');
  const [adding, setAdding] = useState(false);
  const q = useQuery({ queryKey: ['courses'], queryFn: () => coursesApi.list() });
  return (
    <div>
      <PageHeader line={LINE} back="/practice" title="课程" subtitle="B 站、YouTube 课程的外链与进度" actions={<Button size="sm" variant="outline" icon={Plus} onClick={() => setAdding((v) => !v)}>添加</Button>} />
      <BuiltinCourse />
      {adding && <AddCourse onDone={() => setAdding(false)} />}
      {q.isError ? (
        <Notice tone="error">{errorText(q.error)}</Notice>
      ) : !q.data ? (
        <Skeleton className="h-40" />
      ) : !q.data.items.length ? (
        <Card><EmptyState icon={GraduationCap} title="还没有课程">把正在追的日语课链接加进来，看一集记一集。</EmptyState></Card>
      ) : (
        <ul className="stagger space-y-2">{q.data.items.map((c) => <CourseRow key={c.id} c={c} />)}</ul>
      )}
    </div>
  );
}

function CourseRow({ c }: { c: Course }) {
  const qc = useQueryClient();
  const done = () => qc.invalidateQueries({ queryKey: ['courses'] });
  const update = useMutation({ mutationFn: (b: Record<string, unknown>) => coursesApi.update(c.id, c.version, b), onSuccess: done });
  const remove = useMutation({ mutationFn: () => coursesApi.remove(c.id, c.version), onSuccess: done });
  const pct = c.totalEpisodes ? c.currentEpisode / c.totalEpisodes : 0;
  function plusOne() {
    const next = c.currentEpisode + 1;
    update.mutate({
      currentEpisode: next,
      lastStudiedAt: new Date().toISOString(),
      status: c.totalEpisodes && next >= c.totalEpisodes ? 'completed' : 'inProgress',
    });
  }
  return (
    <li className="rounded-2xl bg-surface p-4 lift">
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <a href={c.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 font-bold hover:underline">{c.title}<ArrowSquareOut className="size-4 text-ink-3" /></a>
          <div className="text-xs text-ink-3">{{ bilibili: 'B 站', youtube: 'YouTube', other: '外链' }[c.platform]}{c.lastStudiedAt && ` · 最近 ${new Date(c.lastStudiedAt).toLocaleDateString('zh-CN')}`}</div>
        </div>
        <Select value={c.status} onChange={(e) => update.mutate({ status: e.target.value })} className="w-auto min-h-9 text-sm" aria-label="状态">
          {COURSE_STATUSES.map((s) => <option key={s} value={s}>{STATUS_ZH[s]}</option>)}
        </Select>
        <IconButton icon={Trash} label="删除" onClick={() => confirm(`删除「${c.title}」？`) && remove.mutate()} className="hover:text-danger" />
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Rail value={pct} color={LINE.color} className="flex-1" label="课程进度" />
        <span className="font-sign text-sm font-semibold tabular">{c.currentEpisode}{c.totalEpisodes ? ` / ${c.totalEpisodes}` : ''} 集</span>
        <Button size="sm" onClick={plusOne} loading={update.isPending} disabled={!!c.totalEpisodes && c.currentEpisode >= c.totalEpisodes}>+1 集</Button>
      </div>
      {(update.isError || remove.isError) && <Notice tone="error" className="mt-2">{errorText(update.error ?? remove.error)}</Notice>}
    </li>
  );
}

function AddCourse({ onDone }: { onDone: () => void }) {
  const qc = useQueryClient();
  const [f, setF] = useState({ title: '', url: '', total: '' });
  const add = useMutation({
    mutationFn: () => coursesApi.create({ title: f.title.trim(), url: f.url.trim(), platform: platformOf(f.url), totalEpisodes: f.total ? Number(f.total) : null }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['courses'] });
      onDone();
    },
  });
  const valid = f.title.trim() && /^https?:\/\//.test(f.url.trim());
  function submit(e: FormEvent) {
    e.preventDefault();
    if (valid) add.mutate();
  }
  return (
    <Card className="mb-5" title="添加课程">
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-[1fr_1fr_100px_auto] sm:items-end">
        <Field label="课程名"><Input autoFocus value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} maxLength={120} /></Field>
        <Field label="链接"><Input type="url" value={f.url} onChange={(e) => setF({ ...f, url: e.target.value })} placeholder="https://www.bilibili.com/…" maxLength={500} /></Field>
        <Field label="总集数"><Input inputMode="numeric" value={f.total} onChange={(e) => setF({ ...f, total: e.target.value.replace(/\D/g, '').slice(0, 5) })} /></Field>
        <Button type="submit" loading={add.isPending} disabled={!valid}>保存</Button>
        {add.isError && <Notice tone="error" className="sm:col-span-4">{errorText(add.error)}</Notice>}
      </form>
    </Card>
  );
}

/** 内置的 B 站合集：在软件里看，自动记进度 */
function BuiltinCourse() {
  const q = useQuery({ queryKey: ['video-courses'], queryFn: videoApi.courses });
  const c = q.data?.items[0];
  if (!c) return null;
  return (
    <Link to={`/videos/${c.id}`} viewTransition className="mb-5 flex items-center gap-4 rounded-2xl bg-surface p-4 lift transition hover:-translate-y-0.5">
      <span className="grid size-14 shrink-0 place-items-center rounded-2xl text-white" style={{ background: '#fb7299' }}>
        <Play weight="fill" className="size-6" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="font-bold">{c.title}</div>
        <div className="text-xs text-ink-3">{c.author} · {c.episodeCount} 集 · 已看完 {c.completedCount} 集{c.lastPage ? ` · 上次看到第 ${c.lastPage} 集` : ''}</div>
      </div>
      <span className="shrink-0 rounded-xl bg-go px-3 py-2 text-sm font-bold text-go-ink">{c.lastPage ? '继续看' : '开始看'}</span>
    </Link>
  );
}
