/**
 * 組み込みキャラクター（ライブラリ）の画像一式を生成して public/characters/<id>/ に保存する。
 *
 *   npx tsx scripts/build-character.ts hayami-saki
 *   npx tsx scripts/build-character.ts osushi-chan [--only=happy,sad] [--quality=medium]
 *
 * 見た目の基準は public/characters/<id>/reference.webp（デザインシート）。
 * 生成済みのファイルがあれば再利用しないので、作り直したい時だけ実行してください。
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import type { Pose } from '../src/video/schema';
import { generateCharacterSet } from '../server/characterSet';
import { ROOT } from '../server/env';
import { LIBRARY_SPECS } from '../server/library';

const id = process.argv[2];
const spec = LIBRARY_SPECS[id];
if (!spec) {
  console.error(`未定義のキャラです。候補: ${Object.keys(LIBRARY_SPECS).join(', ')}`);
  process.exit(1);
}
const only = process.argv.find((a) => a.startsWith('--only='))?.split('=')[1]?.split(',') as Pose[] | undefined;
const dir = path.join(ROOT, 'public/characters', id);

const main = async () => {
  const t0 = Date.now();
  const keepDefault = Boolean(only) || process.argv.includes('--keep-default');
  const existingBase = keepDefault && (await fs.stat(path.join(dir, 'default.webp')).then(() => path.join(dir, 'default.webp')).catch(() => undefined));
  const r = await generateCharacterSet({
    outDir: dir,
    kind: spec.kind,
    references: [path.join(dir, 'reference.webp')],
    description: spec.description,
    style: spec.style,
    poses: only ?? spec.poses,
    size: spec.size,
    existingBase: existingBase || undefined,
    onProgress: (d, t, m) => console.log(`[${id}] ${d}/${t} ${m} (${Math.round((Date.now() - t0) / 1000)}s)`),
  });
  // 既存のメタ情報に追記（--only の時は他のポーズを残す）
  const metaPath = path.join(dir, 'character.json');
  const prev = await fs.readFile(metaPath, 'utf8').then(JSON.parse).catch(() => ({ images: {}, imagesOpen: {} }));
  const meta = {
    id,
    name: spec.name,
    kind: spec.kind,
    persona: spec.persona,
    voice: spec.voice,
    images: { ...prev.images, ...r.images },
    imagesOpen: { ...prev.imagesOpen, ...r.imagesOpen },
  };
  await fs.writeFile(metaPath, JSON.stringify(meta, null, 2) + '\n');
  if (r.failures.length) console.warn('失敗:', r.failures);
  console.log(`[${id}] 完了 ${Object.keys(meta.images).length}表情 / 口開け ${Object.keys(meta.imagesOpen).length}`);
};

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
