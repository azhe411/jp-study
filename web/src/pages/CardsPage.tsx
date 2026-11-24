/**
 * 全部卡片：按牌组、关键词查找；可暂停（不再出现在复习里）或删除。
 */
import { Cards, MagnifyingGlass, Pause, Play, Trash } from '@phosphor-icons/react';
import { useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useDeferredValue, useState } from 'react';
import type { Card as CardT } from '@shared/types';
import { cardsApi } from '@/api/endpoints';
import { Button, Card, EmptyState, IconButton, Input, Notice, PageHeader, Select, Skeleton, cx, errorText } from '@/components/ui';
import { lineOf } from '@/lib/lines';

const STATE_ZH = { new: '新卡', learning: '学习中', review: '复习', relearning: '重学' } as const;

export function CardsPage() {
  const [deck, setDeck] = useState('');
  const [q, setQ] = useState('');
  const dq = useDeferredValue(q.trim());
  const decks = useQuery({ queryKey: ['decks'], queryFn: cardsApi.decks });
  const list = useInfiniteQuery({
    queryKey: ['cards', deck, dq],
    queryFn: ({ pageParam }) => cardsApi.list({ deck: deck || undefined, q: dq || undefined, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (p) => p.nextCursor ?? undefined,
  });
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div>
      <PageHeader back="/review" line={lineOf('flashcards')} title="全部卡片" subtitle="暂停的卡片不会出现在复习里" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Select value={deck} onChange={(e) => setDeck(e.target.value)} className="w-auto min-w-32" aria-label="牌组">
          <option value="">全部牌组</option>
          {decks.data?.items.map((d) => <option key={d.deck} value={d.deck}>{d.deck}（{d.total}）</option>)}
        </Select>
        <div className="relative min-w-48 flex-1">
          <MagnifyingGlass className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="搜正面、背面或读音" className="pl-9" aria-label="搜索" />
        </div>
      </div>
      {list.isError ? (
        <Notice tone="error">{errorText(list.error)}</Notice>
      ) : list.isPending ? (
        <Skeleton className="h-64" />
      ) : !items.length ? (
        <Card><EmptyState icon={Cards} title="没有找到卡片" /></Card>
      ) : (
        <ul className="overflow-hidden rounded-2xl bg-surface lift">
          {items.map((c, i) => <CardRow key={c.id} c={c} first={i === 0} />)}
        </ul>
      )}
      {list.hasNextPage && <div className="mt-4 text-center"><Button variant="ghost" onClick={() => void list.fetchNextPage()} loading={list.isFetchingNextPage}>加载更多</Button></div>}
    </div>
  );
}

function CardRow({ c, first }: { c: CardT; first: boolean }) {
  const qc = useQueryClient();
  const done = () => {
    void qc.invalidateQueries({ queryKey: ['cards'] });
    void qc.invalidateQueries({ queryKey: ['due'] });
    void qc.invalidateQueries({ queryKey: ['decks'] });
  };
  const suspend = useMutation({ mutationFn: () => cardsApi.update(c.id, c.version, { suspended: !c.suspended }), onSuccess: done });
  const remove = useMutation({ mutationFn: () => cardsApi.remove(c.id, c.version), onSuccess: done });
  return (
    <li className={cx('flex items-center gap-3 px-4 py-2.5', !first && 'border-t border-line', c.suspended && 'opacity-55')}>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <span lang="ja" className="truncate font-bold">{c.front}</span>
          {c.reading && <span lang="ja" className="truncate text-sm text-ink-3">{c.reading}</span>}
        </div>
        <div className="truncate text-sm text-ink-2">{c.back}</div>
      </div>
      <span className="hidden text-xs text-ink-3 sm:block">{c.deck} · {STATE_ZH[c.srs.state]}</span>
      <IconButton icon={c.suspended ? Play : Pause} label={c.suspended ? '恢复复习' : '暂停'} onClick={() => suspend.mutate()} disabled={suspend.isPending} />
      <IconButton icon={Trash} label="删除" onClick={() => confirm(`删除「${c.front}」？`) && remove.mutate()} disabled={remove.isPending} className="hover:text-danger" />
    </li>
  );
}
