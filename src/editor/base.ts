/**
 * 公開するパス（vite の base。例: /video-creator）。ルートで動かす時は空。
 * API・ファイル・画面内のリンクは、ルートからの絶対パス（/api/…）で書いて withBase を通す。
 */
export const BASE = ((import.meta as ImportMeta & { env: { BASE_URL: string } }).env.BASE_URL || '/').replace(/\/+$/, '');

export const withBase = (p: string) => (BASE && p.startsWith('/') && !p.startsWith('//') && !p.startsWith(`${BASE}/`) ? BASE + p : p);

/** fetch と Remotion の staticFile が BASE の下を見るようにする（main.tsx で一度だけ呼ぶ） */
export const installBase = () => {
  if (!BASE) return;
  (window as Window & { remotion_staticBase?: string }).remotion_staticBase = BASE;
  const original = window.fetch.bind(window);
  window.fetch = (input, init) => original(typeof input === 'string' ? withBase(input) : input, init);
};
