import type { CastMember, Line } from './schema';

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
  speed: 1.0,
};

export const voiceFor = (speaker: string, cast: CastMember[]): CastMember['voice'] =>
  cast.find((c) => c.id === speaker)?.voice ?? NARRATOR_VOICE;

/** 読み上げ用テキスト（[[ ]] や改行を除去） */
export const speechText = (line: Line) => (line.speak || line.text).replace(/\[\[|\]\]/g, '').replace(/\n/g, '');

/** セリフ音声の同一性キー。文言・声・話速・モデルが変わったら再生成が必要 */
export const narrationHash = (line: Line, voice: CastMember['voice'], ttsModel: string) =>
  cyrb53(JSON.stringify([speechText(line), line.delivery ?? '', voice.voice, voice.instructions, voice.speed, ttsModel]));

export const isAudioStale = (line: Line, cast: CastMember[], ttsModel: string) =>
  Boolean(speechText(line).trim()) && (!line.audio || line.audio.hash !== narrationHash(line, voiceFor(line.speaker, cast), ttsModel));
