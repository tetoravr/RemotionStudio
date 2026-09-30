import crypto from 'node:crypto';
import { IRODORI_EMOJI } from '../../src/video/emotions';
import {
  BACKGROUNDS, ICON_NAMES, POSES, Scene as SceneSchema, TRANSITIONS, Visual,
  type CastMember, type IconName, type Line, type Project, type Scene,
} from '../../src/video/schema';
import { config } from '../env';
import { uiCatalogText, type UiEntry } from './uiLibrary';
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

const buildSchema = (castIds: string[], uiFiles: string[] = []) => {
  const uiFile = uiFiles.length ? nullable(enumOf(uiFiles)) : nullable(str);
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
  const visual = obj({
    kind: enumOf(['ui', 'illustration', 'counter']),
    /** ui: 使う画面のファイル名 */
    uiFile,
    /** illustration: 画像AIに描かせる内容（日本語で具体的に） */
    illustration: nullable(str),
    counterFrom: nullable(num),
    counterTo: nullable(num),
    prefix: nullable(str),
    suffix: nullable(str),
    caption: nullable(str),
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
        uiFile,
        title: str,
        note: nullable(str),
      }),
      obj({ type: enumOf(['cta']), ...common, buttonText: str, contact: nullable(str), notes: arr(str) }),
    ],
  };
  return obj({
    /** 台本を書く前の設計メモ。困りごとの例と、それをどう解決するかを先に対応づける（動画には使わない） */
    plan: obj({
      viewer: str,
      problems: arr(obj({ situation: str, voice: str, solution: str, featureEyebrow: str, featureHeadline: str })),
    }),
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
- 2人のキャラクターの掛け合いでテンポよく進む。主人公はサービスの案内役、相方は視聴者（ターゲット）の代弁者で、困りごとは相方の本音として言わせる。1セリフは短く（原則15文字以内）、口語で、感情を込める。
# 設計（plan）を先に書く
台本（scenes）を書く前に、plan を埋める。scenes は plan に従って書く。
- plan.viewer: この動画を見る人は誰で、どんな場面で働いているか（1文）。
- plan.problems: 課題の例（30秒なら2つ、15秒なら1つ、60秒なら3つ）。それぞれ:
  - situation: 困りごとが起きている具体的な場面（誰が・どこで・何をしようとして・何が起きるか）。
  - voice: その人が思わず口にする本音のひとこと（15文字以内・専門用語なし・「…」で終える）。これが相方のセリフと課題シーンの見出しになる。
  - solution: このサービスで、その場面がどう変わるか（ブリーフの特徴の範囲で）。
  - featureEyebrow: 対応する feature の eyebrow。voice の言葉を受けて「〇〇も／〇〇だった〜も」の形にする（10文字以内）。
  - featureHeadline: 対応する feature の headline。解決後の状態（6文字以内・「！」で終わる）。
- 見直し: 各 voice を初めて見た人が「あるある、困る」と分かるか。voice → featureEyebrow → featureHeadline を続けて読むと「あの困りごとがこう変わる」と一文で通じるか。専門用語（突合・分断・最適化・可視化・CRM・KPI など）が残っていたら、日常の言葉に言い換える。

# 構成の考え方（最重要）
広告は「こんなことで困っていませんか？（共感）」→「それ、〇〇で解決できます（解決）」→「具体的にこう良くなる（根拠）」→「まずは資料請求を（行動）」の順で、視聴者が自分ごととして理解できるように作る。
- **課題は「例」として見せる**。ターゲットが実際の仕事や生活の中で口にしそうな、具体的な場面・ひとことで書く（「あるある」と思える困りごと）。
  - NG: 「施策ごとにデータが分断」「業務が非効率」「最適化できない」のような、抽象語・専門用語・業界の言い回しだけの課題（初見の人には課題だと伝わらない）。
  - OK: 「イベントとSNS、同じお客さんか分からない…」「参加者リストが施策ごとにバラバラ…」「結局、何回来てくれたか分からない…」のように、状況が目に浮かぶ言い方。
- **課題と解決を1対1で対応させる**（plan.problems の順に、課題シーン → feature を対応させる。feature の eyebrow/headline は plan の featureEyebrow/featureHeadline をそのまま使う）。課題の例①②を出したら、feature の1つ目は例①の解決、2つ目は例②の解決にする。feature の eyebrow は課題の状況を受けた言い方（例: 「バラバラだった参加データも」）、headline は解決後の状態（例: 「ひとつに！」）にして、「あの困りごとがこう変わる」と分かるようにする。
- ブリーフの「ターゲットの課題」を材料にするが、そのまま貼らず、ターゲットの立場の具体的な困りごとの例に言い換える。
- 事実は必ずブリーフの範囲内（できないことを解決と言わない）。

- 推奨構成（30秒の場合、合計8〜9シーン）。各シーンは画面の文字を読み切れるまで表示される（1シーン約3〜5秒）ので、シーンを増やしすぎない:
  1. logo: 冒頭でブランド名を元気に言う（フック）。lines は主人公がブランド名だけを言う（style:"none"）。subtitle に「〇〇担当の方へ」のように誰向けかを入れる。
  2. talk（問いかけ＋課題の例①）: headline は「こんなお悩み、\\nありませんか？」。主人公が「〇〇担当のみなさん、こんなことで困っていませんか？」とはっきり問いかける（「〇〇の方へ」だけで終わらせない）（style:"bubble-accent"）→ 相方がターゲット本人の立場で、plan.problems[0].voice をそのまま言う（style:"bubble"、pose:"sad"、「〜…」「〜分からない…」など本音の口調）。prop に困りごと①の状況を表すアイコン＋NGバッジ、label は困りごと①の要点を、意味の通る短い言葉で（10文字以内。例:「同じ人か分からない」。「同じ人不明」のような詰めすぎた略語にしない）。decor:"sweat"、showLogo:true。
  3. talk（課題の例②）: headline は plan.problems[1].voice（2行以内）。相方がそれをそのまま言う → 主人公が「それ、よくありますよね」と共感（短く）。prop に困りごと②のアイコン＋NG、label は困りごと②を10文字以内で。transition:"wipe"。
  4. logo（解決の宣言）: 主人公「そのお悩み、〇〇で解決！」（ブランド名を含める）→ 相方「どうやって！？」。subtitle にタグライン。transition:"flash"。
  5〜6. feature ×2（課題①②の解決。順番を対応させる）: eyebrow（1行目・課題の状況を受けた言い方、強調語を[[ ]]で囲む）と headline（特大・6文字以内・「！」で終わる・解決後の状態）。主人公が eyebrow と headline をそれぞれ別セリフで読み上げる（style:"none"、text は eyebrow/headline と同じ文言。[[ ]]は外す）。最後に相方が、困りごとが解消した実感のリアクション（「これなら分かる！」「助かる〜！」等、style:"bubble"）。visual は下の「映像素材の選び方」に従い、解決した様子が一目で分かる実際の画面（ui）かイラスト（illustration）にする。transition は wipe/slide/zoom を混ぜる。
  7. feature（任意・30秒で余裕があれば）: ほかの主なメリットを1つ。
  8. showcase: 実際の製品画面を見せる（アップロードされたスクリーンショット、または「使える製品のUI画面」から選ぶ。どちらも無ければ作らない。疑似の画面は作れない）。title は2行、強調語を[[ ]]。無音にしないよう、主人公が画面の価値をひとこと言う（lines 1つ、style:"bubble"、10文字前後）。
  9. cta: ボタン文言（例「導入のご相談、受付中！」「サービス資料をダウンロード」）と連絡先。主人公が「まずは資料をチェック！」のように行動を促す。
- 15秒なら 5シーン程度（logo→問いかけ＋課題①talk→解決logo→feature×1（課題①の解決）→cta）、30秒なら上記（showcase は最大2つ）、60秒なら課題の例を3つにして feature も3つ＋ほかのメリット最大2つ。
- 専門用語（突合・分断・最適化・可視化・CRM・KPI など）は見出し・セリフに使わない。使うなら日常の言葉で言い換える（例: 突合 → 「名簿を手で照らし合わせる」、可視化 → 「ひと目で分かる」）。
- 1画面に伝えることは1つ。見出しは短く（eyebrow 10文字以内・headline 6文字以内）、同じ内容を文字と声の両方で伝えて、音なしでも分かるようにする。
- シーンの切り替え（特に wipe）には前後 0.3〜0.4 秒かかるので、1シーンのセリフは1〜3個に抑え、細切れのシーンを増やしすぎない。
- ナレーションはテンポの速いCM調（標準の約1.3倍速）で読み上げる。ただし語尾の余韻・感嘆・シーンの切り替えにも尺を使うので、全セリフの合計は 30秒で 110〜130文字程度（15秒なら約55文字、60秒なら約240文字）に収める。これ以上は詰め込まない。

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
- cta の notes は視聴者向けの注記（β版・画面はイメージ・条件など）だけ。ブリーフの「注意事項」に書かれた制作上の指示（〜は載せない、〜を伝える 等）を注記として画面に書かない。
- 事実はブリーフにある情報だけを使う。数字・実績を捏造しない（ブリーフに無ければ counter は使わない）。条件付きの主張には footnote で注記。
- ブランド名は必ずブリーフの表記どおり。

# 映像素材（visual・showcase）の選び方
ぼんやりしたアイコンや矢印の図解は使わない。見た人が「何ができるのか」を一目で理解できる素材だけを使う。
- **ui（実際の製品画面）を最優先**。「使える製品のUI画面」に、その feature の内容を直接見せられる画面があれば、visual.kind:"ui" と uiFile で指定する。
  - 選ぶのは、この商品（または商品に含まれる機能）の画面だけ。別の商品の画面を使わない（ファイル名と説明で判断する）。
  - 分析・管理の機能は PC・管理画面、参加者の体験（受け取る・集める・特典を使う）はスマホ画面が伝わりやすい。
  - 「低画質」の画面は大きく映すとぼやけるので、同じ内容の高画質の画面があればそちらを選ぶ。低画質しか無い時は showcase ではなく illustration を検討する。
- **illustration（画像AIのイラスト）**: 合う画面が無い時。visual.illustration に、その feature で「困りごとが解決した後の場面」を具体的に書く（誰が・どこで・何をしていて・何が良くなったか。例:「イベント会場の受付で、スタッフがタブレットで来場者の参加履歴を一覧で確認し、笑顔でうなずいている。画面にはつながった線でまとまった参加者のアイコン」）。文字は画像に入れないので、文字の指定はしない。
- **counter**: ブリーフに根拠のある数字を強調する時だけ。
- showcase: uiFile に「使える製品のUI画面」から、商品の価値が一番伝わる画面を指定する（高画質を優先。最大2つ。合う画面が無ければ showcase は作らない）。title はその画面で何が分かるかを2行で。アップロードされたスクリーンショットがある場合はそちらを優先し、その showcase の uiFile は null。
- 同じ画面を2回使わない。

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
  uiFile: string | null;
  illustration: string | null;
  counterFrom: number | null;
  counterTo: number | null;
  prefix: string | null;
  suffix: string | null;
  caption: string | null;
};
type AiScene = Record<string, unknown> & { type: Scene['type']; lines: AiLine[]; characters: Record<string, unknown>[] };
export type AiStoryboard = {
  plan?: { viewer: string; problems: { situation: string; voice: string; solution: string; featureEyebrow: string; featureHeadline: string }[] };
  title: string; tagline: string; palette: Record<string, string> | null; scenes: AiScene[] };

const nn = <T,>(v: T | null | undefined) => (v === null ? undefined : v);
const shortId = () => crypto.randomBytes(3).toString('hex');

const toVisual = (v: AiVisual | undefined): Visual => {
  if (!v) return { kind: 'none' };
  let cand: Record<string, unknown> = { kind: 'none' };
  if (v.kind === 'ui' && v.uiFile) cand = { kind: 'screen', src: `ui:${v.uiFile}`, frame: 'browser' };
  else if (v.kind === 'counter' && v.counterTo != null)
    cand = { kind: 'counter', from: v.counterFrom ?? 0, to: v.counterTo, prefix: nn(v.prefix), suffix: nn(v.suffix), caption: nn(v.caption) };
  // イラストは後で画像AIが描く（src が空のうちは表示しない）
  else if (v.illustration) cand = { kind: 'image', src: '', prompt: v.illustration };
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
        cand = { ...base, type: 'showcase', title: x.title, note: nn(x.note), screenshot: x.uiFile ? `ui:${x.uiFile}` : undefined };
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

const callModel = async (system: string, user: string, cast: CastMember[], uiFiles: string[] = []): Promise<AiStoryboard> => {
  const client = getOpenAI();
  const res = await client.responses.create({
    model: config.models.text,
    reasoning: { effort: 'medium' },
    input: [
      { role: 'system', content: system },
      { role: 'user', content: user },
    ],
    text: {
      format: { type: 'json_schema', name: 'ad_storyboard', schema: buildSchema(cast.map((c) => c.id), uiFiles), strict: true },
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
    if (s.screenshot) return [s]; // UIライブラリから選んだ画面
    const shot = shots[i++];
    if (!shot) return [];
    const portrait = shot.size ? shot.size.h >= shot.size.w * 1.2 : true;
    return [{ ...s, screenshot: shot.path, screenshotSize: shot.size, screenshotFrame: portrait ? 'phone' : 'browser' } as Scene];
  });
};

/** @param screenshots 実スクリーンショットの数、またはファイル名（画面の内容の手がかりとして AI に渡す） */
export const generateStoryboard = async (
  brief: Brief,
  cast: CastMember[],
  format: Project['format'] = 'vertical',
  screenshots: number | string[] = 0,
  uiLibrary: UiEntry[] = [],
) => {
  const names = Array.isArray(screenshots) ? screenshots : [];
  const count = Array.isArray(screenshots) ? screenshots.length : screenshots;
  const shotText = names.length
    ? [
        `実スクリーンショット: ${count}枚（showcase シーンの数。この順番で showcase に割り当てる）`,
        ...names.map((n, i) => `  ${i + 1}. ファイル名「${n.replace(/\.[a-z0-9]+$/i, '')}」`),
        '  showcase の title とセリフは、ファイル名から分かる画面の内容に合わせる（違う画面の説明をしない）。これらの showcase では uiFile は null。',
      ].join('\n')
    : `実スクリーンショット（アップロード）: ${count}枚`;
  const catalog = uiLibrary.length
    ? `\n# 使える製品のUI画面（uiFile で指定できる）\n${uiCatalogText(uiLibrary)}`
    : '\n# 使える製品のUI画面\nなし（ui は使えない。feature は illustration か counter、showcase はアップロードされた枚数だけ）';
  const user = `# 登場キャラクター\n${describeCast(cast)}\n\n# 商品ブリーフ\n${briefText(brief)}\n${shotText}${catalog}\n${formatNote(format)}\n\n上記で広告動画の台本JSONを作ってください。`;
  const ai = await callModel(SYSTEM, user, cast, uiLibrary.map((e) => e.file));
  return { ai, scenes: aiToScenes(ai, cast) };
};

export const reviseStoryboard = async (project: Project, instruction: string, uiLibrary: UiEntry[] = []) => {
  const user = `# 登場キャラクター\n${describeCast(project.cast)}\n\n# 商品ブリーフ\n${project.brief ? briefText(project.brief as Brief) : `ブランド名: ${project.brand.name}`}\n\n# 現在の台本\n${JSON.stringify(
    { title: project.title, tagline: project.brand.tagline, scenes: scenesToAi(project.scenes) },
    null,
    1,
  )}\n${formatNote(project.format)}\n\n# 修正指示\n${instruction}\n\n修正指示を反映した台本JSONを、構成全体を返してください（指示と関係ない部分はなるべく維持）。`;
  const ai = await callModel(SYSTEM, user + (uiLibrary.length ? `\n\n# 使える製品のUI画面（uiFile で指定できる）\n${uiCatalogText(uiLibrary)}` : ''), project.cast, uiLibrary.map((e) => e.file));
  return { ai, scenes: aiToScenes(ai, project.cast) };
};
