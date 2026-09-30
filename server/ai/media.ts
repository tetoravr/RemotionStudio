import type { Project, Scene } from '../../src/video/schema';
import { generateIllustration, illustrateProblems, solutionPrompt } from './illustration';
import { loadUiLibrary, prepareUiShot, type UiEntry } from './uiLibrary';

type Save = (name: string, data: Buffer) => Promise<string>;

/**
 * 台本の「素材の指定」を実物にする。
 * - ui:<ファイル名> … UIライブラリの画面を切り出してプロジェクトに取り込む（showcase / feature の screen）
 * - 画像の prompt だけある feature … 画像AIでイラストを描く
 * - 課題シーン … 困りごとの図解を描く
 * sceneIds を渡すと、そのシーンのイラストだけを作り直す。
 */
export const resolveMedia = async (
  project: Project,
  save: Save,
  opts: { sceneIds?: string[]; illustrations?: boolean; onProgress?: (p: number, msg: string) => void } = {},
) => {
  const errors: string[] = [];
  const target = (s: Scene) => !opts.sceneIds || opts.sceneIds.includes(s.id);
  const needsUi = project.scenes.some(
    (s) => (s.type === 'showcase' && s.screenshot?.startsWith('ui:')) || (s.type === 'feature' && s.visual.kind === 'screen' && s.visual.src.startsWith('ui:')),
  );
  let lib: UiEntry[] = [];
  if (needsUi) lib = await loadUiLibrary();
  const byFile = new Map(lib.map((e) => [e.file, e]));
  const importUi = async (ref: string) => {
    const e = byFile.get(ref.slice(3));
    if (!e) return null;
    const shot = await prepareUiShot(e);
    return { path: await save(`ui-${e.file.replace(/\.[a-z0-9]+$/i, '')}.png`, shot.data), size: shot.size, frame: shot.frame };
  };

  // 1) UI画面の取り込み
  opts.onProgress?.(0.05, '製品画面を取り込んでいます');
  const scenes: Scene[] = [];
  for (const s of project.scenes) {
    if (s.type === 'showcase' && s.screenshot?.startsWith('ui:')) {
      const r = await importUi(s.screenshot).catch(() => null);
      if (!r) continue; // 画面が見つからない showcase は外す
      scenes.push({ ...s, screenshot: r.path, screenshotSize: r.size, screenshotFrame: r.frame });
      continue;
    }
    if (s.type === 'feature' && s.visual.kind === 'screen' && s.visual.src.startsWith('ui:')) {
      const r = await importUi(s.visual.src).catch(() => null);
      scenes.push({ ...s, visual: r ? { kind: 'screen', src: r.path, size: r.size, frame: r.frame } : { kind: 'none' } });
      continue;
    }
    scenes.push(s);
  }
  project.scenes = scenes;
  if (opts.illustrations === false) return { errors };

  // 2) 特徴シーンのイラスト
  const feats = project.scenes.filter(
    (s): s is Extract<Scene, { type: 'feature' }> =>
      s.type === 'feature' && s.visual.kind === 'image' && Boolean(s.visual.prompt) && (opts.sceneIds ? target(s) : !s.visual.src),
  );
  let done = 0;
  for (const s of feats) {
    opts.onProgress?.(0.15 + (0.6 * done++) / Math.max(1, feats.length), `特徴のイラストを描いています ${done}/${feats.length}`);
    const v = s.visual as Extract<Scene, { type: 'feature' }>['visual'] & { kind: 'image' };
    try {
      const png = await generateIllustration(solutionPrompt(project, s, v.prompt!));
      s.visual = { ...v, src: await save(`illust-${s.id}.png`, png) };
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  // 3) 課題シーンの図解
  opts.onProgress?.(0.8, '課題の図解を描いています');
  const probs = await illustrateProblems(project, save, { sceneIds: opts.sceneIds });
  errors.push(...probs.errors);
  return { errors };
};
