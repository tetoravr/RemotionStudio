/**
 * 口開け画像だけを作り直す（口が描かれていなかった表情の修正用）。
 *   npx tsx scripts/reopen-mouth.ts osushi-chan default,sad
 * 元の（余白を詰める前の）閉じ口画像が必要なので、character.json の originals を使う。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { LIBRARY_SPECS } from '../server/library';
import { generateOpenMouth } from '../server/ai/images';
import { ROOT } from '../server/env';
import type { Pose } from '../src/video/schema';

const id = process.argv[2];
const poses = process.argv[3].split(',') as Pose[];
const orig = process.argv[4]; // 余白詰め前の画像があるディレクトリ
const spec = LIBRARY_SPECS[id];
const dir = path.join(ROOT, 'public/characters', id);
const meta = JSON.parse(await fs.readFile(path.join(dir, 'character.json'), 'utf8'));
const crop = meta.crop as { left: number; top: number; right: number; bottom: number };
if (!crop) throw new Error('character.json に crop がありません');

for (const pose of poses) {
  const closedOrig = path.join(orig, `${pose}.webp`);
  const open = await generateOpenMouth(closedOrig, spec.kind, pose, spec.size);
  const out = await sharp(open).extract({ left: crop.left, top: crop.top, width: crop.right - crop.left + 1, height: crop.bottom - crop.top + 1 }).webp({ lossless: true, exact: true }).toBuffer();
  await fs.writeFile(path.join(dir, `${pose}-open.webp`), out);
  console.log('reopened', pose);
}
