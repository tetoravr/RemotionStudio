/**
 * コマンドラインから動画を作る
 *
 *   npm run make -- briefs/sushitop-ocr.json [--format=vertical|square|horizontal] [--character="説明"] [--no-voice] [--no-render]
 *     ブリーフ(JSON) → AI台本 → (キャラ画像) → ナレーション → MP4
 *
 *   npm run render -- <projectId> [--format=horizontal]
 *     既存プロジェクトを MP4 に書き出す（projects/<id>/renders/ に保存）
 */
import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import type { AddressInfo } from 'node:net';

import { POSES, type Project } from '../src/video/schema';
import { DEFAULT_CAST } from '../src/video/templates';
import sharp from 'sharp';
import { attachScreenshots, generateStoryboard, type Brief, type ScreenshotRef } from '../server/ai/storyboard';
import { generateCharacter } from '../server/characters';
import { config, hasOpenAI } from '../server/env';
import { generateNarration } from '../server/narration';
import { loadProject, newProjectId, projectDir, saveAsset, saveProject, seedSamples } from '../server/projects';
import { renderProject } from '../server/render';

const [cmd, ...rest] = process.argv.slice(2);
const flags = Object.fromEntries(
  rest.filter((a) => a.startsWith('--')).map((a) => {
    const [k, ...v] = a.slice(2).split('=');
    return [k, v.length ? v.join('=') : 'true'];
  }),
);
const positional = rest.filter((a) => !a.startsWith('--'));

const bar = (p: number, msg: string) => {
  const w = 24;
  const n = Math.round(p * w);
  process.stdout.write(`\r  [${'#'.repeat(n)}${'.'.repeat(w - n)}] ${Math.round(p * 100)}% ${msg.padEnd(40).slice(0, 40)}`);
};

/** レンダリング中の Chromium にプロジェクト素材を配信する一時サーバー */
const withFileServer = async <T,>(fn: (url: string) => Promise<T>) => {
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

const render = async (project: Project) => {
  console.log(`\n▶ 書き出し: ${project.title}（${project.format}）`);
  const out = await withFileServer((serverUrl) => renderProject({ project, serverUrl, onProgress: bar }));
  console.log(`\n✔ ${out.path}（${out.durationSec.toFixed(1)}秒）`);
  return out;
};

const make = async () => {
  const file = positional[0];
  if (!file) throw new Error('ブリーフJSONのパスを指定してください（例: npm run make -- briefs/sushitop-ocr.json）');
  if (!hasOpenAI()) throw new Error('.env に OPENAI_API_KEY を設定してください');
  const brief = JSON.parse(fs.readFileSync(file, 'utf8')) as Brief & { format?: Project['format']; colors?: Project['brand']['colors'] };
  const format = (flags.format as Project['format']) ?? brief.format ?? 'vertical';

  console.log(`▶ AIが台本を作成中…（${config.models.text}）`);
  const cast = DEFAULT_CAST.map((c) => structuredClone(c));
  const screenshotFiles = (flags.screenshots ?? '').split(',').filter(Boolean);
  const { ai, scenes: rawScenes } = await generateStoryboard(brief, cast, format, screenshotFiles.length);
  const id = newProjectId(brief.productName);
  const shots: ScreenshotRef[] = [];
  for (const f of screenshotFiles) {
    const buf = fs.readFileSync(f);
    const m = await sharp(buf).metadata();
    shots.push({ path: await saveAsset(id, path.basename(f), buf), size: m.width && m.height ? { w: m.width, h: m.height } : undefined });
  }
  const scenes = attachScreenshots(rawScenes, shots);
  let project = await saveProject({
    id,
    title: ai.title || `${brief.productName} 広告`,
    format,
    fps: 30,
    brand: {
      name: brief.productName,
      tagline: ai.tagline,
      colors: brief.colors ?? {
        primary: ai.palette?.primary ?? '#1f5cff',
        dark: ai.palette?.dark ?? '#0d1b5e',
        accent: ai.palette?.accent ?? '#ffd93b',
        light: ai.palette?.light ?? '#eaf0ff',
        text: ai.palette?.dark ?? '#15172b',
      },
      font: 'noto',
    },
    cast,
    scenes,
    brief,
  });
  console.log(`✔ 台本: ${project.scenes.length}シーン → projects/${project.id}/project.json`);
  for (const s of project.scenes) console.log(`   - ${s.type.padEnd(8)} ${s.lines.map((l) => l.text.replace(/\n/g, '')).join(' / ')}`);

  if (flags.character) {
    console.log('\n▶ 主人公の画像を生成中…（約2分）');
    const r = await generateCharacter(project, { castId: cast[0].id, description: flags.character, style: 'anime', kind: 'human', poses: [...POSES] }, bar);
    project.cast[0].images = r.images;
    project.cast[0].imagesOpen = r.imagesOpen;
    project.cast[0].library = undefined;
    project.cast[0].aspect = r.aspect;
    project = await saveProject(project);
    console.log(`\n✔ キャラ画像 ${Object.keys(r.images).length}枚${r.failures.length ? `（失敗 ${r.failures.length}）` : ''}`);
  }

  if (flags['no-voice'] !== 'true') {
    console.log('\n▶ ナレーション生成中…');
    await generateNarration(project, projectDir(project.id), { onProgress: (d, t, m) => bar(t ? d / t : 1, m) });
    project = await saveProject(project);
    console.log('\n✔ ナレーション完了');
  }

  if (flags['no-render'] !== 'true') await render(project);
  console.log(`\nエディターで調整: npm run dev → http://localhost:5173/#/p/${project.id}`);
};

const renderCmd = async () => {
  const id = positional[0];
  if (!id) throw new Error('プロジェクトIDを指定してください（projects/ 以下のフォルダ名）');
  const p = await loadProject(id);
  if (flags.format) p.format = flags.format as Project['format'];
  await render(p);
};

const main = async () => {
  await seedSamples();
  if (cmd === 'make') await make();
  else if (cmd === 'render') await renderCmd();
  else {
    console.log('使い方:\n  npm run make -- <brief.json> [--format=vertical] [--screenshots=画面1.png,画面2.png] [--character="キャラの説明"] [--no-voice] [--no-render]\n  npm run render -- <projectId> [--format=horizontal]');
  }
};

main().catch((e) => {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
});


