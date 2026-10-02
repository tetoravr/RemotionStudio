import { stripAudioTags } from '../../src/video/audioTags';
import { config, hasOpenAI } from '../env';
import { getOpenAI } from './client';

/**
 * 作った音声が台本どおりに読めているかの確認。
 * 文字起こし（Speech to Text）と台本を、表記の違い（カタカナ/ひらがな・記号・空白・英字の大小）を無視して照合する。
 * はっきりしない時は、OpenAI があれば言葉の意味で判定する（漢字/かな/英字の書き方の違いは許す）。
 */

/** 照合用に表記をそろえる。NFKC・カタカナ→ひらがな・英字は小文字・記号/空白/長音を除く */
export const normalizeSpeech = (s: string) =>
  stripAudioTags(s.replace(/\[\[|\]\]/g, ''))
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[ァ-ヶ]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0x60))
    .replace(/[ー〜~]/g, '')
    .replace(/[^\p{L}\p{N}]/gu, '');

/** 最長共通部分列の長さ */
export const lcsLength = (a: string, b: string) => {
  const A = [...a];
  const B = [...b];
  let prev = new Array<number>(B.length + 1).fill(0);
  for (let i = 1; i <= A.length; i++) {
    const cur = new Array<number>(B.length + 1).fill(0);
    for (let j = 1; j <= B.length; j++) cur[j] = A[i - 1] === B[j - 1] ? prev[j - 1] + 1 : Math.max(prev[j], cur[j - 1]);
    prev = cur;
  }
  return prev[B.length];
};

/**
 * 台本と文字起こしの一致度（0〜1）。台本の文字のうち聞き取れた割合から、余計に足された言葉の分を差し引く。
 * expected は「表示の文」と「読み方」の両方を渡し、良い方を使う
 */
export const speechScore = (expected: string[], heard: string) => {
  const h = normalizeSpeech(heard);
  let best = 0;
  for (const e of expected) {
    const n = normalizeSpeech(e);
    if (!n) continue;
    const common = lcsLength(n, h);
    const cover = common / [...n].length;
    const extra = Math.max(0, [...h].length - common) / [...n].length;
    best = Math.max(best, cover - Math.max(0, extra - 0.3) * 0.5);
  }
  return Math.max(0, Math.min(1, best));
};

/** これ以上なら、表記の違いを考えても台本どおり */
export const SURE_OK = 0.85;
/**
 * OpenAI が無い時に、これ未満なら読み違い・途切れとみなす。
 * 文字起こしが漢字をかなで書く（大変→たいへん）だけでも 0.6 前後まで下がるので、はっきりした途切れ・抜けだけを拾う値にする
 */
const FALLBACK_NG = 0.5;

export type SpeechVerdict = { ok: boolean; score: number; heard: string; reason?: string };

const JUDGE_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: { ok: { type: 'boolean' }, reason: { type: 'string' } },
  required: ['ok', 'reason'],
};

/** 言葉の意味で判定する（表記の違いは許す・読み落とし／途中で切れる／違う言葉／余計な言葉は NG） */
const judge = async (expected: string, heard: string): Promise<{ ok: boolean; reason: string }> => {
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
              '日本語の広告ナレーションの音声チェックです。「台本」と、その音声の「文字起こし」を比べてください。',
              '漢字・ひらがな・カタカナ・英字の書き方の違い、句読点、数字の書き方、聞き取りの小さな揺れは問題にしません。',
              '次のどれかがあれば ok=false: 台本の言葉が抜けている／途中で切れている／違う言葉に置き換わっている／台本に無い言葉が足されている（笑い声・ため息などの声の演技は除く）。',
              'reason は ok=false の時に、何が違うかを短い日本語で（ok=true なら空文字）。',
              `台本: ${expected}`,
              `文字起こし: ${heard || '（無音）'}`,
            ].join('\n'),
          },
        ],
      },
    ],
    text: { format: { type: 'json_schema', name: 'speech_check', schema: JUDGE_SCHEMA, strict: true } },
  } as never);
  return JSON.parse((res as { output_text: string }).output_text) as { ok: boolean; reason: string };
};

/** 台本（表示の文・読み方）と文字起こしを照合して、台本どおりかを決める */
export const verdictFor = async (expected: string[], heard: string): Promise<SpeechVerdict> => {
  const score = speechScore(expected, heard);
  if (score >= SURE_OK) return { ok: true, score, heard };
  if (hasOpenAI()) {
    try {
      const j = await judge(expected.filter(Boolean)[0] ?? '', heard);
      return { ok: j.ok, score, heard, reason: j.reason || undefined };
    } catch (e) {
      console.warn(`[speech-check] 判定に失敗しました: ${(e as Error).message}`);
    }
  }
  return { ok: score >= FALLBACK_NG, score, heard, reason: score >= FALLBACK_NG ? undefined : '台本と読み上げが一致しません' };
};

/** 英字の語（ブランド名など）。文字起こしでその表記を使ってもらう */
export const keytermsOf = (text: string) =>
  [
    ...new Set(
      (stripAudioTags(text).match(/[A-Za-z][A-Za-z0-9.&'-]*(?:\s+[A-Za-z][A-Za-z0-9.&'-]*)*/g) ?? [])
        .map((t) => t.trim())
        // 1語 2文字以上・5語まで・50文字未満（Speech to Text の決まり）
        .filter((t) => t.length >= 2 && t.length < 50 && t.split(/\s+/).length <= 5),
    ),
  ].slice(0, 20);
