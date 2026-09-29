import type { Project } from '../video/schema';

export type Meta = {
  openai: boolean;
  models: { text: string; tts: string; image: string };
  voices: { id: string; label: string }[];
  icons: string[];
  poses: string[];
  styles: string[];
};

export type ProjectSummary = {
  id: string;
  title: string;
  format: Project['format'];
  brand: string;
  primary: string;
  scenes: number;
  updatedAt?: string;
  thumbnail?: string;
};

export type Job = {
  id: string;
  kind: string;
  status: 'running' | 'done' | 'error';
  progress: number;
  message: string;
  result?: unknown;
  error?: string;
};

const json = async <T,>(res: Response): Promise<T> => {
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
};

export const api = {
  meta: () => fetch('/api/meta').then((r) => json<Meta>(r)),
  list: () => fetch('/api/projects').then((r) => json<ProjectSummary[]>(r)),
  get: (id: string) => fetch(`/api/projects/${id}`).then((r) => json<Project>(r)),
  create: (body: { title: string; brandName: string; format: Project['format'] }) =>
    fetch('/api/projects', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<Project>(r)),
  save: (p: Project) =>
    fetch(`/api/projects/${p.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(p) }).then((r) => json<Project>(r)),
  remove: (id: string) => fetch(`/api/projects/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  duplicate: (id: string) => fetch(`/api/projects/${id}/duplicate`, { method: 'POST' }).then((r) => json<Project>(r)),
  upload: (id: string, file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch(`/api/projects/${id}/upload`, { method: 'POST', body: fd }).then((r) => json<{ path: string }>(r));
  },
  renders: (id: string) => fetch(`/api/projects/${id}/renders`).then((r) => json<{ name: string; url: string; size: number; at: number }[]>(r)),
  post: (url: string, body: unknown = {}) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ jobId: string }>(r)),
  job: (id: string) => fetch(`/api/jobs/${id}`).then((r) => json<Job>(r)),
  ttsPreview: async (text: string, voice: Project['cast'][number]['voice']) => {
    const r = await fetch('/api/tts/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice }) });
    if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error || '試聴に失敗しました');
    return URL.createObjectURL(await r.blob());
  },
};

/** ジョブを完了までポーリング */
export const waitJob = async (jobId: string, onUpdate: (j: Job) => void): Promise<Job> => {
  for (;;) {
    const j = await api.job(jobId);
    onUpdate(j);
    if (j.status !== 'running') {
      if (j.status === 'error') throw new Error(j.error || '失敗しました');
      return j;
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
};
