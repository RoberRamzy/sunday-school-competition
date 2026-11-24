import type { Attempt, TiePolicy } from '@prisma/client';

type Ranked = Pick<Attempt, 'score' | 'startedAt' | 'finishedAt'>;

function elapsed(attempt: Ranked) {
  return (attempt.finishedAt?.getTime() ?? 0) - (attempt.startedAt?.getTime() ?? 0);
}

export function denseRanking<T extends Ranked>(attempts: T[], tiePolicy: TiePolicy) {
  const compare = (a: T, b: T) => Number(b.score) - Number(a.score) ||
    (tiePolicy === 'SCORE_THEN_TIME' ? elapsed(a) - elapsed(b) : 0);
  const ordered = [...attempts].sort(compare);
  let rank = 1;
  return ordered.map((attempt, index) => {
    if (index > 0 && compare(ordered[index - 1], attempt) !== 0) rank++;
    return { attempt, rank };
  });
}
