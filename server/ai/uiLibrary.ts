import fs from 'node:fs/promises';
import path from 'node:path';
import sharp from 'sharp';
import { config } from '../env';
import { getOpenAI } from './client';

/**
 * 製品のUIスクリーンショット集（config.uiDir）。
 * 各画像を一度だけ画像認識AIに見せて「何の画面か・スマホかPCか・見せるべき範囲・読める画質か」を記録し、
 * 台本AIが合う画面を選べるようにする。結果は <uiDir>/.ui-index.json にキャッシュする。
 */

export type UiEntry = {
  file: string;
  w: number;
  h: number;
  /** どの製品・機能の画面か（日本語） */
  product: string;
  /** 画面の内容（日本語・1〜2文） */
  description: string;
  device: 'phone' | 'browser' | 'other';
  /** 見せるべき範囲（0〜1 の割合）。管理画面など余白の多い画面で、重要な部分だけを切り出すのに使う */
  focus: { x: number; y: number; w: number; h: number };
  /** 一番見せたい部分（スマホ縦画面の動画で大きく映しても読める、要点だけの範囲） */
  hero: { x: number; y: number; w: number; h: number };
  /** 解析の版。上げると再解析する */
  v: number;
  /** 動画で拡大しても文字が読める解像度か */
  legible: boolean;
  mtime: number;
  bytes: number;
};

const VERSION = 3;
const IMG = new Set(['.png', '.jpg', '.jpeg', '.webp']);
const indexFile = () => path.join(config.uiDir, '.ui-index.json');

const BOX = {
  type: 'object',
  additionalProperties: false,
  required: ['x', 'y', 'w', 'h'],
  properties: { x: { type: 'number' }, y: { type: 'number' }, w: { type: 'number' }, h: { type: 'number' } },
};

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['product', 'description', 'device', 'focus', 'hero'],
  properties: {
    product: { type: 'string' },
    description: { type: 'string' },
    device: { type: 'string', enum: ['phone', 'browser', 'other'] },
    focus: BOX,
    hero: BOX,
  },
};

const analyze = async (file: string, w: number, h: number) => {
  // 位置を正確に答えられるよう、10%ごとの目盛り（0〜100）を重ねた画像を見せる
  const base = sharp(path.join(config.uiDir, file)).resize({ width: 1400, height: 1400, fit: 'inside', withoutEnlargement: true });
  const bm = await base.clone().metadata();
  const small = await base.png().toBuffer();
  const sm = await sharp(small).metadata();
  const W = sm.width ?? bm.width ?? 1;
  const H = sm.height ?? bm.height ?? 1;
  const fs2 = Math.max(10, Math.round(Math.min(W, H) / 45));
  const lines: string[] = [];
  for (let i = 1; i < 10; i++) {
    const x = (W * i) / 10;
    const y = (H * i) / 10;
    lines.push(`<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="#ff00aa" stroke-width="1" stroke-opacity="0.55"/>`);
    lines.push(`<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="#ff00aa" stroke-width="1" stroke-opacity="0.55"/>`);
    lines.push(`<text x="${x + 2}" y="${fs2}" font-size="${fs2}" fill="#ff00aa" font-family="sans-serif">${i * 10}</text>`);
    lines.push(`<text x="2" y="${y - 2}" font-size="${fs2}" fill="#ff00aa" font-family="sans-serif">${i * 10}</text>`);
  }
  const buf = await sharp(small)
    .composite([{ input: Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">${lines.join('')}</svg>`), top: 0, left: 0 }])
    .png()
    .toBuffer();
  const res = await getOpenAI().responses.create({
    model: config.models.text,
    reasoning: { effort: 'low' },
    input: [
      {
        role: 'user',
        content: [
          {
            type: 'input_text',
            text: [
              `製品のUIスクリーンショットです（ファイル名「${file}」、${w}×${h}px）。位置が分かるよう、ピンクの目盛り線を10%ごと（0〜100）に重ねています。広告動画に使うために、次を日本語で答えてください。`,
              '範囲（focus / hero）は、目盛りを読んで画像全体に対する割合 0〜1 で答えてください（例: 目盛り30〜60 → x:0.3, w:0.3）。対象がはみ出さないよう、少し広めに取ってください。',
              '- product: どの製品・機能の画面か（ファイル名も手がかりに。例「トークングラフマーケター（管理画面）の配布履歴」）',
              '- description: 画面に何が表示されているか（1〜2文。数値やグラフがあれば触れる）',
              '- device: スマホ画面なら phone、PC・管理画面なら browser、それ以外は other',
              '- focus: 見てほしい内容のまとまりの範囲（画像全体に対する割合 0〜1 の x, y, w, h）。余白やサイドメニューを除く。スマホ画面は基本的に全体（0,0,1,1）',
              '- hero: 縦型のスマホ動画で大きく映す「一番の見どころ」だけの範囲（割合 0〜1）。その画面の価値が一目で分かる要素（例: 大きな数値のカード、グラフ・図、主要なボタン）を中心に、横長になりすぎないよう縦横比は 1:1〜4:3 程度にする。説明文や細かい表は含めない。スマホ画面は全体（0,0,1,1）',
            ].join('\n'),
          },
          { type: 'input_image', image_url: `data:image/png;base64,${buf.toString('base64')}`, detail: 'high' },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'ui_screen', schema: SCHEMA, strict: true } },
  } as never);
  const out = JSON.parse((res as { output_text: string }).output_text) as Pick<UiEntry, 'product' | 'description' | 'device' | 'focus' | 'hero'>;
  const fix = (f: UiEntry['focus']) => {
    const x = Math.min(0.95, Math.max(0, f.x));
    const y = Math.min(0.95, Math.max(0, f.y));
    return { x, y, w: Math.min(1 - x, Math.max(0.05, f.w)), h: Math.min(1 - y, Math.max(0.05, f.h)) };
  };
  out.focus = fix(out.focus);
  out.hero = fix(out.hero);
  return out;
};

/** 画像フォルダを見て、未解析・更新された画像だけを解析する */
export const loadUiLibrary = async (onProgress?: (done: number, total: number, file: string) => void): Promise<UiEntry[]> => {
  const names = (await fs.readdir(config.uiDir).catch(() => [] as string[])).filter((n) => IMG.has(path.extname(n).toLowerCase()));
  if (!names.length) return [];
  const cache: Record<string, UiEntry> = JSON.parse(await fs.readFile(indexFile(), 'utf8').catch(() => '{}'));
  const out: UiEntry[] = [];
  let changed = false;
  let done = 0;
  for (const file of names) {
    const st = await fs.stat(path.join(config.uiDir, file));
    const hit = cache[file];
    if (hit && hit.v === VERSION && hit.mtime === st.mtimeMs && hit.bytes === st.size) {
      out.push(hit);
      continue;
    }
    onProgress?.(done++, names.length, file);
    try {
      const m = await sharp(path.join(config.uiDir, file)).metadata();
      const w = m.width ?? 0;
      const h = m.height ?? 0;
      const a = await analyze(file, w, h);
      // 読める画質か: スマホは幅 360px 以上、PC画面は切り出す範囲の幅が 900px 以上を目安にする
      const legible = a.device === 'phone' ? w >= 360 : heroCrop({ w, h, ...a } as UiEntry).width >= 700;
      const entry: UiEntry = { file, w, h, ...a, legible, v: VERSION, mtime: st.mtimeMs, bytes: st.size };
      cache[file] = entry;
      out.push(entry);
      changed = true;
    } catch (e) {
      console.warn(`[ui-library] ${file}: ${(e as Error).message}`);
    }
  }
  for (const k of Object.keys(cache)) if (!names.includes(k)) (delete cache[k], (changed = true));
  if (changed) await fs.writeFile(indexFile(), JSON.stringify(cache, null, 2)).catch(() => undefined);
  return out;
};

/** 台本AIに渡す画面の一覧 */
export const uiCatalogText = (lib: UiEntry[]) =>
  lib
    .map(
      (e) =>
        `- file:"${e.file}" / ${e.device === 'phone' ? 'スマホ画面' : e.device === 'browser' ? 'PC・管理画面' : 'その他'} / ${e.legible ? '高画質' : '低画質（大きく映すとぼやける）'} / ${e.product}：${e.description}`,
    )
    .join('\n');

/**
 * 見どころ（hero）を中心に、周りの文脈も少し入る範囲（px）。
 * 幅は内容のまとまり（focus）の半分以上、縦横比はおよそ 4:3。縦型動画でも文字が読める大きさで映すため。
 */
export const heroCrop = (e: UiEntry) => {
  const f = { x: e.focus.x * e.w, y: e.focus.y * e.h, w: e.focus.w * e.w, h: e.focus.h * e.h };
  const hb = e.hero ?? e.focus;
  const h = { x: hb.x * e.w, y: hb.y * e.h, w: hb.w * e.w, h: hb.h * e.h };
  let width = Math.max(h.w * 1.15, f.w * 0.5);
  let height = Math.max(h.h * 1.15, width * 0.75);
  width = Math.min(width, f.w, e.w);
  height = Math.min(height, f.h, e.h);
  const cx = h.x + h.w / 2;
  const cy = h.y + h.h / 2;
  const left = Math.round(Math.min(Math.max(cx - width / 2, f.x), f.x + f.w - width));
  const top = Math.round(Math.min(Math.max(cy - height / 2, f.y), f.y + f.h - height));
  return { left: Math.max(0, left), top: Math.max(0, top), width: Math.round(width), height: Math.round(height) };
};

/** 背景（ほぼ白）以外が一定以上ある行・列の範囲。1〜2px の罫線だけの行・列は無視する */
const contentBox = async (png: Buffer) => {
  const { data, info } = await sharp(png).removeAlpha().greyscale().raw().toBuffer({ resolveWithObject: true });
  const { width: w, height: h } = info;
  const bg = 245;
  const col = new Array(w).fill(0);
  const row = new Array(h).fill(0);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++)
      if (data[y * w + x] < bg - 18) {
        col[x]++;
        row[y]++;
      }
  // 行・列の中で「中身」とみなす量（罫線1本ぶんより多い）
  const colMin = Math.max(3, h * 0.015);
  const rowMin = Math.max(3, w * 0.015);
  const xs = col.map((v, i) => (v > colMin ? i : -1)).filter((i) => i >= 0);
  const ys = row.map((v, i) => (v > rowMin ? i : -1)).filter((i) => i >= 0);
  if (!xs.length || !ys.length) return null;
  const left = xs[0];
  const top = ys[0];
  const width = xs[xs.length - 1] - left + 1;
  const height = ys[ys.length - 1] - top + 1;
  if (width < w * 0.3 || height < h * 0.3) return null; // 詰めすぎは避ける
  return { left, top, width, height };
};

/**
 * 動画用に画面を切り出す。PC画面は重要な範囲（少し余白を足す）だけを切り出して、小さな文字でも読めるようにする。
 * 小さな画像は拡大して、枠の中でぼやけにくくする。
 */
export const prepareUiShot = async (e: UiEntry): Promise<{ data: Buffer; size: { w: number; h: number }; frame: 'phone' | 'browser' }> => {
  const src = path.join(config.uiDir, e.file);
  let img = sharp(src);
  if (e.device !== 'phone') {
    const r = heroCrop(e);
    const { left, top, width, height } = r;
    if (width > 16 && height > 16) {
      img = img.extract({ left, top, width, height });
      // 切り出した範囲のまわりの余白を詰めて、中身を大きく見せる（細い罫線は中身とみなさない）
      const cut = await img.png().toBuffer();
      const box = await contentBox(cut);
      if (box) {
        const pad = Math.round(Math.max(box.width, box.height) * 0.05);
        const m = await sharp(cut).metadata();
        const l = Math.max(0, box.left - pad);
        const t = Math.max(0, box.top - pad);
        img = sharp(cut).extract({ left: l, top: t, width: Math.min((m.width ?? 0) - l, box.width + pad * 2), height: Math.min((m.height ?? 0) - t, box.height + pad * 2) });
      } else img = sharp(cut);
    }
  }
  let data = await img.png().toBuffer();
  let meta = await sharp(data).metadata();
  const target = e.device === 'phone' ? 720 : 1400;
  if ((meta.width ?? 0) < target) {
    data = await sharp(data).resize({ width: target, kernel: 'lanczos3' }).png().toBuffer();
    meta = await sharp(data).metadata();
  } else if ((meta.width ?? 0) > 2000) {
    data = await sharp(data).resize({ width: 2000 }).png().toBuffer();
    meta = await sharp(data).metadata();
  }
  return { data, size: { w: meta.width ?? 1, h: meta.height ?? 1 }, frame: e.device === 'phone' ? 'phone' : 'browser' };
};
