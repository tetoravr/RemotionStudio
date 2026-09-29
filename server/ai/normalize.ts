import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';

/**
 * キャラクター画像一式の透明な余白を切り詰める。
 * 全画像で「同じ範囲」を切り出すので、表情を切り替えても位置がずれず、足元が画像の下端に揃う。
 * 口パクは閉じ口／開け口の2枚を画素単位で一致させているため、可逆圧縮(lossless)で保存する。
 */
export const normalizeCharacterImages = async (dir: string, files: string[], pad = 12) => {
  let x0 = Infinity, y0 = Infinity, x1 = -1, y1 = -1;
  let W = 0, H = 0;
  const raws = await Promise.all(
    files.map(async (f) => {
      const { data, info } = await sharp(path.join(dir, f)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
      W = info.width;
      H = info.height;
      for (let y = 0; y < H; y++)
        for (let x = 0; x < W; x++) {
          if (data[(y * W + x) * 4 + 3] > 24) {
            if (x < x0) x0 = x;
            if (x > x1) x1 = x;
            if (y < y0) y0 = y;
            if (y > y1) y1 = y;
          }
        }
      return { f, data };
    }),
  );
  if (x1 < 0) return null;
  const left = Math.max(0, x0 - pad);
  const top = Math.max(0, y0 - pad);
  const right = Math.min(W - 1, x1 + pad);
  const bottom = Math.min(H - 1, y1 + 2); // 足元は詰める
  const width = right - left + 1;
  const height = bottom - top + 1;
  await Promise.all(
    raws.map(async ({ f, data }) => {
      const buf = await sharp(data, { raw: { width: W, height: H, channels: 4 } })
        .extract({ left, top, width, height })
        .webp({ lossless: true, effort: 4, exact: true })
        .toBuffer();
      await fs.writeFile(path.join(dir, f), buf);
    }),
  );
  return { width, height, crop: { left, top, right, bottom } };
};
