import fs from 'node:fs/promises';
import path from 'node:path';
import { POSES, type Pose } from '../src/video/schema';
import { generateOpenMouth, generatePoseImage, type CharacterKind, type StylePreset } from './ai/images';
import { normalizeCharacterImages } from './ai/normalize';

export type CharacterSetRequest = {
  /** 出力先ディレクトリ（絶対パス） */
  outDir: string;
  /** ファイル名の接頭辞（ファイルは <prefix><pose>.webp / <prefix><pose>-open.webp） */
  prefix?: string;
  kind: CharacterKind;
  /** 見た目の基準画像（デザインシート等）。1枚以上 */
  references: string[];
  description: string;
  style: StylePreset;
  poses: Pose[];
  size: '1024x1536' | '1024x1024';
  /** 既にある閉じ口画像（default）を承認済みとして使う */
  existingBase?: string;
  concurrency?: number;
  onProgress?: (done: number, total: number, message: string) => void;
};

export type CharacterSetResult = {
  /** pose -> ファイル名（outDir 相対） */
  images: Partial<Record<Pose, string>>;
  imagesOpen: Partial<Record<Pose, string>>;
  failures: string[];
};

const pool = async <T,>(items: T[], n: number, fn: (item: T) => Promise<void>) => {
  const queue = [...items];
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (queue.length) await fn(queue.shift()!);
    }),
  );
};

/**
 * キャラクターの表情セットを生成する。
 *  1) default（閉じ口）を基準画像から生成し、以降のポーズの見た目の基準にする
 *  2) 他のポーズ（閉じ口）を並列生成
 *  3) 全ポーズの口開け版を作る（口だけ合成するので、口パクしても全身がちらつかない）
 */
export const generateCharacterSet = async (req: CharacterSetRequest): Promise<CharacterSetResult> => {
  const prefix = req.prefix ?? '';
  await fs.mkdir(req.outDir, { recursive: true });
  const poses = Array.from(new Set<Pose>(['default', ...req.poses.filter((p) => POSES.includes(p))]));
  const total = poses.length * 2;
  let done = 0;
  const tick = (m: string) => req.onProgress?.(++done, total, m);
  const closedName = (p: Pose) => `${prefix}${p}.webp`;
  const openName = (p: Pose) => `${prefix}${p}-open.webp`;
  const result: CharacterSetResult = { images: {}, imagesOpen: {}, failures: [] };

  // 1) default
  const basePath = path.join(req.outDir, closedName('default'));
  if (req.existingBase) {
    if (path.resolve(req.existingBase) !== path.resolve(basePath)) await fs.copyFile(req.existingBase, basePath);
    tick('通常の表情（既存）');
  } else {
    req.onProgress?.(0, total, '基本デザイン（通常）を生成しています');
    const buf = await generatePoseImage({ kind: req.kind, pose: 'default', references: req.references, description: req.description, style: req.style, size: req.size });
    await fs.writeFile(basePath, buf);
    tick('通常の表情');
  }
  result.images.default = closedName('default');

  // 2) 他のポーズ（閉じ口）
  await pool(
    poses.filter((p) => p !== 'default'),
    req.concurrency ?? 4,
    async (pose) => {
      try {
        const buf = await generatePoseImage({
          kind: req.kind,
          pose,
          references: [...req.references, basePath],
          description: req.description,
          style: req.style,
          size: req.size,
        });
        await fs.writeFile(path.join(req.outDir, closedName(pose)), buf);
        result.images[pose] = closedName(pose);
        tick(`表情: ${pose}`);
      } catch (e) {
        result.failures.push(`${pose}: ${(e as Error).message}`);
        tick(`表情: ${pose}（失敗）`);
      }
    },
  );

  // 3) 口開け版
  await pool(
    poses.filter((p) => result.images[p]),
    req.concurrency ?? 4,
    async (pose) => {
      try {
        const buf = await generateOpenMouth(path.join(req.outDir, closedName(pose)), req.kind, pose, req.size);
        await fs.writeFile(path.join(req.outDir, openName(pose)), buf);
        result.imagesOpen[pose] = openName(pose);
        tick(`口開け: ${pose}`);
      } catch (e) {
        result.failures.push(`${pose}(口): ${(e as Error).message}`);
        tick(`口開け: ${pose}（失敗）`);
      }
    },
  );
  // 4) 余白を詰める（全表情で同じ範囲。口パクの2枚は画素単位で一致したまま）
  const all = [...Object.values(result.images), ...Object.values(result.imagesOpen)].filter((v): v is string => Boolean(v));
  await normalizeCharacterImages(req.outDir, all);
  return result;
};
