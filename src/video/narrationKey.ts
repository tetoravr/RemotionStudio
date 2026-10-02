import { elevenSettings, elevenVoiceKey, lineTags, standardRefVoice, stripAudioTags, withAudioTags, type VoiceWithLibrary } from './audioTags';
import { DEFAULT_VOICE_SPEED, type AudioSettings, type CastMember, type Line } from './schema';

/** 53bit の軽量ハッシュ（サーバー・エディター共通で使う） */
const cyrb53 = (str: string, seed = 0) => {
  let h1 = 0xdeadbeef ^ seed;
  let h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(16).padStart(14, '0');
};

export const NARRATOR_VOICE: CastMember['voice'] = {
  voice: 'marin',
  instructions: '明るく聞き取りやすいCMナレーション。自然な話し方で、テンポよく、はっきりと。',
  speed: DEFAULT_VOICE_SPEED,
};

/** 話者の声。ライブラリのキャラは library も付ける（ElevenLabs で標準の声を使うため。ほかのエンジンの同一性には影響しない） */
export const voiceFor = (speaker: string, cast: CastMember[]): VoiceWithLibrary => {
  const m = cast.find((c) => c.id === speaker);
  return m ? { ...m.voice, library: m.library } : NARRATOR_VOICE;
};

/** 読み上げ用テキスト（[[ ]] や改行を除去）。文中に書いたオーディオタグ（[laughs] など）は残す */
export const speechText = (line: Line) => (line.speak || line.text).replace(/\[\[|\]\]/g, '').replace(/\n/g, '');

/** タグを読めないエンジン（Irodori-TTS・OpenAI）向けに、文中のタグも外した読み上げ文 */
export const plainSpeechText = (line: Line) => stripAudioTags(speechText(line));

/** ElevenLabs に送る読み上げ文（先頭にこのセリフのタグを付ける） */
export const elevenSpeechText = (line: Line) => withAudioTags(speechText(line), lineTags(line));

export type TtsProvider = 'elevenlabs' | 'openai' | 'irodori';

/** Irodori-TTS のエンジン ID は `irodori:` で始まる */
export const isIrodoriEngine = (engine: string) => engine.startsWith('irodori');
/** ElevenLabs のエンジン ID は `elevenlabs:` で始まる */
export const isElevenEngine = (engine: string) => engine.startsWith('elevenlabs');

/** Irodori-TTS に渡す声の指定。参照音声があるときはキャプションと衝突しやすいので、キャプションは感情の指示だけにする */
export const irodoriCaption = (voice: VoiceWithLibrary, delivery?: string) => {
  const base = standardRefVoice(voice) ? '' : (voice.caption || voice.instructions || '').trim();
  const d = delivery?.trim() ? `このセリフは「${delivery.trim().replace(/[。.]$/, '')}」という調子で読む。` : '';
  return [base, d].filter(Boolean).join('\n');
};

/**
 * セリフ音声の同一性キー。文言・タグ・声・話速・エンジンが変わったら再生成が必要。
 * @param engine 'elevenlabs:<モデル>'、'irodori:<モデル>'、または OpenAI のモデル名
 */
export const narrationHash = (line: Line, voice: CastMember['voice'], engine: string) => {
  if (isElevenEngine(engine)) {
    const e = elevenSettings(voice);
    return cyrb53(JSON.stringify([elevenSpeechText(line), elevenVoiceKey(voice), e.speed, engine]));
  }
  return cyrb53(
    JSON.stringify(
      isIrodoriEngine(engine)
        ? // ライブラリのキャラは、参照音声が未設定でもそのキャラの標準の声で読む（行ごとに声が変わらないように）
          [plainSpeechText(line), line.emoji ?? '', irodoriCaption(voice, line.delivery), voice.seed ?? null, standardRefVoice(voice) ?? '', voice.speed, engine]
        : [plainSpeechText(line), line.delivery ?? '', voice.voice, voice.instructions, voice.speed, engine],
    ),
  );
};

/**
 * 音声の同一性に入れるエンジンの識別子。ElevenLabs は表現の幅（プロジェクト共通）も含める。
 * エディターとサーバーの両方で、この値を narrationHash / isAudioStale に渡す
 */
export const engineKey = (engine: string, audio?: Pick<AudioSettings, 'elevenStability'>) =>
  isElevenEngine(engine) ? `${engine}|${audio?.elevenStability ?? 'natural'}` : engine;

export const isAudioStale = (line: Line, cast: CastMember[], engine: string) =>
  Boolean(plainSpeechText(line).trim()) && (!line.audio || line.audio.hash !== narrationHash(line, voiceFor(line.speaker, cast), engine));
