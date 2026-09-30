import type { TtsProvider } from '../video/narrationKey';
import type { Project } from '../video/schema';

export type Meta = {
  openai: boolean;
  models: { text: string; tts: string; image: string };
  tts: {
    default: TtsProvider;
    engines: Record<TtsProvider, string>;
    irodori: { online: boolean; url: string; checkpoint?: string; device?: string; voices: string[]; labels?: Record<string, string>; error?: string };
  };
  voices: { id: string; label: string }[];
  icons: string[];
  poses: string[];
  styles: string[];
  library: { id: string; name: string; kind: 'human' | 'creature' }[];
};

/** プロジェクトの設定（auto 含む）から、実際に使う音声エンジンと ID を決める */
export const ttsFor = (meta: Meta, _setting?: Project['audio']['ttsProvider']) => {
  const provider: TtsProvider = 'irodori'; // 声は Irodori-TTS 固定（OpenAI TTS は不採用）
  return { provider, engine: meta.tts.engines[provider], ready: meta.tts.irodori.online };
};

export type ProjectSummary = {
  id: string;
  title: string;
  format: Project['format'];
  brand: string;
  primary: string;
  scenes: number;
  updatedAt?: string;
  updatedBy?: string;
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
  // ログインが切れていたら、ログイン画面へ（戻り先に今の画面を付ける）
  if (res.status === 401) {
    window.location.href = `/auth/login?next=${encodeURIComponent(window.location.pathname + window.location.hash)}`;
    throw new Error('ログインしてください');
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error((body as { error?: string }).error || `HTTP ${res.status}`);
  return body as T;
};

export const api = {
  me: () => fetch('/auth/me').then((r) => json<{ enabled: boolean; user: { email: string; name: string; picture?: string } | null }>(r)),
  logout: () => fetch('/auth/logout', { method: 'POST' }).then((r) => json<{ ok: boolean }>(r)),
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
    return fetch(`/api/projects/${id}/upload`, { method: 'POST', body: fd }).then((r) => json<{ path: string; size?: { w: number; h: number } }>(r));
  },
  /** 新規作成前に、実スクリーンショットを預ける */
  stage: (file: File) => {
    const fd = new FormData();
    fd.append('file', file);
    return fetch('/api/staging/upload', { method: 'POST', body: fd }).then((r) => json<{ staged: string; name: string; size?: { w: number; h: number } }>(r));
  },
  renders: (id: string) => fetch(`/api/projects/${id}/renders`).then((r) => json<{ name: string; url: string; size: number; at: number }[]>(r)),
  post: (url: string, body: unknown = {}) =>
    fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ jobId: string }>(r)),
  job: (id: string) => fetch(`/api/jobs/${id}`).then((r) => json<Job>(r)),
  /** URL・資料からブリーフの下書きを作るジョブを始める */
  briefFromSources: (urls: string[], files: File[], hint: string) => {
    const fd = new FormData();
    fd.append('urls', urls.join('\n'));
    fd.append('hint', hint);
    for (const f of files) fd.append('files', f);
    return fetch('/api/ai/brief-from-sources', { method: 'POST', body: fd }).then((r) => json<{ jobId: string }>(r));
  },
  voiceCandidate: (body: { caption: string; text: string; seed?: number }) =>
    fetch('/api/tts/voice-candidates', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) =>
      json<{ id: string; seed: number; durationSec: number; url: string }>(r),
    ),
  adoptVoice: (body: { candidateId: string; name: string; label: string; caption: string; text: string; seed: number }) =>
    fetch('/api/tts/voices', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => json<{ id: string; label: string }>(r)),
  uploadVoice: (file: File, name: string, label: string) => {
    const fd = new FormData();
    fd.append('name', name);
    fd.append('label', label);
    fd.append('file', file);
    return fetch('/api/tts/voices/upload', { method: 'POST', body: fd }).then((r) => json<{ id: string; label: string }>(r));
  },
  deleteVoice: (id: string) => fetch(`/api/tts/voices/${id}`, { method: 'DELETE' }).then((r) => json<{ ok: boolean }>(r)),
  ttsPreview: async (text: string, voice: Project['cast'][number]['voice'], opts: { delivery?: string; emoji?: string; provider?: TtsProvider } = {}) => {
    const r = await fetch('/api/tts/preview', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text, voice, ...opts }) });
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
