import { DEFAULT_VOICE_SPEED } from './schema';
import type { CastMember, Pose } from './schema';

/**
 * 組み込みキャラクター（ライブラリ）。画像は public/characters/<id>/ にあり、
 * 「lib:」で始まるパスとして参照する（プロジェクトへコピーしない）。
 * 各表情に「口を閉じた版」と「口を開けた版」があり、口パクは音声に合わせてこの2枚を切り替える。
 *
 *   人間のキャラクター → 速水さき（hayami-saki）
 *   人外のキャラクター → おすしちゃん（osushi-chan）
 */
export type LibraryCharacter = {
  name: string;
  kind: 'human' | 'creature';
  persona: string;
  poses: Pose[];
  /** 画像の縦横比（幅/高さ） */
  aspect: number;
  voice: CastMember['voice'];
};

export const LIBRARY_CHARACTERS: Record<string, LibraryCharacter> = {
  'hayami-saki': {
    name: '速水さき',
    kind: 'human',
    persona: '20代後半の明るく親しみやすい案内役。サービスの価値を分かりやすく説明する。スマホを片手に持っていることが多い',
    poses: ['default', 'happy', 'surprised', 'sad', 'think', 'point', 'wave', 'wink'],
    aspect: 627 / 1511,
    voice: {
      voice: 'marin',
      instructions:
        '20代後半の日本人女性。明るく親しみやすい、自然な話し方。CMのナレーターのように張りすぎず、友達に説明するようなやわらかいトーンで。文の終わりは自然に下げ、読点でしっかり間をとる。',
      speed: DEFAULT_VOICE_SPEED,
      caption: '20代前半の日本人女性の声。明るく元気で親しみやすい。はっきり聞き取りやすく、テンポよく自然に話す。',
      seed: 42,
      /** 標準の声（public/voices/hayami-saki.wav）。Irodori-TTS でこの声をまねる */
      refVoice: 'hayami-saki',
    },
  },
  'osushi-chan': {
    name: 'おすしちゃん',
    kind: 'creature',
    persona: 'サーモンのにぎり寿司のマスコット。卒業帽をかぶった好奇心旺盛な聞き役で、視聴者の疑問や本音を代弁する',
    poses: ['default', 'happy', 'surprised', 'sad', 'think', 'wink'],
    aspect: 889 / 755,
    voice: {
      voice: 'coral',
      instructions:
        '小さくてかわいいマスコットキャラクターの声。幼く無邪気で、高めの声。ゆっくりめで、語尾をやさしく伸ばす。驚いた時は素直に大きく反応し、悲しい時は小さな声になる。',
      speed: DEFAULT_VOICE_SPEED,
      caption: '小さくてかわいいマスコットの声。幼くて無邪気な、高めの声。のんびりゆっくり話し、語尾をやさしく伸ばす。',
      seed: 7,
      /** 標準の声（public/voices/osushi-chan.wav） */
      refVoice: 'osushi-chan',
    },
  },
};

export const libraryCastMember = (libraryId: string, castId: string = libraryId): CastMember => {
  const c = LIBRARY_CHARACTERS[libraryId];
  if (!c) throw new Error(`unknown library character: ${libraryId}`);
  const base = `lib:characters/${libraryId}/`;
  return {
    id: castId,
    name: c.name,
    persona: c.persona,
    library: libraryId,
    aspect: c.aspect,
    images: Object.fromEntries(c.poses.map((p) => [p, `${base}${p}.webp`])),
    imagesOpen: Object.fromEntries(c.poses.map((p) => [p, `${base}${p}-open.webp`])),
    voice: { ...c.voice },
  };
};
