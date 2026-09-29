import fs from 'node:fs/promises';
import path from 'node:path';
import { POSES, type Pose, type Project } from '../src/video/schema';
import { generateCharacterBase, generatePose, type StylePreset } from './ai/images';
import { projectDir } from './projects';

export type CharacterRequest = {
  castId: string;
  description: string;
  style: StylePreset;
  poses: Pose[];
  /** 既存の default 画像を元にポーズだけ作る */
  keepBase?: boolean;
};

/**
 * キャラクター画像を AI 生成してキャストに設定する。
 * 1) default ポーズ（基本デザイン） 2) それを参照して他ポーズを並列生成
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
  const rel = (pose: Pose) => `assets/${member.id}-${stamp}-${pose}.webp`;

  let baseRel = member.images.default;
  if (!req.keepBase || !baseRel) {
    onProgress(0.05, '基本デザインを生成しています（約40秒）');
    baseRel = rel('default');
    await generateCharacterBase(req.description, req.style, path.join(dir, baseRel));
  }
  const images: Partial<Record<Pose, string>> = { default: baseRel };
  const poses = req.poses.filter((p) => p !== 'default' && POSES.includes(p));
  let done = 0;
  const failures: string[] = [];
  onProgress(0.4, `ポーズを生成しています（0/${poses.length}）`);
  const queue = [...poses];
  const worker = async () => {
    while (queue.length) {
      const pose = queue.shift()!;
      try {
        await generatePose(path.join(dir, baseRel!), pose, req.description, path.join(dir, rel(pose)));
        images[pose] = rel(pose);
      } catch (e) {
        failures.push(`${pose}: ${(e as Error).message}`);
      }
      done++;
      onProgress(0.4 + (done / Math.max(1, poses.length)) * 0.6, `ポーズを生成しています（${done}/${poses.length}）`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(4, poses.length) }, worker));

  // 以前の生成画像のうち、使われなくなったものを掃除
  const old = Object.values(member.images).filter((v): v is string => Boolean(v));
  member.images = req.keepBase ? { ...member.images, ...images } : images;
  member.kind = 'image';
  const still = new Set(Object.values(member.images));
  await Promise.all(old.filter((o) => !still.has(o) && o.startsWith(`assets/${member.id}-`)).map((o) => fs.rm(path.join(dir, o), { force: true })));
  return { images: member.images, failures };
};
