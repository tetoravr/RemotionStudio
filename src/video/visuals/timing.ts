import type { Visual } from '../schema';

/**
 * 図解の2段階タイミング。
 * setup = 1行目と同時に出し始める準備、payoff = 見出しの叩きつけに合わせた「決め」（チェック・紙吹雪・着地）。
 */
export const visualTimes = (visual: Visual, startAt: number, payoffAt: number) => {
  const P = Math.max(payoffAt, startAt + 12);
  const count = visual.kind === 'stack' ? visual.count : 0;
  const checkStart = Math.max(P, startAt + 6 + count * 5);
  const runStart = Math.max(startAt + 6, P - 12);
  return { P, checkStart, runStart, runDur: 22 };
};
