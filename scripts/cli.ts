/**
 * コマンドラインから動画を作る
 *
 *   npm run make -- briefs/sushitop-ocr.json [--format=vertical|square|horizontal] [--character="説明"] [--no-voice] [--no-render]
 *   npm run make -- --url=https://example.com/service [--doc=資料.pdf,資料.pptx] [--hint="〇〇について"]
 *     URL・資料からブリーフを作って動画にする（作ったブリーフは briefs/ に保存）
 *     ブリーフ(JSON) → AI台本 → (キャラ画像) → ナレーション → MP4
 *
 *   npm run render -- <projectId> [--format=horizontal]
 *     既存プロジェクトを MP4 に書き出す（projects/<id>/renders/ に保存）
 */
import fs from 'node:fs';
import path from 'node:path';

import { POSES, type Project } from '../src/video/schema';
import { DEFAULT_CAST } from '../src/video/templates';
import sharp from 'sharp';
import { attachScreenshots, generateStoryboard, type Brief, type ScreenshotRef } from '../server/ai/storyboard';
import { generateCharacter } from '../server/characters';
import { resolveMedia } from '../server/ai/media';
import { draftBrief } from '../server/ai/sources';
import { loadUiLibrary } from '../server/ai/uiLibrary';
import { config, hasOpenAI } from '../server/env';
import { resolveProvider } from '../server/ai/tts';
import { generateNarration } from '../server/narration';
import { loadProject, newProjectId, projectDir, saveAsset, saveProject, seedSamples } from '../server/projects';
import { renderProject, withFileServer } from '../server/render';

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


const render = async (project: Project) => {
  console.log(`\n▶ 書き出し: ${project.title}（${project.format}）`);
  const out = await withFileServer((serverUrl) => renderProject({ project, serverUrl, onProgress: bar }));
  console.log(`\n✔ ${out.path}（${out.durationSec.toFixed(1)}秒）`);
  return out;
};

const make = async () => {
  let file = positional[0];
  if (!hasOpenAI()) throw new Error('.env に OPENAI_API_KEY を設定してください');
  if (!file && (flags.url || flags.doc)) {
    // URL・資料からブリーフを作る
    const urls = (flags.url ?? '').split(',').filter(Boolean);
    const docs = (flags.doc ?? '').split(',').filter(Boolean);
    console.log(`▶ URL・資料を読み込んでいます（${[...urls, ...docs.map((d) => path.basename(d))].join(' / ')}）`);
    const draft = await draftBrief({ urls, files: docs.map((d) => ({ name: path.basename(d), data: fs.readFileSync(d) })), hint: flags.hint }, (_p, m) => console.log(`   ${m}`));
    const out = { ...draft.brief, format: flags.format ?? 'vertical', ...(draft.colors ? { colors: draft.colors } : {}) };
    const slug = draft.brief.productName.normalize('NFKC').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'brief';
    file = path.join('briefs', `${slug}-${Date.now().toString(36)}.json`);
    fs.mkdirSync('briefs', { recursive: true });
    fs.writeFileSync(file, JSON.stringify(out, null, 2));
    console.log(`✔ ブリーフ: ${file}（${draft.brief.productName}）`);
    for (const c of draft.cautions) console.log(`   要確認: ${c}`);
  }
  if (!file) throw new Error('ブリーフJSONのパス、または --url= / --doc= を指定してください（例: npm run make -- briefs/sushitop-ocr.json）');
  const brief = JSON.parse(fs.readFileSync(file, 'utf8')) as Brief & { format?: Project['format']; colors?: Project['brand']['colors'] };
  const format = (flags.format as Project['format']) ?? brief.format ?? 'vertical';

  console.log(`▶ AIが台本を作成中…（${config.models.text}）`);
  const cast = DEFAULT_CAST.map((c) => structuredClone(c));
  const screenshotFiles = (flags.screenshots ?? '').split(',').filter(Boolean);
  const uiLib = flags['no-ui-library'] === 'true' ? [] : await loadUiLibrary((d, t, f) => console.log(`   画面を解析中 ${d + 1}/${t} ${f}`));
  if (uiLib.length) console.log(`   製品のUI画面 ${uiLib.length}枚（${config.uiDir}）`);
  const { ai, scenes: rawScenes } = await generateStoryboard(brief, cast, format, screenshotFiles.map((f) => path.basename(f)), uiLib);
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
  for (const pr of ai.plan?.problems ?? []) console.log(`   課題「${pr.voice}」→「${pr.featureEyebrow} ${pr.featureHeadline}」`);
  for (const s of project.scenes) console.log(`   - ${s.type.padEnd(8)} ${s.lines.map((l) => l.text.replace(/\n/g, '')).join(' / ')}`);

  {
    console.log(`\n▶ 製品画面の取り込み・図解の作成中…（${config.models.illustration}）`);
    const r = await resolveMedia(project, (n, d) => saveAsset(project.id, n, d), { illustrations: flags['no-illustration'] !== 'true' });
    project = await saveProject(project);
    for (const s of project.scenes) {
      if (s.type === 'showcase') console.log(`   画面紹介: ${s.screenshot}`);
      if (s.type === 'feature') console.log(`   特徴「${s.headline}」: ${s.visual.kind}${'src' in s.visual ? ` ${s.visual.src}` : ''}`);
      if (s.type === 'talk' && s.prop?.image) console.log(`   課題の図解: ${s.prop.image}`);
    }
    if (r.errors.length) console.log(`   ⚠ 失敗 ${r.errors.length}: ${r.errors[0]}`);
  }

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

  // --tts=elevenlabs|irodori|openai で、この実行だけ音声エンジンを切り替える（既定は .env の TTS_PROVIDER → ElevenLabs）
  if (flags.tts === 'elevenlabs' || flags.tts === 'openai' || flags.tts === 'irodori') config.tts.provider = flags.tts;

  if (flags['no-voice'] !== 'true') {
    const engine = { elevenlabs: 'ElevenLabs', irodori: 'Irodori-TTS', openai: 'OpenAI TTS' }[resolveProvider()];
    console.log(`\n▶ ナレーション生成中…（${engine}）`);
    try {
      await generateNarration(project, projectDir(project.id), { onProgress: (d, t, m) => bar(t ? d / t : 1, m) });
    } finally {
      // 失敗したセリフがあっても、できた分の音声は保存する
      project = await saveProject(project);
    }
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
    console.log('使い方:\n  npm run make -- <brief.json> [--format=vertical] [--screenshots=画面1.png,画面2.png] [--character="キャラの説明"] [--no-voice] [--no-render]\n  npm run make -- --url=https://… [--doc=資料.pdf] [--hint="補足"]   （URL・資料から作る）\n  npm run render -- <projectId> [--format=horizontal]');
  }
};

main().catch((e) => {
  console.error(`\n✖ ${(e as Error).message}`);
  process.exit(1);
});


