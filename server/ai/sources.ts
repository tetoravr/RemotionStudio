import path from 'node:path';
import dns from 'node:dns/promises';
import zlib from 'node:zlib';
import { authEnabled } from '../auth';
import { config } from '../env';
import { getOpenAI } from './client';
import { isNotionUrl, readNotion } from './notion';
import type { Brief } from './storyboard';

/**
 * URL や資料（PDF・PowerPoint・Word・Excel・テキスト・画像）から、広告動画のブリーフを下書きする。
 * PDF と画像は AI にそのまま読ませ（図や表も読める）、Office 文書とWebページは文字を取り出して渡す。
 */

export type SourceFile = { name: string; data: Buffer };
export type SourceInput = { urls?: string[]; files?: SourceFile[]; hint?: string };
export type BriefDraft = {
  brief: Brief;
  colors: { primary: string; dark: string; accent: string; light: string; text: string } | null;
  /** 読み込んだ資料の一覧（画面に出す） */
  sources: { label: string; chars?: number; note?: string }[];
  /** 資料から分からなかった点・要確認の点 */
  cautions: string[];
};

const MAX_TEXT = 24_000;
const clip = (s: string, n = MAX_TEXT) => (s.length > n ? `${s.slice(0, n)}\n…（以下省略）` : s);

// ---------- HTML ----------
const decodeEntities = (s: string) =>
  s
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)));

const meta = (html: string, key: string) => {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${key}["'][^>]*>`, 'i');
  const tag = html.match(re)?.[0];
  return tag ? decodeEntities(tag.match(/content=["']([^"']*)["']/i)?.[1] ?? '') : '';
};

/** ページで多く使われている色（白・黒・グレーを除く）。ブランドカラーの手がかりにする */
const siteColors = (html: string) => {
  const count = new Map<string, number>();
  for (const m of html.matchAll(/#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-z])/gi)) {
    let h = m[1].toLowerCase();
    if (h.length === 3) h = h.split('').map((c) => c + c).join('');
    const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16));
    if (Math.max(r, g, b) - Math.min(r, g, b) < 24) continue; // 無彩色は除く
    count.set('#' + h, (count.get('#' + h) ?? 0) + 1);
  }
  return [...count.entries()].sort((x, y) => y[1] - x[1]).slice(0, 8).map(([c]) => c);
};

export const htmlToText = (html: string) => {
  const title = decodeEntities(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '');
  const body = html
    .replace(/<(script|style|noscript|svg|iframe|template)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    // 見出し・段落・リストの区切りを改行にしてから、タグを外す
    .replace(/<(br|\/p|\/div|\/li|\/h[1-6]|\/tr|\/section|\/article|\/header|\/footer)[^>]*>/gi, '\n')
    .replace(/<h([1-6])[^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n・')
    .replace(/<[^>]+>/g, ' ');
  const text = decodeEntities(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean)
    // 同じ行（ナビやフッターの繰り返し）は1回だけ
    .filter((l, i, a) => a.indexOf(l) === i)
    .join('\n');
  return {
    title,
    description: meta(html, 'description') || meta(html, 'og:description'),
    siteName: meta(html, 'og:site_name'),
    themeColor: meta(html, 'theme-color'),
    colors: siteColors(html),
    text,
  };
};

// ---------- ZIP（Office 文書）----------
/** ZIP の中身を名前→データで返す（Office 文書の XML を読むための最小限の実装） */
export const readZip = (buf: Buffer): Map<string, Buffer> => {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new Error('ZIP形式ではありません');
  const count = buf.readUInt16LE(eocd + 10);
  let p = buf.readUInt32LE(eocd + 16);
  for (let n = 0; n < count && p + 46 <= buf.length; n++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const method = buf.readUInt16LE(p + 10);
    const csize = buf.readUInt32LE(p + 20);
    const nameLen = buf.readUInt16LE(p + 28);
    const extraLen = buf.readUInt16LE(p + 30);
    const commentLen = buf.readUInt16LE(p + 32);
    const local = buf.readUInt32LE(p + 42);
    const name = buf.toString('utf8', p + 46, p + 46 + nameLen);
    const lNameLen = buf.readUInt16LE(local + 26);
    const lExtraLen = buf.readUInt16LE(local + 28);
    const start = local + 30 + lNameLen + lExtraLen;
    const raw = buf.subarray(start, start + csize);
    try {
      if (method === 0) out.set(name, Buffer.from(raw));
      else if (method === 8) out.set(name, zlib.inflateRawSync(raw));
    } catch {
      // 壊れたエントリは飛ばす
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  return out;
};

const xmlText = (xml: string, tag: string) =>
  [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => decodeEntities(m[1])).join('');

/** Word / PowerPoint / Excel の文字を取り出す */
export const officeToText = (name: string, buf: Buffer) => {
  const zip = readZip(buf);
  const ext = path.extname(name).toLowerCase();
  if (ext === '.docx') {
    const xml = zip.get('word/document.xml')?.toString('utf8') ?? '';
    return xml
      .split(/<\/w:p>/)
      .map((p) => xmlText(p, 'w:t'))
      .filter((t) => t.trim())
      .join('\n');
  }
  if (ext === '.pptx') {
    const slides = [...zip.keys()]
      .filter((k) => /^ppt\/slides\/slide\d+\.xml$/.test(k))
      .sort((a, b) => Number(a.match(/\d+/)![0]) - Number(b.match(/\d+/)![0]));
    return slides
      .map((k, i) => {
        const xml = zip.get(k)!.toString('utf8');
        const paras = xml
          .split(/<\/a:p>/)
          .map((p) => xmlText(p, 'a:t'))
          .filter((t) => t.trim());
        const notes = zip.get(k.replace('slides/slide', 'notesSlides/notesSlide'))?.toString('utf8');
        const noteText = notes ? xmlText(notes, 'a:t') : '';
        return `### スライド${i + 1}\n${paras.join('\n')}${noteText.trim() ? `\n（ノート）${noteText}` : ''}`;
      })
      .join('\n\n');
  }
  if (ext === '.xlsx') {
    const shared = zip.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
    return [...shared.matchAll(/<si>([\s\S]*?)<\/si>/g)].map((m) => xmlText(m[1], 't')).filter(Boolean).join('\n');
  }
  return '';
};

// ---------- 取得 ----------
const IMAGE = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif']);
const TEXT = new Set(['.txt', '.md', '.csv', '.json', '.html', '.htm']);
const OFFICE = new Set(['.docx', '.pptx', '.xlsx']);

export const SUPPORTED_EXT = ['.pdf', ...IMAGE, ...TEXT, ...OFFICE];

/** 社内ネットワーク・このサーバー自身など、外から触らせてはいけない宛先か */
export const isPrivateAddress = (ip: string) => {
  const v4 = ip.startsWith('::ffff:') ? ip.slice(7) : ip;
  const m = v4.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  const x = ip.toLowerCase();
  return x === '::' || x === '::1' || x.startsWith('fc') || x.startsWith('fd') || x.startsWith('fe8') || x.startsWith('fe9') || x.startsWith('fea') || x.startsWith('feb');
};

/**
 * Webに公開している時は、URL読み込みで社内のサーバーやこのサーバー自身に届かないようにする（SSRF 対策）。
 * リダイレクト先も1回ずつ確かめる。このPCだけで使う時（ログインなし）は、社内のURLも読める。
 */
const assertPublicUrl = async (u: URL) => {
  if (!authEnabled() || process.env.ALLOW_PRIVATE_URLS === 'true') return;
  const addrs = await dns.lookup(u.hostname, { all: true }).catch(() => []);
  if (!addrs.length) throw new Error(`${u.hostname} が見つかりません`);
  if (addrs.some((a) => isPrivateAddress(a.address))) throw new Error(`${u.hostname} は社内・ローカルのアドレスなので読み込めません`);
};

const fetchUrl = async (url: string): Promise<SourceFile | { url: string; page: ReturnType<typeof htmlToText> }> => {
  let u = new URL(url);
  let res: Response | null = null;
  for (let hop = 0; hop < 5; hop++) {
    if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new Error(`http/https のURLを指定してください（${url}）`);
    await assertPublicUrl(u);
    res = await fetch(u, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) VideoCreator/1.0', 'Accept-Language': 'ja,en;q=0.8' },
      redirect: 'manual',
      signal: AbortSignal.timeout(20_000),
    });
    const loc = res.status >= 300 && res.status < 400 ? res.headers.get('location') : null;
    if (!loc) break;
    u = new URL(loc, u);
  }
  if (!res) throw new Error(`${url} を取得できませんでした`);
  if (!res.ok) throw new Error(`${url} を取得できませんでした（HTTP ${res.status}）`);
  const type = res.headers.get('content-type') ?? '';
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error(`${url} が大きすぎます`);
  const name = decodeURIComponent(path.basename(u.pathname)) || u.hostname;
  if (type.includes('pdf') || /\.pdf$/i.test(u.pathname)) return { name: name.endsWith('.pdf') ? name : `${name}.pdf`, data: buf };
  if (type.startsWith('image/')) return { name: name || 'image.png', data: buf };
  const html = buf.toString('utf8');
  return { url: u.href, page: htmlToText(html) };
};

type Part =
  | { type: 'input_text'; text: string }
  | { type: 'input_image'; image_url: string; detail: 'high' | 'low' | 'auto' }
  | { type: 'input_file'; filename: string; file_data: string };

const mimeOf = (name: string) => {
  const e = path.extname(name).toLowerCase();
  return e === '.png' ? 'image/png' : e === '.gif' ? 'image/gif' : e === '.webp' ? 'image/webp' : 'image/jpeg';
};

/** URL・資料を AI に渡す形にする */
export const collectSources = async (input: SourceInput) => {
  const parts: Part[] = [];
  const sources: BriefDraft['sources'] = [];
  const errors: string[] = [];
  const files: SourceFile[] = [...(input.files ?? [])];

  for (const raw of input.urls ?? []) {
    const url = raw.trim();
    if (!url) continue;
    try {
      // Notion のページはログインが要るので、Notion の連携で読む
      if (isNotionUrl(url)) {
        const doc = await readNotion(url);
        const text = clip(doc.text);
        if (!text.trim()) throw new Error(`Notion の「${doc.title}」から文字を読み取れませんでした`);
        parts.push({ type: 'input_text', text: `# 社内資料（Notion）: ${doc.title}\n${text}` });
        sources.push({ label: `Notion「${doc.title}」`, chars: text.length });
        continue;
      }
      const r = await fetchUrl(url);
      if ('page' in r) {
        const p = r.page;
        const text = clip(p.text);
        parts.push({
          type: 'input_text',
          text: `# Webページ: ${r.url}\nタイトル: ${p.title}\n${p.siteName ? `サイト名: ${p.siteName}\n` : ''}${p.description ? `説明: ${p.description}\n` : ''}${p.themeColor ? `テーマカラー: ${p.themeColor}\n` : ''}${p.colors.length ? `ページで多く使われている色（ブランドカラーの手がかり）: ${p.colors.join(' ')}\n` : ''}\n${text}`,
        });
        sources.push({ label: `${p.title || r.url}（${r.url}）`, chars: text.length });
      } else files.push(r);
    } catch (e) {
      errors.push((e as Error).message);
    }
  }

  for (const f of files) {
    const ext = path.extname(f.name).toLowerCase();
    try {
      if (ext === '.pdf') {
        parts.push({ type: 'input_text', text: `# 資料（PDF）: ${f.name}` });
        parts.push({ type: 'input_file', filename: f.name, file_data: `data:application/pdf;base64,${f.data.toString('base64')}` });
        sources.push({ label: f.name, note: 'PDF（図や表も読み取り）' });
      } else if (IMAGE.has(ext)) {
        parts.push({ type: 'input_text', text: `# 資料（画像）: ${f.name}` });
        parts.push({ type: 'input_image', image_url: `data:${mimeOf(f.name)};base64,${f.data.toString('base64')}`, detail: 'high' });
        sources.push({ label: f.name, note: '画像' });
      } else if (OFFICE.has(ext)) {
        const text = clip(officeToText(f.name, f.data));
        if (!text.trim()) throw new Error(`${f.name} から文字を読み取れませんでした`);
        parts.push({ type: 'input_text', text: `# 資料: ${f.name}\n${text}` });
        sources.push({ label: f.name, chars: text.length });
      } else if (TEXT.has(ext)) {
        const s = f.data.toString('utf8');
        const text = clip(ext === '.html' || ext === '.htm' ? htmlToText(s).text : s);
        parts.push({ type: 'input_text', text: `# 資料: ${f.name}\n${text}` });
        sources.push({ label: f.name, chars: text.length });
      } else {
        throw new Error(`${f.name}: 対応していない形式です（${SUPPORTED_EXT.join(' ')}）`);
      }
    } catch (e) {
      errors.push((e as Error).message);
    }
  }
  return { parts, sources, errors };
};

// ---------- ブリーフ化 ----------
const S = { type: 'string' };
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['brief', 'palette', 'cautions'],
  properties: {
    brief: {
      type: 'object',
      additionalProperties: false,
      required: ['productName', 'oneLiner', 'target', 'problems', 'features', 'proof', 'cta', 'contact', 'tone', 'notes'],
      properties: {
        productName: S,
        oneLiner: S,
        target: S,
        problems: S,
        features: S,
        proof: S,
        cta: S,
        contact: S,
        tone: S,
        notes: S,
      },
    },
    palette: {
      anyOf: [
        { type: 'null' },
        {
          type: 'object',
          additionalProperties: false,
          required: ['primary', 'dark', 'accent', 'light'],
          properties: { primary: S, dark: S, accent: S, light: S },
        },
      ],
    },
    cautions: { type: 'array', items: S },
  },
};

const SYSTEM = `あなたはBtoB/BtoCの商品広告を作るマーケターです。渡されたWebページや資料を読み、SNS向けの短い広告動画を作るための「ブリーフ（商品情報のまとめ）」を日本語で作ります。
- 事実は資料に書かれている内容だけを使う。数字・実績・導入社数・効果は、資料に明記されているものだけを proof に書く（推測で作らない）。
- productName: 商品・サービスの正式名称（表記は資料どおり）。複数の商品が載っている場合は、最も中心的な商品（または指示された商品）1つに絞る。
- oneLiner: 何をする商品かを1〜2文で。
- target: 誰向けか（業種・職種・立場を具体的に）。
- problems: ターゲットが抱えている困りごと。資料の課題・背景から、ターゲット本人が口にしそうな具体的な言い方で、「／」区切りで2〜4個。
- features: 特徴・メリットを1行に1つ、価値が伝わる順に3〜5行（機能名だけでなく「何が良くなるか」まで）。β版や条件付きのものは、その旨も書く。
- proof: 資料にある数字・実績・受賞・特許など。無ければ空文字。
- cta: 資料にある行動の呼びかけ（資料請求・無料トライアル・お問い合わせ等）。無ければ「サービス資料をダウンロード」。
- contact: 公式サイトのドメインやURL（資料にあるもの）。無ければ空文字。
- tone: 商品と業界に合う動画のトーン。
- notes: 動画で必ず入れるべき注記（β版・条件・「画面はイメージです」など視聴者向けのもの）。
- palette: 資料やサイトのブランドカラーが分かれば、それに合わせた配色（#rrggbb）。分からなければ null。
- cautions: 資料から読み取れなかった点、推測が入った点、確認してほしい点を短く（無ければ空配列）。`;

export const draftBrief = async (input: SourceInput, onProgress?: (p: number, msg: string) => void): Promise<BriefDraft> => {
  onProgress?.(0.1, 'URL・資料を読み込んでいます');
  const { parts, sources, errors } = await collectSources(input);
  if (!parts.length) throw new Error(errors[0] ?? 'URLか資料を指定してください');
  onProgress?.(0.4, 'AIが商品情報をまとめています（30秒ほど）');
  const res = await getOpenAI().responses.create({
    model: config.models.text,
    reasoning: { effort: 'medium' },
    input: [
      { role: 'system', content: SYSTEM },
      {
        role: 'user',
        content: [
          ...parts,
          { type: 'input_text', text: `${input.hint?.trim() ? `# 補足の指示\n${input.hint.trim()}\n\n` : ''}上の資料から、広告動画のブリーフを作ってください。` },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'brief_draft', schema: SCHEMA, strict: true } },
  } as never);
  const out = JSON.parse((res as { output_text: string }).output_text) as {
    brief: Omit<Brief, 'durationSec'>;
    palette: { primary: string; dark: string; accent: string; light: string } | null;
    cautions: string[];
  };
  const hex = (s: string) => (/^#[0-9a-f]{6}$/i.test(s) ? s : null);
  const pal = out.palette;
  const colors =
    pal && hex(pal.primary) && hex(pal.dark) && hex(pal.accent) && hex(pal.light)
      ? { primary: pal.primary, dark: pal.dark, accent: pal.accent, light: pal.light, text: pal.dark }
      : null;
  return {
    brief: { ...out.brief, durationSec: 30 },
    colors,
    sources,
    cautions: [...errors.map((e) => `読み込めませんでした: ${e}`), ...out.cautions],
  };
};
