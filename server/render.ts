import { bundle } from '@remotion/bundler';
import { ensureBrowser, openBrowser, renderMedia, selectComposition, type HeadlessBrowser } from '@remotion/renderer';
import express from 'express';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import type { Project } from '../src/video/schema';
import { config, ROOT } from './env';
import { createMutex } from './jobs';
import { projectDir } from './projects';

const ENTRY = path.join(ROOT, 'src/video/index.ts');
const SRC_DIR = path.join(ROOT, 'src/video');

let bundled: { at: number; url: Promise<string> } | null = null;

const latestMtime = (dir: string): number => {
  let m = 0;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    m = Math.max(m, e.isDirectory() ? latestMtime(p) : fs.statSync(p).mtimeMs);
  }
  return m;
};

/** Docker のビルド時に作っておくバンドル（npm run bundle:video）。動画のソースより新しければ、作らずにそのまま使う */
const PREBUILT = path.join(ROOT, 'dist-remotion');

/** Remotion のバンドル（ソースが変わった時だけ作り直す） */
export const getBundle = (onProgress?: (p: number) => void) => {
  const mtime = latestMtime(SRC_DIR);
  if (!bundled) {
    const index = path.join(PREBUILT, 'index.html');
    const at = fs.existsSync(index) ? fs.statSync(index).mtimeMs : 0;
    if (at && at >= mtime) bundled = { at, url: Promise.resolve(PREBUILT) };
  }
  if (!bundled || mtime > bundled.at) {
    const at = Date.now();
    const url = bundle({
      entryPoint: ENTRY,
      publicDir: config.publicDir,
      onProgress: (p) => onProgress?.(p / 100),
    });
    bundled = { at, url };
    url.catch(() => {
      bundled = null;
    });
  }
  return bundled.url;
};

const serial = createMutex();

/**
 * 同時に描くコマの数。CPU の数まで（既定の Remotion は半分）。1つの描画に約 600MB 使うので、メモリが足りない時は減らす。
 * RENDER_CONCURRENCY で指定もできる
 */
export const renderConcurrency = () => {
  const fixed = Number(process.env.RENDER_CONCURRENCY);
  if (Number.isInteger(fixed) && fixed > 0) return fixed;
  const cpus = Math.min(typeof os.availableParallelism === 'function' ? os.availableParallelism() : os.cpus().length, cgroupCpus() ?? Infinity);
  const mem = Math.min(os.totalmem(), cgroupMemory() ?? Infinity);
  const byMemory = Math.floor((mem - 700 * 1024 ** 2) / (600 * 1024 ** 2));
  return Math.max(1, Math.min(cpus, byMemory, 8));
};

/** コンテナ（Render・Docker）で割り当てられた CPU の数。Node はサーバー全体の数を返すことがあるので、cgroup の上限を見る */
const cgroupCpus = () => {
  try {
    const [quota, period] = fs.readFileSync('/sys/fs/cgroup/cpu.max', 'utf8').trim().split(/\s+/);
    if (quota !== 'max' && Number(period) > 0) return Math.max(1, Math.floor(Number(quota) / Number(period)));
  } catch {
    // cgroup v1 や Windows・Mac では読めない
  }
  return null;
};
/** コンテナで割り当てられたメモリ（バイト） */
const cgroupMemory = () => {
  try {
    const v = fs.readFileSync('/sys/fs/cgroup/memory.max', 'utf8').trim();
    if (v !== 'max' && Number(v) > 0) return Number(v);
  } catch {
    // 読めなければ OS の値を使う
  }
  return null;
};

/**
 * 描画用のブラウザは開いたままにして、次の書き出しで使い回す（毎回の起動を省く）。
 * 縮めて描く（確認用）時は、その倍率で開いたブラウザでないと、元の大きさで描いてから縮めることになり速くならない
 */
let browser: { scale: number; ready: Promise<HeadlessBrowser> } | null = null;
const dropBrowser = async () => {
  const b = browser;
  browser = null;
  await b?.ready.then((x) => x.close({ silent: true })).catch(() => undefined);
};
/** しばらく書き出さなければ閉じて、メモリを空ける */
let idleTimer: ReturnType<typeof setTimeout> | null = null;
const closeWhenIdle = () => {
  if (idleTimer) clearTimeout(idleTimer);
  idleTimer = setTimeout(() => void dropBrowser(), 10 * 60_000);
  idleTimer.unref?.();
};
const getBrowser = async (scale: number) => {
  if (idleTimer) clearTimeout(idleTimer);
  if (browser && browser.scale !== scale) await dropBrowser();
  if (!browser) {
    const ready = openBrowser('chrome', { browserExecutable: config.browserExecutable, forceDeviceScaleFactor: scale });
    browser = { scale, ready };
    ready.catch(() => {
      if (browser?.ready === ready) browser = null;
    });
  }
  return browser.ready;
};

/** 起動直後に、描画の準備（ブラウザとバンドル）を済ませておく。最初の書き出しを待たせないように */
export const warmUpRenderer = async () => {
  if (!config.browserExecutable) await ensureBrowser();
  await getBundle();
  await getBrowser(1);
  closeWhenIdle();
};

const ASSET = /\.(png|jpe?g|webp|gif|svg|avif|wav|mp3|m4a|aac|ogg|mp4|webm|mov|ttf|otf|woff2?)$/i;
/**
 * 動画で使うファイルのうち、見つからないもの。1つでも欠けていると書き出しが途中で失敗するので、先に調べて分かりやすく伝える
 */
export const missingAssets = (project: Project) => {
  const dir = projectDir(project.id);
  const lines: string[] = [];
  const files = new Set<string>();
  project.scenes.forEach((s, i) =>
    s.lines.forEach((l) => {
      if (project.audio.narration && l.audio && !fs.existsSync(path.join(dir, l.audio.src))) lines.push(`シーン${i + 1}「${l.text.replace(/\n/g, '').slice(0, 20)}」`);
    }),
  );
  // セリフの音声以外（画像・BGM など）。プロジェクトの中を全部見て、ファイルらしい文字を調べる
  // ファイルの場所らしい文字（空白なし・フォルダ付き・画像や音声の拡張子）だけを見る。文章の項目やブリーフは見ない
  const looksLikeFile = (v: string) => ASSET.test(v) && v.includes('/') && !/\s/.test(v) && !/^(lib:|static:|ui:|https?:|data:|blob:|\/)/.test(v);
  const walk = (v: unknown): void => {
    if (typeof v === 'string') {
      if (looksLikeFile(v) && !fs.existsSync(path.join(dir, v))) files.add(v);
    } else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === 'object')
      for (const [k, x] of Object.entries(v)) {
        // セリフの音声は上で調べた。ブリーフは文章だけ
        if (k === 'brief' || (k === 'audio' && x && typeof x === 'object' && 'src' in x)) continue;
        walk(x);
      }
  };
  walk(project);
  return { lines, files: [...files] };
};

/** 「残り約2分」のような目安 */
const remaining = (sec: number) => (sec < 60 ? `残り約${Math.max(5, Math.round(sec / 5) * 5)}秒` : `残り約${Math.round(sec / 60)}分`);

/**
 * 書き出し中の Chromium にだけ素材を配信する一時サーバー（127.0.0.1 の空きポート）。
 * 公開用の /files はログインが必要なので、書き出しはこちらから読む。
 */
export const withFileServer = async <T,>(fn: (url: string) => Promise<T>) => {
  const app = express();
  app.use('/files', express.static(config.projectsDir));
  const server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  try {
    return await fn(`http://127.0.0.1:${port}`);
  } finally {
    server.close();
  }
};

export type RenderOptions = {
  project: Project;
  /** 書き出し中の Chromium からアセットを取得するためのサーバーURL */
  serverUrl: string;
  onProgress?: (p: number, message: string) => void;
  crf?: number;
  /** 確認用（720p 相当に縮めて、速く書き出す） */
  draft?: boolean;
};

export const renderProject = ({ project, serverUrl, onProgress, crf = 18, draft = false }: RenderOptions) =>
  serial(async () => {
    const missing = missingAssets(project);
    if (missing.lines.length)
      throw new Error(`セリフの音声ファイルが見つかりません（${missing.lines.slice(0, 3).join('、')}${missing.lines.length > 3 ? ` ほか${missing.lines.length - 3}件` : ''}）。そのセリフの音声を作り直してから、書き出してください`);
    if (missing.files.length) throw new Error(`動画で使うファイルが見つかりません（${missing.files.slice(0, 3).join('、')}）。画像などを設定し直してから、書き出してください`);
    onProgress?.(0.01, '描画エンジンを準備しています');
    if (!config.browserExecutable) await ensureBrowser();
    const serveUrl = await getBundle((p) => onProgress?.(0.02 + p * 0.08, 'コードをバンドルしています'));
    const inputProps = { project, assetBaseUrl: `${serverUrl}/files/${project.id}/` };
    const scale = draft ? 2 / 3 : 1;
    const puppeteerInstance = await getBrowser(scale);
    const composition = await selectComposition({
      serveUrl,
      id: 'AdVideo',
      inputProps,
      browserExecutable: config.browserExecutable,
      puppeteerInstance,
    }).catch(async (e) => {
      // ブラウザが落ちていたら、次は開き直す
      await dropBrowser();
      throw e;
    });
    const dir = path.join(projectDir(project.id), 'renders');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `${project.id}-${project.format}-${stamp}${draft ? '-draft' : ''}.mp4`;
    const outputLocation = path.join(dir, name);
    const total = composition.durationInFrames;
    const started = Date.now();
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      crf: draft ? 23 : crf,
      // 確認用は 1080p を 720p に縮めて描く（描く画素が半分以下になり、約2倍速くなる）
      scale,
      // 画質は同じ（CRF で決まる）まま、圧縮を速くする。ファイルは少し大きくなることがある
      x264Preset: 'veryfast',
      audioCodec: 'aac',
      audioBitrate: '192k',
      imageFormat: 'jpeg',
      jpegQuality: 92,
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      outputLocation,
      concurrency: renderConcurrency(),
      browserExecutable: config.browserExecutable,
      puppeteerInstance,
      onProgress: ({ progress, renderedFrames }) => {
        // 30コマ描いたら、残り時間の目安を出す（描画の残り＋仕上げの圧縮・音声の合成）
        const elapsed = (Date.now() - started) / 1000;
        const eta = renderedFrames >= 30 && renderedFrames < total ? ` ・ ${remaining(((total - renderedFrames) * elapsed) / renderedFrames + 5)}` : '';
        onProgress?.(0.1 + progress * 0.9, renderedFrames < total ? `書き出し中 ${renderedFrames}/${total} フレーム${eta}` : '仕上げています（音声を合わせています）');
      },
    }).catch(async (e) => {
      await dropBrowser();
      throw e;
    });
    closeWhenIdle();
    return { file: `${config.basePath}/files/${project.id}/renders/${name}`, path: outputLocation, durationSec: composition.durationInFrames / composition.fps };
  });
