import { LIBRARY_CHARACTERS } from './library';
import type { CastMember, Line } from './schema';

/**
 * ElevenLabs（Eleven v3）のオーディオタグ。
 * セリフの前に [excited] のように英語で書くと、その気持ち・話し方・声の演技で読まれる。
 * 画面では日本語の名前で選び、保存と送信は英語のタグのまま。
 */
export type AudioTagGroup = 'emotion' | 'delivery' | 'reaction';
export type AudioTagPreset = { tag: string; label: string; group: AudioTagGroup };

export const AUDIO_TAG_GROUPS: { id: AudioTagGroup; label: string }[] = [
  { id: 'emotion', label: '気持ち' },
  { id: 'delivery', label: '話し方' },
  { id: 'reaction', label: '声の演技' },
];

export const AUDIO_TAGS: AudioTagPreset[] = [
  { tag: 'excited', label: 'ワクワク', group: 'emotion' },
  { tag: 'happy', label: '嬉しい', group: 'emotion' },
  { tag: 'cheerfully', label: '明るく', group: 'emotion' },
  { tag: 'surprised', label: '驚き', group: 'emotion' },
  { tag: 'amazed', label: '感動', group: 'emotion' },
  { tag: 'curious', label: '興味津々', group: 'emotion' },
  { tag: 'confident', label: '自信たっぷり', group: 'emotion' },
  { tag: 'proudly', label: '得意げ', group: 'emotion' },
  { tag: 'relieved', label: 'ほっと', group: 'emotion' },
  { tag: 'warmly', label: '優しく', group: 'emotion' },
  { tag: 'sad', label: '悲しい', group: 'emotion' },
  { tag: 'disappointed', label: 'がっかり', group: 'emotion' },
  { tag: 'worried', label: '心配', group: 'emotion' },
  { tag: 'nervous', label: '焦り', group: 'emotion' },
  { tag: 'confused', label: '困惑', group: 'emotion' },
  { tag: 'frustrated', label: 'イライラ', group: 'emotion' },
  { tag: 'sarcastic', label: '皮肉っぽく', group: 'emotion' },
  { tag: 'shy', label: '照れ', group: 'emotion' },
  { tag: 'serious', label: '真剣', group: 'emotion' },
  { tag: 'energetic', label: '元気よく', group: 'delivery' },
  { tag: 'calm', label: '落ち着いて', group: 'delivery' },
  { tag: 'whispers', label: 'ささやき', group: 'delivery' },
  { tag: 'shouts', label: '叫ぶ', group: 'delivery' },
  { tag: 'dramatically', label: '大げさに', group: 'delivery' },
  { tag: 'mischievously', label: 'いたずらっぽく', group: 'delivery' },
  { tag: 'rushed', label: '早口', group: 'delivery' },
  { tag: 'slowly', label: 'ゆっくり', group: 'delivery' },
  { tag: 'laughs', label: '笑う', group: 'reaction' },
  { tag: 'chuckles', label: 'くすっと笑う', group: 'reaction' },
  { tag: 'sighs', label: 'ため息', group: 'reaction' },
  { tag: 'gasps', label: '息をのむ', group: 'reaction' },
  { tag: 'exhales', label: 'ふうっと息', group: 'reaction' },
  { tag: 'crying', label: '泣き声', group: 'reaction' },
];

/** 1セリフに付けるタグの上限（付けすぎると演技が崩れやすい） */
export const MAX_LINE_TAGS = 3;

/** タグとして送れる文字（英字・数字・空白・ハイフン・アポストロフィ） */
export const normalizeTag = (raw: string) =>
  raw
    .replace(/[[\]]/g, '')
    .replace(/[^A-Za-z0-9 '\-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase()
    .slice(0, 40);

export const tagLabel = (tag: string) => AUDIO_TAGS.find((t) => t.tag === tag)?.label ?? tag;

/** 以前の Irodori-TTS の感情の絵文字 → タグ（古いプロジェクトもそのまま気持ちが乗るように） */
export const EMOJI_TAG: Record<string, string> = {
  '😆': 'excited',
  '😊': 'cheerfully',
  '😲': 'surprised',
  '😮': 'gasps',
  '🤔': 'curious',
  '😟': 'worried',
  '😰': 'nervous',
  '🥺': 'sad',
  '😭': 'crying',
  '😠': 'frustrated',
  '🙄': 'sarcastic',
  '😌': 'relieved',
  '😎': 'proudly',
  '💪': 'confident',
  '💥': 'energetic',
  '🫶': 'warmly',
  '🫣': 'shy',
  '🤭': 'chuckles',
  '⏩': 'rushed',
  '🐢': 'slowly',
  '📖': 'calm',
};

/** 演技指示（日本語）の言葉 → タグ。先に書いたものほど優先 */
const DELIVERY_WORDS: [RegExp, string][] = [
  [/ワクワク|わくわく|興奮|テンション(が)?高/, 'excited'],
  [/驚|びっくり|ビックリ/, 'surprised'],
  [/感動|感心|感嘆/, 'amazed'],
  [/嬉し|うれし|喜/, 'happy'],
  [/自信|堂々|きっぱり|力強|言い切/, 'confident'],
  [/得意|ドヤ|誇らし/, 'proudly'],
  // 「安心感を持たせて」は相手を安心させる話し方（自分がほっとするのではない）
  [/安心感|安心させ/, 'warmly'],
  [/ほっと|ホッと|安心(?!感)|安堵/, 'relieved'],
  [/悲し|しょんぼり|落ち込|しゅん/, 'sad'],
  [/がっかり|残念/, 'disappointed'],
  [/心配|不安/, 'worried'],
  [/焦|慌て|あわて/, 'nervous'],
  [/困|戸惑|首をかし|不思議/, 'confused'],
  [/イライラ|不満|うんざり|怒/, 'frustrated'],
  [/呆れ|あきれ|皮肉/, 'sarcastic'],
  [/照れ|恥ずかし/, 'shy'],
  [/興味|好奇心|気にな|疑問|問いかけ|きょとん/, 'curious'],
  [/真剣|まじめ|真面目/, 'serious'],
  [/明る|楽しげ|楽しそう|にこやか|笑顔/, 'cheerfully'],
  [/優し|やさし|穏やか|あたたか|温か|親しみ|語りかけ|共感/, 'warmly'],
  [/元気|はつらつ|ハキハキ|はきはき|勢い/, 'energetic'],
  [/落ち着|冷静|しっとり/, 'calm'],
  [/小声|ささや|ひそひそ/, 'whispers'],
  [/叫|大声|絶叫/, 'shouts'],
  [/大げさ|ドラマチック|芝居がか/, 'dramatically'],
  [/いたずら|からか/, 'mischievously'],
  [/早口|まくした/, 'rushed'],
  [/ゆっくり|のんびり/, 'slowly'],
  [/笑いながら|くすっ|クスッ/, 'chuckles'],
  [/ため息/, 'sighs'],
  [/泣/, 'crying'],
];

/** 演技指示・絵文字から、自動で付けるタグ（最大2つ） */
export const autoTags = (line: Pick<Line, 'emoji' | 'delivery'>): string[] => {
  const out: string[] = [];
  const add = (t?: string) => t && !out.includes(t) && out.length < 2 && out.push(t);
  add(line.emoji ? EMOJI_TAG[line.emoji] : undefined);
  const d = line.delivery ?? '';
  for (const [re, tag] of DELIVERY_WORDS) if (re.test(d)) add(tag);
  return out;
};

/** このセリフで実際に使うタグ。tags を指定していればそれ（[] は「タグなし」）、無ければ自動 */
export const lineTags = (line: Pick<Line, 'tags' | 'emoji' | 'delivery'>): string[] =>
  line.tags ? line.tags.map(normalizeTag).filter(Boolean).slice(0, MAX_LINE_TAGS) : autoTags(line);

/** 文中に書いたタグ（[laughs] など）を取り除く。タグを読めないエンジンや、文字数の見積もりに使う */
export const stripAudioTags = (text: string) =>
  text
    .replace(/\[(?!\[)[^[\]\n]{1,40}\](?!\])/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

/** ElevenLabs に送る読み上げ文。タグを先頭に付ける（文中のタグはそのまま） */
export const withAudioTags = (text: string, tags: string[]) => (tags.length ? `${tags.map((t) => `[${t}]`).join(' ')} ${text}` : text);

/** ElevenLabs の声の設定（未設定の項目は既定値） */
export type ElevenStability = 'creative' | 'natural' | 'robust';
export const ELEVEN_STABILITY: Record<ElevenStability, { value: number; label: string }> = {
  creative: { value: 0, label: '豊か' },
  natural: { value: 0.5, label: '自然' },
  robust: { value: 1, label: '安定' },
};
export const ELEVEN_DEFAULT_SPEED = 1.1;

export const elevenSettings = (voice: CastMember['voice']) => ({
  voiceId: voice.eleven?.voiceId,
  name: voice.eleven?.name,
  stability: (voice.eleven?.stability ?? 'natural') as ElevenStability,
  speed: voice.eleven?.speed ?? ELEVEN_DEFAULT_SPEED,
});

/** 声の設定と、そのキャラのライブラリID（標準の声を探すのに使う） */
export type VoiceWithLibrary = CastMember['voice'] & { library?: string };

/** 標準の声（参照音声）。ライブラリのキャラは、以前のプロジェクトで未設定でも、そのキャラの標準の声 */
export const standardRefVoice = (voice: VoiceWithLibrary) => voice.refVoice ?? (voice.library ? LIBRARY_CHARACTERS[voice.library]?.voice.refVoice : undefined);

/**
 * ElevenLabs で使う声の同一性。声を選んでいればその ID、
 * 無ければ標準の声（参照音声）をクローンした声、それも無ければ声のイメージから作った声。
 */
export const elevenVoiceKey = (voice: VoiceWithLibrary) => {
  const id = voice.eleven?.voiceId;
  if (id) return `id:${id}`;
  const ref = standardRefVoice(voice);
  if (ref) return `ref:${ref}`;
  return `design:${(voice.caption || voice.instructions || '').trim()}`;
};
