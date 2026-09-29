import crypto from 'node:crypto';
import { IRODORI_EMOJI } from '../../src/video/emotions';
import {
  BACKGROUNDS, ICON_NAMES, POSES, Scene as SceneSchema, TRANSITIONS, Visual,
  type CastMember, type IconName, type Line, type Project, type Scene,
} from '../../src/video/schema';
import { config } from '../env';
import { getOpenAI } from './client';

export type Brief = {
  productName: string;
  oneLiner: string;
  target?: string;
  problems?: string;
  features?: string;
  proof?: string;
  cta?: string;
  contact?: string;
  tone?: string;
  durationSec?: number;
  notes?: string;
};

// ---------- JSON Schema（Structured Outputs / strict） ----------
type JS = Record<string, unknown>;
const str: JS = { type: 'string' };
const num: JS = { type: 'number' };
const bool: JS = { type: 'boolean' };
const nullable = (s: JS): JS => ({ anyOf: [s, { type: 'null' }] });
const enumOf = (values: readonly string[]): JS => ({ type: 'string', enum: [...values] });
const obj = (properties: Record<string, JS>): JS => ({
  type: 'object',
  additionalProperties: false,
  properties,
  required: Object.keys(properties),
});
const arr = (items: JS): JS => ({ type: 'array', items });

const buildSchema = (castIds: string[]) => {
  const speaker = enumOf([...castIds, 'narrator']);
  const icon = enumOf(ICON_NAMES);
  const pose = enumOf(POSES);
  const line = obj({
    speaker,
    text: str,
    speak: nullable(str),
    delivery: nullable(str),
    emoji: nullable(enumOf(IRODORI_EMOJI.map((e) => e.emoji))),
    pose: nullable(pose),
    style: enumOf(['bubble', 'bubble-accent', 'caption', 'none']),
  });
  const character = obj({
    id: enumOf(castIds),
    pose,
    position: enumOf(['far-left', 'left', 'center', 'right', 'far-right']),
    size: enumOf(['s', 'm', 'l', 'xl']),
    enter: enumOf(['jump', 'slide', 'pop', 'drop', 'none']),
    enterDelaySec: num,
  });
  const common = { transition: enumOf(TRANSITIONS), lines: arr(line), characters: arr(character) };
  const iconLabel = obj({ icon, label: str });
  const visual = obj({
    kind: enumOf(['flow', 'stack', 'jump', 'counter', 'icons', 'compare', 'none']),
    from: nullable(icon),
    to: nullable(icon),
    fromLabel: nullable(str),
    toLabel: nullable(str),
    effect: nullable(enumOf(['coins', 'sparkles', 'confetti', 'none'])),
    icon: nullable(icon),
    count: nullable(num),
    obstacleLabel: nullable(str),
    goal: nullable(icon),
    counterFrom: nullable(num),
    counterTo: nullable(num),
    prefix: nullable(str),
    suffix: nullable(str),
    caption: nullable(str),
    items: nullable(arr(iconLabel)),
    before: nullable(iconLabel),
    after: nullable(iconLabel),
  });
  const scenes = {
    anyOf: [
      obj({ type: enumOf(['logo']), ...common, logoText: nullable(str), subtitle: nullable(str), ticker: bool }),
      obj({
        type: enumOf(['talk']),
        ...common,
        showLogo: bool,
        headline: nullable(str),
        decor: enumOf(['none', 'question', 'sparkle', 'sweat', 'heart', 'exclaim']),
        prop: nullable(obj({ icon, badge: enumOf(['none', 'ng', 'ok']), label: nullable(str) })),
      }),
      obj({
        type: enumOf(['feature']),
        ...common,
        eyebrow: str,
        headline: str,
        footnote: nullable(str),
        background: nullable(enumOf(BACKGROUNDS)),
        visual,
      }),
      obj({
        type: enumOf(['showcase']),
        ...common,
        title: str,
        note: nullable(str),
      }),
      obj({ type: enumOf(['cta']), ...common, buttonText: str, contact: nullable(str), notes: arr(str) }),
    ],
  };
  return obj({
    title: str,
    tagline: str,
    palette: nullable(obj({ primary: str, dark: str, accent: str, light: str })),
    scenes: arr(scenes),
  });
};

// ---------- プロンプト ----------
const SYSTEM = `あなたは日本のSNS縦型動画広告（TikTok/リール/ショート）を量産しているトップクリエイティブディレクター兼コピーライターです。
与えられた商品情報から、Remotionのテンプレートで自動生成される広告動画の「台本（シーン構成JSON）」を作ります。

# 動画の文法（この型を守ると成果が出る）
- 2人のキャラクターの掛け合いでテンポよく進む。1セリフは短く（原則15文字以内）、口語で、感情を込める。
- 推奨構成（30秒の場合、合計10シーン前後）:
  1. logo: 冒頭でブランド名を元気に叫ぶ（フック）。lines は主人公がブランド名だけを言う（style:"none"）。
  2. talk: 相方が「……って、なに？」と疑問（decor:"question", showLogo:true）。
  3. talk: 課題提起。主人公が「〇〇、困ってない？」（style:"bubble-accent"）→ 相方が「ダメだった〜……」等の共感（pose:"sad"）。prop に課題を象徴するアイコン＋NGバッジ。transition:"wipe"。
  4. logo: 解決。主人公「だったら、〇〇！」（ブランド名を含める）→ 相方「なにがいいの！？」。subtitle にタグライン。transition:"flash"。
  5〜7. feature ×3: eyebrow（1行目・強調語を[[ ]]で囲む）と headline（特大・6文字以内・「！」で終わる）。主人公が eyebrow と headline をそれぞれ別セリフで読み上げる（style:"none"、text は eyebrow/headline と同じ文言。[[ ]]は外す）。最後に相方が短いリアクション（「マジで！？」「いいね〜！」等、style:"bubble"）。visual で内容を図解。3つ目は background:"burst-dark" にしてメリハリを付ける。transition は wipe/slide/zoom を混ぜる。
  8. showcase: 実際の画面のスクリーンショットを見せる。**スクリーンショットが用意されている枚数ぶんだけ**作る（0枚なら showcase は1つも作らない。疑似の画面は作れない）。title は2行、強調語を[[ ]]。
  9. logo: ブランド名をもう一度（subtitle にタグライン）。
  10. cta: ボタン文言（例「導入のご相談、受付中！」「無料で試してみる」）と連絡先。
- 15秒なら 6シーン程度（logo→課題talk→解決logo→feature×2→cta）、60秒なら feature を最大5つ。
- 全セリフの合計は 30秒で 110〜140文字程度（15秒なら約60文字、60秒なら約250文字）。ナレーションは自然な速さで読み上げるので、詰め込みすぎない。

# キャラクター配置のルール
- 縦型画面の下部にキャラが立つ。position は far-left/left/center/right/far-right、size は s/m/l/xl（xlは上半身アップ）。
- 1シーン2人まで。主人公は l か xl、相方は s か m が基本。feature シーンは図解を邪魔しないよう s/m にして左右端に寄せる。
- 喋るキャラは必ずそのシーンの characters に含める。lines[].pose で表情を変える（驚き=surprised、落ち込み=sad、紹介=point、挨拶=wave）。
- enter: 最初の登場は jump/slide/pop を使い分ける。enterDelaySec は 0〜1 秒。

# 文字・読み上げのルール
- 表示テキストの改行は "\\n" で明示。1行は全角12文字以内。
- speak（読み上げ用テキスト）は基本 null。読み間違えやすい語（英字のブランド名、難読語）を含む時だけ、句読点・！？はそのまま残し、その語だけをカタカナ/ひらがなにして入れる（例: 「だったら、SUSHI TOP OCR！」→「だったら、スシトップ オーシーアール！」）。文全体をひらがなにしたり、スペースで細切れにしない（不自然な棒読みになる）。
- delivery（演技指示）は各セリフの気持ちを短く書く（例: 「元気よく」「驚いて」「困り顔で小声で」「ワクワクして」）。単調な読み上げを避けるため、すべてのセリフに付ける。
- emoji は音声合成（Irodori-TTS）用の感情の絵文字。感情がはっきりしたセリフ（驚き😲・喜び😆・困りごと😟・安堵😌・力強い宣言💪など）にだけ入れ、普通のセリフは null。多用しない（全体の3割以下）。
- 事実はブリーフにある情報だけを使う。数字・実績を捏造しない（ブリーフに無ければ counter は使わない）。条件付きの主張には footnote で注記。
- ブランド名は必ずブリーフの表記どおり。

# visual（feature の図解）の使い分け
- flow: AからBへ（例: スマホ→お店、カメラ→書類）。effect は coins（お金系）/sparkles/confetti。
- stack: 面倒な作業・書類が片付く（icon と count 3〜5）。
- jump: 障壁を飛び越える（obstacleLabel に障壁の名前、goal にゴールのアイコン）。
- counter: 数字を強調（ブリーフに根拠がある時だけ）。
- icons: 特徴を1〜3個のアイコンで並べる。
- compare: Before→After。
不要なフィールドは null にする。アイコンは指定の列挙から選ぶ。

# palette
ブランドカラーの提案（primary=メイン, dark=文字・フチ用の濃色, accent=差し色, light=淡い背景色、#rrggbb）。業種とトーンに合う鮮やかで視認性の高い配色にする。`;

const describeCast = (cast: CastMember[]) =>
  cast
    .map(
      (c, i) =>
        `- id:"${c.id}" 名前:${c.name} 役割:${i === 0 ? '主人公（説明役）' : '相方（リアクション役・視聴者の代弁）'}${c.persona ? ` 設定:${c.persona}` : ''} 使える表情(pose):${Object.keys(c.images).join('/')}`,
    )
    .join('\n');

const briefText = (b: Brief) =>
  [
    `商品・サービス名: ${b.productName}`,
    `ひとことで: ${b.oneLiner}`,
    b.target && `ターゲット: ${b.target}`,
    b.problems && `ターゲットの課題: ${b.problems}`,
    b.features && `特徴・メリット:\n${b.features}`,
    b.proof && `実績・数字: ${b.proof}`,
    b.cta && `CTA: ${b.cta}`,
    b.contact && `連絡先・URL: ${b.contact}`,
    b.tone && `トーン: ${b.tone}`,
    `尺: 約${b.durationSec ?? 30}秒`,
    b.notes && `注意事項・注記: ${b.notes}`,
  ]
    .filter(Boolean)
    .join('\n');

type AiLine = { speaker: string; text: string; speak: string | null; delivery: string | null; emoji: string | null; pose: string | null; style: Line['style'] };
type AiVisual = {
  kind: string;
  from: IconName | null;
  to: IconName | null;
  fromLabel: string | null;
  toLabel: string | null;
  effect: 'coins' | 'sparkles' | 'confetti' | 'none' | null;
  icon: IconName | null;
  count: number | null;
  obstacleLabel: string | null;
  goal: IconName | null;
  counterFrom: number | null;
  counterTo: number | null;
  prefix: string | null;
  suffix: string | null;
  caption: string | null;
  items: { icon: IconName; label: string }[] | null;
  before: { icon: IconName; label: string } | null;
  after: { icon: IconName; label: string } | null;
};
type AiScene = Record<string, unknown> & { type: Scene['type']; lines: AiLine[]; characters: Record<string, unknown>[] };
export type AiStoryboard = { title: string; tagline: string; palette: Record<string, string> | null; scenes: AiScene[] };

const nn = <T,>(v: T | null | undefined) => (v === null ? undefined : v);
const shortId = () => crypto.randomBytes(3).toString('hex');

const toVisual = (v: AiVisual | undefined): Visual => {
  if (!v) return { kind: 'none' };
  const cand: Record<string, unknown> = { kind: v.kind };
  switch (v.kind) {
    case 'flow':
      Object.assign(cand, { from: v.from ?? 'phone', to: v.to ?? 'store', fromLabel: nn(v.fromLabel), toLabel: nn(v.toLabel), effect: v.effect ?? 'sparkles' });
      break;
    case 'stack':
      Object.assign(cand, { icon: v.icon ?? 'document', count: Math.round(Math.min(6, Math.max(2, v.count ?? 4))) });
      break;
    case 'jump':
      Object.assign(cand, { obstacleLabel: v.obstacleLabel ?? '', goal: v.goal ?? 'store' });
      break;
    case 'counter':
      Object.assign(cand, { from: v.counterFrom ?? 0, to: v.counterTo ?? 100, prefix: nn(v.prefix), suffix: nn(v.suffix), caption: nn(v.caption) });
      break;
    case 'icons':
      Object.assign(cand, { items: (v.items ?? []).slice(0, 3) });
      break;
    case 'compare':
      Object.assign(cand, { before: v.before, after: v.after });
      break;
  }
  const r = Visual.safeParse(cand);
  return r.success ? r.data : { kind: 'none' };
};

/** AI出力 → プロジェクトのシーン配列（zod で検証・デフォルト補完） */
export const aiToScenes = (ai: AiStoryboard, cast: CastMember[]): Scene[] => {
  const ids = new Set(cast.map((c) => c.id));
  let lineNo = 0;
  const out: Scene[] = [];
  for (const s of ai.scenes) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const x = s as Record<string, any>;
    const lines = (s.lines ?? []).map((l) => ({
      id: `l${++lineNo}-${shortId()}`,
      speaker: ids.has(l.speaker) ? l.speaker : 'narrator',
      text: l.text,
      speak: nn(l.speak) || undefined,
      delivery: nn(l.delivery) || undefined,
      emoji: nn(l.emoji) || undefined,
      pose: nn(l.pose) || undefined,
      style: !ids.has(l.speaker) && l.style.startsWith('bubble') ? 'caption' : l.style,
    }));
    const seen = new Set<string>();
    const characters = (s.characters ?? [])
      .filter((c) => ids.has(c.id as string) && !seen.has(c.id as string) && seen.add(c.id as string))
      .map((c) => ({ ...c, enterDelaySec: Math.min(2, Math.max(0, Number(c.enterDelaySec) || 0)), flip: false }));
    const base = { id: `s-${shortId()}`, transition: x.transition, lines, characters };
    let cand: Record<string, unknown>;
    switch (s.type) {
      case 'logo':
        cand = { ...base, type: 'logo', logoText: nn(x.logoText), subtitle: nn(x.subtitle), ticker: Boolean(x.ticker) };
        break;
      case 'talk':
        cand = {
          ...base,
          type: 'talk',
          showLogo: Boolean(x.showLogo),
          headline: nn(x.headline),
          decor: x.decor ?? 'none',
          prop: x.prop ? { icon: x.prop.icon, badge: x.prop.badge, label: nn(x.prop.label) } : undefined,
        };
        break;
      case 'feature':
        cand = {
          ...base,
          type: 'feature',
          eyebrow: x.eyebrow,
          headline: x.headline,
          footnote: nn(x.footnote),
          background: nn(x.background),
          visual: toVisual(x.visual as AiVisual),
        };
        break;
      case 'showcase':
        cand = { ...base, type: 'showcase', title: x.title, note: nn(x.note) };
        break;
      default:
        cand = { ...base, type: 'cta', buttonText: x.buttonText ?? '詳しくはこちら', contact: nn(x.contact), notes: x.notes ?? [] };
    }
    const r = SceneSchema.safeParse(cand);
    if (r.success) out.push(r.data);
    else console.warn('[storyboard] invalid scene skipped', r.error.issues.slice(0, 3));
  }
  return out;
};

/** プロジェクトのシーン → AI入力用（改稿時に渡す） */
export const scenesToAi = (scenes: Scene[]) =>
  scenes.map((s) => {
    const { id: _id, lines, screenshot: _sc, screenshotSize: _ss, ...rest } = s as Scene & Record<string, unknown>;
    return { ...rest, lines: lines.map(({ id: _l, audio: _a, ...l }) => l) };
  });

const callModel = async (system: string, user: string, cast: CastMember[]): Promise<AiStoryboard> => {
  const client = getOpenAI();
  const res = await client.responses.create({
    model: config.models.text,
    reasoning: { effort: 'medium' },
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: {
      format: { type: 'json_schema', name: 'ad_storyboard', schema: buildSchema(cast.map((c) => c.id)), strict: true },
    },
  });
  const text = res.output_text;
  if (!text) throw new Error('AIから台本が返りませんでした');
  return JSON.parse(text) as AiStoryboard;
};

const formatNote = (format: Project['format']) =>
  format === 'vertical'
    ? '画面: 縦型 9:16（スマホ全画面）。'
    : `画面: ${format === 'horizontal' ? '横型 16:9' : '正方形 1:1'}。画面中央は文字と図解に使うので、logo/feature/showcase/cta シーンのキャラは far-left / left / right / far-right に置き、center は使わない。`;

export type ScreenshotRef = { path: string; size?: { w: number; h: number } };

/** showcase シーンに実スクリーンショットを順番に割り当てる。画像が足りない showcase は除外する */
export const attachScreenshots = (scenes: Scene[], shots: ScreenshotRef[]): Scene[] => {
  let i = 0;
  return scenes.flatMap((s) => {
    if (s.type !== 'showcase') return [s];
    const shot = shots[i++];
    if (!shot) return [];
    const portrait = shot.size ? shot.size.h >= shot.size.w * 1.2 : true;
    return [{ ...s, screenshot: shot.path, screenshotSize: shot.size, screenshotFrame: portrait ? 'phone' : 'browser' } as Scene];
  });
};

export const generateStoryboard = async (brief: Brief, cast: CastMember[], format: Project['format'] = 'vertical', screenshotCount = 0) => {
  const user = `# 登場キャラクター\n${describeCast(cast)}\n\n# 商品ブリーフ\n${briefText(brief)}\n実スクリーンショット: ${screenshotCount}枚（showcase シーンの数）\n${formatNote(format)}\n\n上記で広告動画の台本JSONを作ってください。`;
  const ai = await callModel(SYSTEM, user, cast);
  return { ai, scenes: aiToScenes(ai, cast) };
};

export const reviseStoryboard = async (project: Project, instruction: string) => {
  const user = `# 登場キャラクター\n${describeCast(project.cast)}\n\n# 商品ブリーフ\n${project.brief ? briefText(project.brief as Brief) : `ブランド名: ${project.brand.name}`}\n\n# 現在の台本\n${JSON.stringify(
    { title: project.title, tagline: project.brand.tagline, scenes: scenesToAi(project.scenes) },
    null,
    1,
  )}\n${formatNote(project.format)}\n\n# 修正指示\n${instruction}\n\n修正指示を反映した台本JSONを、構成全体を返してください（指示と関係ない部分はなるべく維持）。`;
  const ai = await callModel(SYSTEM, user, project.cast);
  return { ai, scenes: aiToScenes(ai, project.cast) };
};
