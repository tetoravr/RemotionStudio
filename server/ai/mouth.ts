import sharp from 'sharp';

/**
 * 口パク用の「口開け画像」を作る。
 *
 * AI が生成した口開け版は、口以外も微妙にずれる（輪郭が数pxずれる等）ので、そのまま切り替えると全身がちらつく。
 * そこで「閉じ口画像」と「口開け生成画像」の差分から口の位置を自動検出し、
 * 口まわりの楕円領域だけを閉じ口画像に合成する。口以外は閉じ口画像と完全に同一になる。
 */

type Raw = { data: Buffer; width: number; height: number };

const readRaw = async (input: string | Buffer): Promise<Raw> => {
  const { data, info } = await sharp(input).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
};

/** 2枚の差分から「一番大きな塊」（= 口）の外接矩形を返す */
/** 口があるはずの縦位置の範囲（画像の高さに対する比率、ブロブの中心）。人間は頭が上部、マスコットは下半分の顔 */
export type MouthZone = { yMin: number; yMax: number };
export const ZONES: Record<'human' | 'creature', MouthZone> = { human: { yMin: 0, yMax: 0.24 }, creature: { yMin: 0.45, yMax: 0.9 } };

export const detectMouthRegion = (a: Raw, b: Raw, zone: MouthZone = { yMin: 0, yMax: 1 }) => {
  const { width: W, height: H } = a;
  const mask = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const o = i * 4;
    const v =
      Math.abs(a.data[o] - b.data[o]) + Math.abs(a.data[o + 1] - b.data[o + 1]) + Math.abs(a.data[o + 2] - b.data[o + 2]) + Math.abs(a.data[o + 3] - b.data[o + 3]);
    // 両方とも透明な画素は無視
    mask[i] = v > 110 && (a.data[o + 3] > 40 || b.data[o + 3] > 40) ? 1 : 0;
  }
  // 収縮（細い輪郭ずれを消す）→ 膨張（塊を戻す）
  const erode = (src: Uint8Array) => {
    const out = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i] && src[i - 1] && src[i + 1] && src[i - W] && src[i + W]) out[i] = 1;
      }
    return out;
  };
  const dilate = (src: Uint8Array) => {
    const out = new Uint8Array(W * H);
    for (let y = 1; y < H - 1; y++)
      for (let x = 1; x < W - 1; x++) {
        const i = y * W + x;
        if (src[i] || src[i - 1] || src[i + 1] || src[i - W] || src[i + W]) out[i] = 1;
      }
    return out;
  };
  // 収縮（輪郭のずれなど細い差分を消す）。3回で幅6px以下の線は消える
  let core: Uint8Array = mask;
  for (let k = 0; k < 3; k++) core = erode(core);
  // 口の中（歯・舌・暗い口内）は差分が途切れることがあるので、膨張して結合
  let m: Uint8Array = core;
  for (let k = 0; k < 9; k++) m = dilate(m);
  // 連結成分ごとに「実体のある差分(core)の面積」を数え、口として妥当な大きさのものだけを候補にする
  const label = new Int32Array(W * H);
  let best: { core: number; x0: number; y0: number; x1: number; y1: number } | null = null;
  let id = 0;
  const stack: number[] = [];
  for (let s0 = 0; s0 < W * H; s0++) {
    if (!m[s0] || label[s0]) continue;
    id++;
    let coreArea = 0;
    let x0 = W, y0 = H, x1 = 0, y1 = 0;
    let cx0 = W, cy0 = H, cx1 = 0, cy1 = 0;
    stack.push(s0);
    label[s0] = id;
    while (stack.length) {
      const i = stack.pop()!;
      const x = i % W;
      const y = (i / W) | 0;
      if (core[i]) {
        coreArea++;
        if (x < cx0) cx0 = x;
        if (x > cx1) cx1 = x;
        if (y < cy0) cy0 = y;
        if (y > cy1) cy1 = y;
      }
      if (x < x0) x0 = x;
      if (x > x1) x1 = x;
      if (y < y0) y0 = y;
      if (y > y1) y1 = y;
      for (const n of [i - 1, i + 1, i - W, i + W]) {
        if (n >= 0 && n < W * H && m[n] && !label[n]) {
          label[n] = id;
          stack.push(n);
        }
      }
    }
    // 実体のある差分(core)の範囲で判定する（膨張で他の差分とつながっていても影響を受けない）
    const bw = cx1 - cx0;
    const bh = cy1 - cy0;
    const cy = (cy0 + cy1) / 2 / H;
    const plausible = coreArea >= 40 && bw <= W * 0.3 && bh <= H * 0.2 && cy >= zone.yMin && cy <= zone.yMax;
    if (plausible && (!best || coreArea > best.core)) best = { core: coreArea, x0: cx0, y0: cy0, x1: cx1, y1: cy1 };
  }
  if (!best) return null;
  return { x0: best.x0, y0: best.y0, x1: best.x1, y1: best.y1, w: W, h: H };
};

/** closed の上に、open の口まわり（楕円・ぼかし付き）だけを重ねた画像を返す */
export const compositeMouth = async (closedFile: string | Buffer, openRawFile: string | Buffer, kind: 'human' | 'creature' = 'human') => {
  const closed = await readRaw(closedFile);
  let open = await readRaw(openRawFile);
  if (open.width !== closed.width || open.height !== closed.height) {
    open = await readRaw(await sharp(openRawFile).resize(closed.width, closed.height, { fit: 'fill' }).toBuffer());
  }
  const r = detectMouthRegion(closed, open, ZONES[kind]);
  if (!r) throw new Error('口の位置を検出できませんでした（口が描かれていない、または口以外が大きく変わっています）');
  const { width: W, height: H } = closed;
  const cx = (r.x0 + r.x1) / 2;
  const cy = (r.y0 + r.y1) / 2;
  const rx = Math.max((r.x1 - r.x0) / 2 + 26, 34);
  const ry = Math.max((r.y1 - r.y0) / 2 + 24, 28);
  const feather = 0.28; // 楕円の縁のうち外側28%でなだらかに混ぜる
  const out = Buffer.from(closed.data);
  for (let y = Math.max(0, Math.floor(cy - ry - 2)); y < Math.min(H, Math.ceil(cy + ry + 2)); y++) {
    for (let x = Math.max(0, Math.floor(cx - rx - 2)); x < Math.min(W, Math.ceil(cx + rx + 2)); x++) {
      const d = Math.hypot((x - cx) / rx, (y - cy) / ry);
      if (d >= 1) continue;
      const t = Math.min(1, (1 - d) / feather);
      const w = t * t * (3 - 2 * t);
      const o = (y * W + x) * 4;
      for (let c = 0; c < 4; c++) out[o + c] = Math.round(closed.data[o + c] * (1 - w) + open.data[o + c] * w);
    }
  }
  const png = await sharp(out, { raw: { width: W, height: H, channels: 4 } }).webp({ lossless: true, effort: 4 }).toBuffer();
  return { image: png, region: { cx, cy, rx, ry } };
};
