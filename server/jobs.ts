import crypto from 'node:crypto';

export type Job = {
  id: string;
  kind: string;
  projectId?: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  message: string;
  result?: unknown;
  error?: string;
  startedAt: number;
  finishedAt?: number;
};

const jobs = new Map<string, Job>();

export type JobCtx = { progress: (p: number, message?: string) => void };

/** 時間のかかる処理をバックグラウンドで実行し、進捗をポーリングできるようにする */
export const startJob = (kind: string, projectId: string | undefined, fn: (ctx: JobCtx) => Promise<unknown>): Job => {
  const job: Job = { id: crypto.randomUUID(), kind, projectId, status: 'running', progress: 0, message: '開始しています', startedAt: Date.now() };
  jobs.set(job.id, job);
  const ctx: JobCtx = {
    progress: (p, message) => {
      job.progress = Math.max(0, Math.min(1, p));
      if (message) job.message = message;
    },
  };
  fn(ctx)
    .then((result) => {
      job.status = 'done';
      job.progress = 1;
      job.result = result;
      job.message = '完了しました';
    })
    .catch((e: Error) => {
      console.error(`[job:${kind}]`, e);
      job.status = 'error';
      job.error = e.message;
      job.message = 'エラーが発生しました';
    })
    .finally(() => {
      job.finishedAt = Date.now();
    });
  // 古いジョブを掃除
  for (const [id, j] of jobs) if (j.finishedAt && Date.now() - j.finishedAt > 60 * 60 * 1000) jobs.delete(id);
  return job;
};

export const getJob = (id: string) => jobs.get(id);
export const runningJobs = (projectId: string) => [...jobs.values()].filter((j) => j.projectId === projectId && j.status === 'running');

/** 直列実行用の簡易ミューテックス（レンダリングは同時に1本まで） */
export const createMutex = () => {
  let chain: Promise<unknown> = Promise.resolve();
  return <T,>(fn: () => Promise<T>): Promise<T> => {
    const next = chain.then(fn, fn);
    chain = next.catch(() => undefined);
    return next;
  };
};
