import { Signpost } from '@phosphor-icons/react';
import { Link } from 'react-router-dom';
import { Card, EmptyState } from '@/components/ui';

export function NotFoundPage() {
  return (
    <Card className="mt-10">
      <EmptyState icon={Signpost} title="这一站不存在" action={<Link to="/" className="font-semibold underline">回到今日路线</Link>}>
        <span lang="ja">この先には駅がありません。</span>
      </EmptyState>
    </Card>
  );
}
