/** 既存の public/characters/<id>/ の画像から透明な余白を詰める:  npx tsx scripts/normalize-character.ts hayami-saki */
import fs from 'node:fs/promises';
import path from 'node:path';
import { LIBRARY_CHARACTERS } from '../src/video/library';
import { normalizeCharacterImages } from '../server/ai/normalize';
import { ROOT } from '../server/env';

const id = process.argv[2];
const c = LIBRARY_CHARACTERS[id];
if (!c) throw new Error(`unknown: ${id}`);
const dir = path.join(ROOT, 'public/characters', id);
const files = c.poses.flatMap((p) => [`${p}.webp`, `${p}-open.webp`]);
await Promise.all(files.map((f) => fs.stat(path.join(dir, f))));
console.log(id, await normalizeCharacterImages(dir, files));
