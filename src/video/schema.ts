import { z } from 'zod';

/**
 * 1本の広告動画を表すプロジェクトデータ。
 * エディター / AI台本生成 / Remotionレンダラーが全てこの形式を共有する。
 *
 * テキスト内の [[ ]] で囲んだ部分はブランドカラーで強調表示される。
 * 改行は "\n" で明示する（日本語の広告コピーは意図的な改行位置が重要なため）。
 */

export const FORMATS = {
  vertical: { width: 1080, height: 1920, label: '縦型 9:16（リール/TikTok/ショート）' },
  square: { width: 1080, height: 1080, label: '正方形 1:1（フィード）' },
  horizontal: { width: 1920, height: 1080, label: '横型 16:9（YouTube/サイネージ）' },
} as const;
export type FormatId = keyof typeof FORMATS;

export const ICON_NAMES = [
  'phone', 'store', 'card', 'check', 'bolt', 'document', 'coin', 'yen', 'bank', 'shield',
  'clock', 'chart', 'gift', 'bell', 'chat', 'mail', 'calendar', 'heart', 'star', 'rocket',
  'cart', 'truck', 'lock', 'users', 'user', 'sparkles', 'wallet', 'globe', 'laptop', 'cloud',
  'receipt', 'handshake', 'piggy', 'search', 'settings', 'send', 'home', 'camera', 'ticket',
  'building', 'box', 'qr', 'leaf', 'coffee', 'music', 'car', 'plane', 'megaphone', 'target',
  'trophy', 'thumbsup', 'smile', 'x', 'alert', 'hourglass', 'percent', 'pen', 'key',
] as const;
export const IconName = z.enum(ICON_NAMES);
export type IconName = z.infer<typeof IconName>;

export const POSES = ['default', 'happy', 'surprised', 'sad', 'think', 'point', 'wave', 'wink'] as const;
export const Pose = z.enum(POSES);
export type Pose = z.infer<typeof Pose>;

export const BACKGROUNDS = ['burst', 'burst-light', 'burst-dark', 'stripes', 'stripes-dark', 'dots', 'gradient', 'plain'] as const;
export const BackgroundKind = z.enum(BACKGROUNDS);
export type BackgroundKind = z.infer<typeof BackgroundKind>;

export const TRANSITIONS = ['wipe', 'cut', 'flash', 'zoom', 'slide'] as const;
export const TransitionKind = z.enum(TRANSITIONS);
export type TransitionKind = z.infer<typeof TransitionKind>;

export const AudioRef = z.object({
  src: z.string(),
  durationSec: z.number(),
  /** テキスト・声質の変更検知用ハッシュ（変わっていたら再生成が必要） */
  hash: z.string(),
  /** 口パク用の口の開き（30Hz、0=閉じ / 1=開き）。音声の音量から算出 */
  mouth: z.array(z.number().int().min(0).max(2)).optional(),
});
export type AudioRef = z.infer<typeof AudioRef>;

export const Line = z.object({
  id: z.string(),
  /** cast の id。'narrator' ならキャラ無しのナレーション（字幕表示） */
  speaker: z.string(),
  /** 画面に表示するセリフ */
  text: z.string(),
  /** 読み上げ用テキスト（難読語をひらがなにする等）。空なら text を読む */
  speak: z.string().optional(),
  /**
   * 吹き出しのしっぽ。先端の位置を自動の位置からずらす量（コンポジション px）。
   * 先端を吹き出しの上下左右どちらに置くかで、しっぽの向きも決まる。hidden でしっぽなし
   */
  tail: z.object({ dx: z.number().default(0), dy: z.number().default(0), hidden: z.boolean().optional() }).optional(),
  /** このセリフ中の話者ポーズ */
  pose: Pose.optional(),
  /** 演技指示（声のトーン）。例: 「驚いて」「落ち込んで小声で」「元気よく」 */
  delivery: z.string().optional(),
  /** Irodori-TTS 用の感情・非言語の絵文字（以前の形式。ElevenLabs ではタグに変換して使う）。例: 😲 😆 🥺 */
  emoji: z.string().optional(),
  /**
   * ElevenLabs のオーディオタグ（英語・角かっこなし）。例: ["excited"] ["sighs", "sad"]
   * セリフの前に [excited] のように付けて読む。未指定なら演技指示・絵文字から自動で付ける。[] はタグなし
   */
  tags: z.array(z.string().max(40)).max(6).optional(),
  style: z.enum(['bubble', 'bubble-accent', 'caption', 'none']).default('bubble'),
  audio: AudioRef.optional(),
  /** セリフ後の間（秒） */
  pauseAfterSec: z.number().min(0).max(3).optional(),
});
export type Line = z.infer<typeof Line>;

export const CharacterPlacement = z.object({
  id: z.string(),
  pose: Pose.default('default'),
  position: z.enum(['far-left', 'left', 'center', 'right', 'far-right']).default('center'),
  size: z.enum(['s', 'm', 'l', 'xl']).default('m'),
  enter: z.enum(['jump', 'slide', 'pop', 'drop', 'none']).default('pop'),
  enterDelaySec: z.number().min(0).max(10).default(0),
  flip: z.boolean().default(false),
});
export type CharacterPlacement = z.infer<typeof CharacterPlacement>;

export const Visual = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('none') }),
  z.object({
    kind: z.literal('flow'),
    from: IconName,
    to: IconName,
    fromLabel: z.string().optional(),
    toLabel: z.string().optional(),
    effect: z.enum(['coins', 'sparkles', 'confetti', 'none']).default('coins'),
  }),
  z.object({ kind: z.literal('stack'), icon: IconName, count: z.number().int().min(2).max(6).default(4) }),
  z.object({ kind: z.literal('jump'), obstacleLabel: z.string(), goal: IconName }),
  z.object({
    kind: z.literal('counter'),
    from: z.number(),
    to: z.number(),
    prefix: z.string().optional(),
    suffix: z.string().optional(),
    decimals: z.number().int().min(0).max(2).optional(),
    caption: z.string().optional(),
  }),
  z.object({
    kind: z.literal('icons'),
    items: z.array(z.object({ icon: IconName, label: z.string() })).min(1).max(3),
  }),
  z.object({
    kind: z.literal('compare'),
    before: z.object({ icon: IconName, label: z.string() }),
    after: z.object({ icon: IconName, label: z.string() }),
  }),
  /** 画像（AIで作ったイラストなど）。prompt は作り直し用の指示文。src が空なら未生成 */
  z.object({ kind: z.literal('image'), src: z.string(), prompt: z.string().optional() }),
  /** 実際の画面（UIスクリーンショット）。スマホ枠／ブラウザ枠で見せる */
  z.object({
    kind: z.literal('screen'),
    src: z.string(),
    frame: z.enum(['phone', 'browser']).default('browser'),
    size: z.object({ w: z.number(), h: z.number() }).optional(),
  }),
]);
export type Visual = z.infer<typeof Visual>;

/** 動画内の要素1つぶんの調整（直接調整で保存される）。移動・拡大縮小・回転・非表示 */
export const ElementAdjust = z.object({
  /** 移動量（コンポジション px） */
  dx: z.number().default(0),
  dy: z.number().default(0),
  scale: z.number().min(0.1).max(6).default(1),
  /** 回転（度） */
  rotate: z.number().default(0),
  /** 拡大・回転の中心（コンポジション座標）。未設定なら要素の中心 */
  px: z.number().optional(),
  py: z.number().optional(),
  hidden: z.boolean().optional(),
  /** 文字の揃え（文字を含む要素のみ） */
  align: z.enum(['left', 'center', 'right']).optional(),
  /** 重なり順（直接調整で最後に触ったものほど大きい＝手前） */
  z: z.number().int().optional(),
  /** 吹き出しのしっぽ（吹き出しの要素のみ）。先端を自動の位置からずらす量。hidden でしっぽなし */
  tail: z.object({ dx: z.number().default(0), dy: z.number().default(0), hidden: z.boolean().optional() }).optional(),
});

/** 画面の形ごとの要素の調整（縦型で動かしても横型には影響しない） */
export const SceneLayouts = z.object({
  vertical: z.record(z.string(), ElementAdjust).optional(),
  square: z.record(z.string(), ElementAdjust).optional(),
  horizontal: z.record(z.string(), ElementAdjust).optional(),
});
export type ElementAdjust = z.infer<typeof ElementAdjust>;

const sceneBase = {
  id: z.string(),
  /** 画面の形 -> 要素ID -> 調整。IDは各シーンの Editable と対応（例: headline / char:0 / line:<セリフID>） */
  layouts: SceneLayouts.optional(),
  /** 旧形式（画面の形を区別しない調整）。読み込み時に layouts へ移す */
  layout: z.record(z.string(), ElementAdjust).optional(),
  lines: z.array(Line).default([]),
  characters: z.array(CharacterPlacement).default([]),
  /** このシーンに入る時のトランジション */
  transition: TransitionKind.default('cut'),
  background: BackgroundKind.optional(),
  /** 最低表示時間（秒）。セリフが長ければ自動で延びる */
  minDurationSec: z.number().min(0.5).max(15).optional(),
  /**
   * シーンの長さ（秒）を手で決める。未指定なら自動（セリフの長さと文字を読む時間から決まる）。
   * セリフの音声は切らないので、最後のセリフが言い終わるまでより短くはならない
   */
  lengthSec: z.number().min(0.3).max(60).optional(),
};

export const LogoScene = z.object({
  ...sceneBase,
  type: z.literal('logo'),
  /** 空ならブランド名 */
  logoText: z.string().optional(),
  subtitle: z.string().optional(),
  ticker: z.boolean().default(true),
});
export const TalkScene = z.object({
  ...sceneBase,
  type: z.literal('talk'),
  /** 上部に小さくロゴを出す */
  showLogo: z.boolean().default(false),
  headline: z.string().optional(),
  decor: z.enum(['none', 'question', 'sparkle', 'sweat', 'heart', 'exclaim']).default('none'),
  /** 話の小道具（落ちてくるアイコン） */
  prop: z
    .object({
      icon: IconName,
      badge: z.enum(['none', 'ng', 'ok']).default('none'),
      label: z.string().optional(),
      /** AIで作った（またはアップロードした）図解イラスト。あれば、アイコンのカードの代わりに大きく見せる */
      image: z.string().optional(),
    })
    .optional(),
});
export const FeatureScene = z.object({
  ...sceneBase,
  type: z.literal('feature'),
  /** 1行目（小さめ）例: "[[与信審査]]なしで" */
  eyebrow: z.string(),
  /** 2行目（特大）例: "導入！" */
  headline: z.string(),
  footnote: z.string().optional(),
  visual: Visual.default({ kind: 'none' }),
});
export const ShowcaseScene = z.object({
  ...sceneBase,
  type: z.literal('showcase'),
  title: z.string(),
  note: z.string().optional(),
  /** 実際の画面のスクリーンショット（アプリ・管理画面・Webページなど）。UIの疑似モックは使わない */
  screenshot: z.string().optional(),
  /** スクリーンショットの実寸（アップロード時に自動設定）。縦に長い画面はスクロールして見せる */
  screenshotSize: z.object({ w: z.number(), h: z.number() }).optional(),
  /** phone = スマホ枠 / browser = ブラウザ窓 */
  screenshotFrame: z.enum(['phone', 'browser']).default('phone'),
});
export const CtaScene = z.object({
  ...sceneBase,
  type: z.literal('cta'),
  logoText: z.string().optional(),
  buttonText: z.string(),
  contact: z.string().optional(),
  notes: z.array(z.string()).default([]),
});

export const Scene = z.discriminatedUnion('type', [LogoScene, TalkScene, FeatureScene, ShowcaseScene, CtaScene]);
export type Scene = z.infer<typeof Scene>;
export type SceneType = Scene['type'];
export type SceneOf<T extends SceneType> = Extract<Scene, { type: T }>;

/** 話速の既定値。台本の文字数もこの速さを前提に決める */
export const DEFAULT_VOICE_SPEED = 1.3;

export const CastMember = z.object({
  id: z.string(),
  name: z.string(),
  /** キャラ設定（AI台本に使う） */
  persona: z.string().default(''),
  /** ライブラリキャラのID（hayami-saki / osushi-chan）。カスタムキャラは未設定 */
  library: z.string().optional(),
  /** 画像の縦横比（幅/高さ）。縦長の人物と横長のマスコットで、表示サイズを揃えるのに使う */
  aspect: z.number().optional(),
  /** 表情 -> 口を閉じた全身画像。パスは assets/ 相対、または lib:（組み込みライブラリ）、URL */
  images: z.partialRecord(Pose, z.string()).default({}),
  /** 表情 -> 口を開けた全身画像（口パク用。口以外は images と同一） */
  imagesOpen: z.partialRecord(Pose, z.string()).default({}),
  voice: z.object({
    /** OpenAI TTS のボイス名 */
    voice: z.string().default('marin'),
    /** OpenAI TTS 用の話し方の指示 */
    instructions: z.string().default(''),
    speed: z.number().min(0.5).max(2).default(DEFAULT_VOICE_SPEED),
    /** Irodori-TTS 用の声のデザイン（キャプション）。例: 「落ち着いた低めの女性の声。丁寧で穏やかな話し方」。空なら instructions を使う */
    caption: z.string().optional(),
    /** Irodori-TTS の乱数シード。同じ値なら同じ声になりやすい（キャラごとに固定） */
    seed: z.number().int().optional(),
    /** Irodori-TTS サーバーに登録した参照音声の voice ID（声を固定したい時）。ElevenLabs ではこの音声をクローンした声を使う */
    refVoice: z.string().optional(),
    /** ElevenLabs の声。voiceId が無ければ、参照音声（標準の声）のクローン、または声のイメージから作った声を使う */
    eleven: z
      .object({
        voiceId: z.string().optional(),
        /** 画面に出す声の名前 */
        name: z.string().optional(),
        /** 話す速さ（1 = その声の自然な速さ） */
        speed: z.number().min(0.7).max(1.5).optional(),
      })
      .optional(),
  }),
});
export type CastMember = z.infer<typeof CastMember>;

export const Brand = z.object({
  name: z.string(),
  tagline: z.string().default(''),
  logo: z.string().optional(),
  colors: z.object({
    primary: z.string().default('#1f5cff'),
    dark: z.string().default('#0d1b5e'),
    accent: z.string().default('#ffd93b'),
    light: z.string().default('#eaf0ff'),
    text: z.string().default('#15172b'),
  }),
  font: z.enum(['noto', 'rounded', 'dela']).default('noto'),
});
export type Brand = z.infer<typeof Brand>;

export const AudioSettings = z.object({
  bgm: z.string().optional(),
  bgmVolume: z.number().min(0).max(1).default(0.32),
  /** BGMのBPM。シーン切替をビートに合わせる（0で無効） */
  bpm: z.number().min(0).max(240).default(150),
  sfx: z.boolean().default(true),
  sfxVolume: z.number().min(0).max(1).default(0.6),
  narration: z.boolean().default(true),
  /** 音声合成エンジン。auto = サーバーの設定（TTS_PROVIDER。既定は ElevenLabs）に従う */
  ttsProvider: z.enum(['auto', 'elevenlabs', 'openai', 'irodori']).default('auto'),
  /**
   * ElevenLabs の表現の幅（全セリフ共通。全体を1回で読むので声ごとには分けない）。
   * creative=感情豊か（タグが効きやすいが崩れやすい）/ natural / robust=安定
   */
  elevenStability: z.enum(['creative', 'natural', 'robust']).default('natural'),
  narrationVolume: z.number().min(0).max(2).default(1),
});
export type AudioSettings = z.infer<typeof AudioSettings>;

export const Project = z.object({
  version: z.literal(1).default(1),
  id: z.string(),
  title: z.string(),
  format: z.enum(['vertical', 'square', 'horizontal']).default('vertical'),
  fps: z.number().int().min(24).max(60).default(30),
  brand: Brand,
  cast: z.array(CastMember).default([]),
  audio: AudioSettings.default(AudioSettings.parse({})),
  /** 字幕（セリフを画面下に出す）。吹き出しと併用可 */
  subtitles: z.boolean().default(false),
  scenes: z.array(Scene),
  /** AI台本生成時の元ブリーフ（再生成用） */
  brief: z.record(z.string(), z.unknown()).optional(),
  updatedAt: z.string().optional(),
  /** 最後に編集した人（ログイン時のメールアドレス） */
  updatedBy: z.string().optional(),
});
export type Project = z.infer<typeof Project>;
export type ProjectInput = z.input<typeof Project>;

/** Remotion コンポジションに渡す props */
export const AdVideoProps = z.object({
  project: Project,
  /** プロジェクト assets を解決するベースURL（末尾 / 付き）。空なら staticFile 相対 */
  assetBaseUrl: z.string().default(''),
});
export type AdVideoProps = z.infer<typeof AdVideoProps>;
