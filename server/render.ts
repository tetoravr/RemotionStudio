import { bundle } from '@remotion/bundler';
import { ensureBrowser, renderMedia, selectComposition } from '@remotion/renderer';
import express from 'express';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
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

/** Remotion のバンドル（ソースが変わった時だけ作り直す） */
export const getBundle = (onProgress?: (p: number) => void) => {
  const mtime = latestMtime(SRC_DIR);
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
};

export const renderProject = ({ project, serverUrl, onProgress, crf = 18 }: RenderOptions) =>
  serial(async () => {
    onProgress?.(0.01, '描画エンジンを準備しています');
    if (!config.browserExecutable) await ensureBrowser();
    const serveUrl = await getBundle((p) => onProgress?.(0.02 + p * 0.08, 'コードをバンドルしています'));
    const inputProps = { project, assetBaseUrl: `${serverUrl}/files/${project.id}/` };
    const composition = await selectComposition({
      serveUrl,
      id: 'AdVideo',
      inputProps,
      browserExecutable: config.browserExecutable,
    });
    const dir = path.join(projectDir(project.id), 'renders');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:]/g, '').replace('T', '-').slice(0, 15);
    const name = `${project.id}-${project.format}-${stamp}.mp4`;
    const outputLocation = path.join(dir, name);
    await renderMedia({
      serveUrl,
      composition,
      inputProps,
      codec: 'h264',
      crf,
      audioCodec: 'aac',
      audioBitrate: '192k',
      imageFormat: 'jpeg',
      jpegQuality: 92,
      pixelFormat: 'yuv420p',
      colorSpace: 'bt709',
      outputLocation,
      browserExecutable: config.browserExecutable,
      onProgress: ({ progress, renderedFrames }) => {
        onProgress?.(0.1 + progress * 0.9, `書き出し中 ${renderedFrames}/${composition.durationInFrames} フレーム`);
      },
    });
    return { file: `${config.basePath}/files/${project.id}/renders/${name}`, path: outputLocation, durationSec: composition.durationInFrames / composition.fps };
  });
