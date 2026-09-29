/**
 * プロジェクトの各シーンから静止画を書き出して確認する開発用スクリプト。
 *   npx tsx scripts/stills.ts <project.json> [outDir] [--every=0.5] [--format=vertical]
 */
import { bundle } from '@remotion/bundler';
import { renderStill, selectComposition } from '@remotion/renderer';
import fs from 'node:fs';
import path from 'node:path';
import { Project } from '../src/video/schema';
import { computeTimeline } from '../src/video/timeline';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--')) ?? 'public/samples/sushitop-ocr/project.json';
const outDir = args.filter((a) => !a.startsWith('--'))[1] ?? 'out/stills';
const every = Number(args.find((a) => a.startsWith('--every='))?.split('=')[1] ?? 0);
const format = args.find((a) => a.startsWith('--format='))?.split('=')[1];
const assetBase = args.find((a) => a.startsWith('--assets='))?.split('=')[1];
const frameList = args.find((a) => a.startsWith('--frames='))?.split('=')[1];

const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
if (format) raw.format = format;
const project = Project.parse(raw);
const tl = computeTimeline(project);

const frames: number[] = [];
if (frameList) {
  frames.push(...frameList.split(',').map(Number));
} else if (every > 0) {
  for (let f = 0; f < tl.total; f += Math.round(every * project.fps)) frames.push(f);
} else {
  for (const st of tl.scenes) frames.push(st.start + Math.min(st.duration - 1, Math.round(st.duration * 0.7)));
}

const main = async () => {
  fs.mkdirSync(outDir, { recursive: true });
  const serveUrl = await bundle({ entryPoint: path.resolve('src/video/index.ts') });
  const relDir = path.relative(path.resolve('public'), path.dirname(path.resolve(file)));
  const inputProps = { project, assetBaseUrl: assetBase ?? `static:${relDir}/` };
  const composition = await selectComposition({
    serveUrl,
    id: 'AdVideo',
    inputProps,
    browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
  });
  for (const f of frames) {
    const output = path.join(outDir, `f${String(f).padStart(4, '0')}.png`);
    await renderStill({
      serveUrl,
      composition,
      frame: f,
      output,
      inputProps,
      scale: 0.5,
      browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
    });
    console.log(output);
  }
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
