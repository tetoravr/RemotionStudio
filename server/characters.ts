import fs from 'node:fs/promises';
import sharp from 'sharp';
import path from 'node:path';
import { POSES, type Pose, type Project } from '../src/video/schema';
import type { CharacterKind, StylePreset } from './ai/images';
import { generateCharacterSet } from './characterSet';
import { projectDir } from './projects';

export type CharacterRequest = {
  castId: string;
  description: string;
  style: StylePreset;
  kind: CharacterKind;
  poses: Pose[];
  /** 見た目の基準にする画像（プロジェクトの assets 相対パス。デザインシート・イラストなど） */
  referenceAssets?: string[];
};

/**
 * オリジナルキャラクターを生成してキャストに設定する。
 * 表情ごとに「口を閉じた版」と「口を開けた版」を作る（口パク用）。
 */
export const generateCharacter = async (
  project: Project,
  req: CharacterRequest,
  onProgress: (p: number, message: string) => void,
) => {
  const member = project.cast.find((c) => c.id === req.castId);
  if (!member) throw new Error('キャラクターが見つかりません');
  const dir = projectDir(project.id);
  const stamp = Date.now().toString(36);
  const relDir = `assets/chars/${member.id}-${stamp}`;
  const r = await generateCharacterSet({
    outDir: path.join(dir, relDir),
    kind: req.kind,
    references: (req.referenceAssets ?? []).map((a) => path.join(dir, a)),
    description: req.description,
    style: req.style,
    poses: req.poses.length ? req.poses : [...POSES],
    size: req.kind === 'human' ? '1024x1536' : '1024x1024',
    onProgress: (d, t, m) => onProgress(t ? d / t : 0, `${m}（${d}/${t}）`),
  });
  if (!r.images.default) throw new Error(`キャラクター画像を生成できませんでした\n${r.failures.slice(0, 3).join('\n')}`);

  // 以前の生成画像のうち、使われなくなったものを掃除
  const old = [...Object.values(member.images), ...Object.values(member.imagesOpen)].filter((v): v is string => Boolean(v) && v.startsWith('assets/chars/'));
  const rel = (f: string) => `${relDir}/${f}`;
  const images = Object.fromEntries(Object.entries(r.images).map(([k, v]) => [k, rel(v!)]));
  const imagesOpen = Object.fromEntries(Object.entries(r.imagesOpen).map(([k, v]) => [k, rel(v!)]));
  await Promise.all(
    Array.from(new Set(old.map((o) => path.dirname(o)))).map((d) => fs.rm(path.join(dir, d), { recursive: true, force: true })),
  );
  const meta = await sharp(path.join(dir, images.default)).metadata();
  return { images, imagesOpen, failures: r.failures, aspect: meta.width && meta.height ? meta.width / meta.height : undefined };
};
