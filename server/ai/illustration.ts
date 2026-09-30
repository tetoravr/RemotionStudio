import type { Project, Scene } from '../../src/video/schema';
import { config } from '../env';
import { getOpenAI } from './client';

/**
 * 課題シーンの図解イラスト（文字なしのフラットな図解）を作る。
 * 画像の中の文字は崩れやすいので、文字は一切描かせず、ラベルや見出しは動画側で重ねる。
 */
const STYLE = [
  'Style: modern flat vector infographic for a Japanese business ad video, bold clean rounded shapes, thick soft dark outlines, soft drop shadows, lots of whitespace, centered composition that reads instantly on a smartphone.',
  'Plain solid white background (no checkerboard, no transparency pattern, no frame, no border).',
  'Absolutely no text, letters, numbers, words, captions or logos anywhere in the image.',
].join('\n');

const plain = (s: string | undefined) => (s ?? '').replace(/\[\[|\]\]/g, '').replace(/\n/g, ' ').trim();

/** 課題シーンの内容から、図解の指示文を組み立てる */
export const problemPrompt = (project: Project, scene: Extract<Scene, { type: 'talk' }>) => {
  const brief = (project.brief ?? {}) as Record<string, unknown>;
  const lines = scene.lines.map((l) => plain(l.text)).filter(Boolean);
  // 困りごとは相方（視聴者の代弁者）の本音として言わせる構成なので、そのセリフを図解の主題にする
  const hero = project.cast[0]?.id;
  const voices = scene.lines.filter((l) => l.speaker !== hero).map((l) => plain(l.text)).filter(Boolean);
  const head = plain(scene.headline);
  const genericHead = /ありませんか|困っていませんか|お悩み/.test(head);
  const c = project.brand.colors;
  return [
    'Create one clear explanatory illustration that shows a concrete, relatable EVERYDAY SITUATION in which the target customer is having trouble (a "this happens to me too" example), so viewers instantly recognize the problem.',
    scene.prop?.label ? `The trouble (Japanese keyword): 「${plain(scene.prop.label)}」` : '',
    voices.length ? `What the troubled customer says (Japanese): ${voices.map((l) => `「${l}」`).join(' ')}` : '',
    head && !genericHead ? `Scene headline (Japanese): 「${head}」` : '',
    lines.length ? `Whole dialogue of the scene (Japanese): ${lines.map((l) => `「${l}」`).join(' ')}` : '',
    brief.target ? `Target customer (Japanese): ${String(brief.target)}` : '',
    brief.problems ? `Background (Japanese, for context only): ${String(brief.problems)}` : '',
    'Show the person in their real work situation (e.g. at a desk with a laptop, at an event venue, in a store) facing the trouble. Make the cause of the trouble visible with simple symbolic objects (e.g. separate lists or app cards with broken dotted lines and small red "×" marks, piles of papers, a question mark or sweat drop).',
    'Show the frustration, not the solution. Do not depict any specific real brand.',
    `Colors: use ${c.primary} as the main accent and ${c.dark} for outlines/dark parts, on white; small red accents only for "×" marks.`,
    STYLE,
  ]
    .filter(Boolean)
    .join('\n');
};

/** 特徴シーンの図解（困りごとが解決した後の場面）の指示文 */
export const solutionPrompt = (project: Project, scene: Extract<Scene, { type: 'feature' }>, idea: string) => {
  const brief = (project.brief ?? {}) as Record<string, unknown>;
  const c = project.brand.colors;
  return [
    'Create one clear explanatory illustration for a product ad that shows the GOOD SITUATION AFTER the problem is solved by the service, so viewers instantly understand the benefit.',
    `Scene to draw (Japanese): ${idea}`,
    `What the scene says on screen (Japanese, do NOT draw this text): 「${plain(scene.eyebrow)} ${plain(scene.headline)}」`,
    brief.productName ? `Service (Japanese, do not draw its name or logo): ${String(brief.productName)} — ${String(brief.oneLiner ?? '')}` : '',
    brief.target ? `Target customer (Japanese): ${String(brief.target)}` : '',
    'Show people in a real work or daily situation looking relieved or happy, with simple symbolic objects that make the improvement visible (e.g. connected lines between items, check marks, an organized list on a tablet, a returning happy visitor).',
    `Colors: use ${c.primary} as the main accent and ${c.dark} for outlines/dark parts, on white; small green accents only for check marks.`,
    STYLE,
  ]
    .filter(Boolean)
    .join('\n');
};

export const generateIllustration = async (prompt: string): Promise<Buffer> => {
  const client = getOpenAI();
  let last: unknown;
  for (let i = 0; i < 3; i++) {
    try {
      const res = await client.images.generate({ model: config.models.illustration, prompt, size: '1024x1024', quality: 'medium' } as never);
      const b64 = (res as { data?: { b64_json?: string }[] }).data?.[0]?.b64_json;
      if (!b64) throw new Error('画像が返りませんでした');
      return Buffer.from(b64, 'base64');
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
};

/** プロジェクト内の、図解が無い課題シーン（prop 付きの会話シーン）に図解を付ける */
export const illustrateProblems = async (
  project: Project,
  save: (name: string, data: Buffer) => Promise<string>,
  opts: { force?: boolean; sceneIds?: string[]; onProgress?: (done: number, total: number) => void } = {},
) => {
  const targets = project.scenes.filter(
    (s): s is Extract<Scene, { type: 'talk' }> =>
      s.type === 'talk' && Boolean(s.prop) && (opts.sceneIds ? opts.sceneIds.includes(s.id) : opts.force || !s.prop?.image),
  );
  const errors: string[] = [];
  let done = 0;
  opts.onProgress?.(0, targets.length);
  for (const s of targets) {
    try {
      const png = await generateIllustration(problemPrompt(project, s));
      s.prop!.image = await save(`illust-${s.id}.png`, png);
    } catch (e) {
      errors.push((e as Error).message);
    }
    opts.onProgress?.(++done, targets.length);
  }
  return { generated: targets.length - errors.length, errors };
};
