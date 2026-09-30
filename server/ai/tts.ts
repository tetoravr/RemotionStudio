import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { irodoriCaption, narrationHash, type TtsProvider } from '../../src/video/narrationKey';
import type { AudioSettings, CastMember, Line } from '../../src/video/schema';
import { config } from '../env';
import { runFfmpeg, wavDurationSec } from '../ffmpeg';
import { getOpenAI } from './client';
import { applyEq, bandProfile, correctionCurve, EQ_ENABLED, eqKey, loadEq, saveEq } from './voiceEq';
import { ensureVoice, localVoiceFile, localVoices } from './voices';

export const OPENAI_VOICES = [
  { id: 'coral', label: 'Coral（明るい女性）' },
  { id: 'shimmer', label: 'Shimmer（やわらかい女性）' },
  { id: 'nova', label: 'Nova（元気な女性）' },
  { id: 'sage', label: 'Sage（落ち着いた女性）' },
  { id: 'fable', label: 'Fable（中性的・かわいい）' },
  { id: 'ballad', label: 'Ballad（やさしい男性）' },
  { id: 'alloy', label: 'Alloy（ニュートラル）' },
  { id: 'ash', label: 'Ash（はっきりした男性）' },
  { id: 'echo', label: 'Echo（落ち着いた男性）' },
  { id: 'onyx', label: 'Onyx（低い男性）' },
  { id: 'verse', label: 'Verse（表情豊か）' },
  { id: 'marin', label: 'Marin（自然な女性）' },
  { id: 'cedar', label: 'Cedar（自然な男性）' },
];

export { NARRATOR_VOICE, speechText, voiceFor } from '../../src/video/narrationKey';

export type { TtsProvider };

const IRODORI_FALLBACK_URL = 'http://127.0.0.1:8088';

/** 声は Irodori-TTS 固定（OpenAI TTS は不採用）。設定値は互換のため受け取るだけで無視する */
export const resolveProvider = (_setting: AudioSettings['ttsProvider'] = 'auto'): TtsProvider => 'irodori';

/** 音声の同一性キーに入れるエンジン ID */
export const engineId = (provider: TtsProvider) => (provider === 'irodori' ? `irodori:${config.tts.irodoriModel}` : config.models.tts);

export const lineHash = (line: Line, voice: CastMember['voice'], provider: TtsProvider) => narrationHash(line, voice, engineId(provider));

export const irodoriBase = () => config.tts.irodoriUrl || IRODORI_FALLBACK_URL;
/** json=false は multipart 送信用（Content-Type は fetch に任せる） */
export const irodoriHeaders = (json = true): Record<string, string> => ({
  ...(json ? { 'Content-Type': 'application/json' } : {}),
  ...(config.tts.irodoriKey ? { Authorization: `Bearer ${config.tts.irodoriKey}` } : {}),
});

export type IrodoriStatus = { online: boolean; url: string; checkpoint?: string; device?: string; voices: string[]; labels?: Record<string, string>; error?: string };

/** Irodori-TTS サーバーの状態（エディターの表示用） */
export const irodoriStatus = async (): Promise<IrodoriStatus> => {
  const url = irodoriBase();
  try {
    const health = (await (await fetch(`${url}/health`, { headers: irodoriHeaders(), signal: AbortSignal.timeout(2500) })).json()) as {
      model?: { hf_checkpoint?: string; model_device?: string };
    };
    let voices: string[] = [];
    try {
      const v = (await (await fetch(`${url}/v1/audio/voices`, { headers: irodoriHeaders(), signal: AbortSignal.timeout(2500) })).json()) as {
        data?: { id?: string; name?: string }[];
        voices?: (string | { id?: string; name?: string })[];
      };
      const list = v.data ?? v.voices ?? [];
      voices = list.map((x) => (typeof x === 'string' ? x : x.id ?? x.name ?? '')).filter((x) => x && x !== 'none');
    } catch {
      /* 参照音声の一覧は無くても動く */
    }
    // このアプリで作った参照音声は、サーバーから消えていても合成時に控えから再登録される
    const local = await localVoices();
    voices = [...new Set([...voices, ...local.map((v) => v.id)])];
    return { online: true, url, checkpoint: health.model?.hf_checkpoint, device: health.model?.model_device, voices, labels: Object.fromEntries(local.map((v) => [v.id, v.label])) };
  } catch (e) {
    return { online: false, url, voices: [], error: (e as Error).message };
  }
};

const TTS_RATE = 24000; // OpenAI の pcm 出力は 24kHz / 16bit / mono

/**
 * 前後の無音だけを軽く切り、音量を揃える。
 * 息継ぎや語尾の余韻は自然さに効くので、削りすぎない（先頭 80ms / 末尾 140ms の余白を残す）。
 */
export const trimAndNormalize = (input: Int16Array | Float32Array, rate = TTS_RATE) => {
  const f = input instanceof Int16Array ? Float32Array.from(input, (v) => v / 32768) : Float32Array.from(input);
  const win = Math.round(rate * 0.01);
  let absPeak = 0;
  for (const v of f) absPeak = Math.max(absPeak, Math.abs(v));
  const thr = Math.max(0.004, absPeak * 0.02);
  const loud = (i: number) => {
    let m = 0;
    for (let k = i; k < Math.min(f.length, i + win); k++) m = Math.max(m, Math.abs(f[k]));
    return m > thr;
  };
  let start = 0;
  while (start < f.length && !loud(start)) start += win;
  let end = f.length;
  while (end > start && !loud(Math.max(0, end - win))) end -= win;
  ({ start, end } = speechRange(f, rate, start, end));
  start = Math.max(0, start - Math.round(rate * 0.08));
  end = Math.min(f.length, end + Math.round(rate * 0.14));
  const out = compressSilences(f.slice(start, Math.max(start + 1, end)), rate);
  // 音声部分の RMS を -16dBFS に揃える（ピークは -1dBFS で制限）
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (const v of out) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > 0.01) {
      sum += v * v;
      n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const gain = Math.min(Math.pow(10, -16 / 20) / Math.max(1e-4, rms), Math.pow(10, -1 / 20) / Math.max(1e-4, peak));
  const fade = Math.round(rate * 0.012);
  const fadeOut = Math.round(rate * 0.06);
  for (let i = 0; i < out.length; i++) {
    const e = Math.min(1, i / fade, (out.length - 1 - i) / fadeOut);
    out[i] = Math.max(-1, Math.min(1, out[i] * gain * e));
  }
  return out;
};

/**
 * 発話のあとに取り残された、小さくて短い孤立音（息・クリック・ノイズ）を落として、本当の終わりの位置を返す。
 * TTS（特に感情の絵文字つき）は、発話が終わって少し間があいたあとに、小さな音が付くことがある。
 * 判定: 直前の音との間が 0.15 秒以上あり、かつ 音量が本体の 30% 未満 か 0.12 秒未満。
 */
/**
 * 声の本体の範囲（サンプル位置）。読み始めの前・読み終わりの後に、間をあけて取り残された短い音（息・クリック・笑い声のかけら）を外す。
 * 外す条件: 本体との間が 0.15 秒以上で「小さい（本体の30%未満）か 0.12 秒未満」、または 間が 0.35 秒以上で 0.35 秒未満の音。
 */
export const speechRange = (f: Float32Array, rate: number, start: number, end: number) => {
  const hop = Math.round(rate * 0.01);
  const n = Math.floor((end - start) / hop);
  if (n < 4) return { start, end };
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = start + i * hop; k < start + (i + 1) * hop; k++) sum += f[k] * f[k];
    rms.push(Math.sqrt(sum / hop));
  }
  const max = Math.max(...rms);
  const on = rms.map((v) => v > max * 0.05);
  const gapMax = 15;
  const islands: { a: number; b: number; peak: number; energy: number }[] = [];
  let i = 0;
  while (i < n) {
    if (!on[i]) {
      i++;
      continue;
    }
    let last = i;
    let peak = 0;
    let energy = 0;
    for (let j = i; j < n && j - last <= gapMax; j++) {
      if (on[j]) {
        last = j;
        peak = Math.max(peak, rms[j]);
      }
      energy += rms[j] * rms[j];
    }
    islands.push({ a: i, b: last + 1, peak, energy });
    i = last + 1;
  }
  if (!islands.length) return { start, end };
  // 一番エネルギーの大きいかたまりを「本体」とし、両端の取り残された音を外していく
  const main = islands.reduce((m, x) => (x.energy > m.energy ? x : m));
  const stray = (x: (typeof islands)[number], gap: number) =>
    x !== main && ((gap >= gapMax && (x.peak < max * 0.3 || x.b - x.a < 12)) || (gap >= 35 && x.b - x.a < 35));
  while (islands.length > 1 && stray(islands[islands.length - 1], islands[islands.length - 1].a - islands[islands.length - 2].b)) islands.pop();
  while (islands.length > 1 && stray(islands[0], islands[1].a - islands[0].b)) islands.shift();
  return { start: start + islands[0].a * hop, end: Math.min(end, start + islands[islands.length - 1].b * hop) };
};

/** 発話の途中の長すぎる無音（0.45 秒超）を 0.3 秒に詰める。短いセリフが間延びしたり、途切れて聞こえるのを防ぐ */
export const compressSilences = (f: Float32Array, rate: number, maxGap = 0.45, keep = 0.3) => {
  const hop = Math.round(rate * 0.01);
  const n = Math.floor(f.length / hop);
  let max = 0;
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    for (let k = i * hop; k < (i + 1) * hop; k++) sum += f[k] * f[k];
    rms.push(Math.sqrt(sum / hop));
    max = Math.max(max, rms[i]);
  }
  const quiet = rms.map((v) => v < max * 0.03);
  const cut: [number, number][] = [];
  for (let i = 0; i < n; ) {
    if (!quiet[i]) {
      i++;
      continue;
    }
    let j = i;
    while (j < n && quiet[j]) j++;
    // 先頭・末尾の無音は trimAndNormalize が扱うので、途中だけ
    if (i > 0 && j < n && (j - i) * hop > maxGap * rate) {
      const half = Math.round((keep * rate) / 2);
      cut.push([i * hop + half, j * hop - half]);
    }
    i = j;
  }
  if (!cut.length) return f;
  const parts: Float32Array[] = [];
  let pos = 0;
  for (const [a, b] of cut) {
    parts.push(f.subarray(pos, a));
    pos = b;
  }
  parts.push(f.subarray(pos));
  const out = new Float32Array(parts.reduce((s, p) => s + p.length, 0));
  let o = 0;
  for (const p of parts) (out.set(p, o), (o += p.length));
  return out;
};

/** 互換用（末尾だけを見る旧版） */
export const dropTrailingNoise = (f: Float32Array, rate: number, start: number, end: number) => speechRange(f, rate, start, end).end;

export const encodeWav = (samples: Float32Array, rate: number) => {
  const buf = Buffer.alloc(44 + samples.length * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + samples.length * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(samples.length * 2, 40);
  for (let i = 0; i < samples.length; i++) buf.writeInt16LE(Math.round(samples[i] * 32767), 44 + i * 2);
  return buf;
};

/** WAV（PCM 16/24/32bit・float32・多チャンネル）を、モノラルの Float32 にして取り出す */
export const readWavSamples = (buf: Buffer): { samples: Float32Array; rate: number } => {
  let offset = 12;
  let rate = 44100;
  let format = 1;
  let channels = 1;
  let bits = 16;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') {
      format = buf.readUInt16LE(offset + 8);
      channels = Math.max(1, buf.readUInt16LE(offset + 10));
      rate = buf.readUInt32LE(offset + 12);
      bits = buf.readUInt16LE(offset + 22);
      if (format === 0xfffe && size >= 26) format = buf.readUInt16LE(offset + 32); // WAVE_FORMAT_EXTENSIBLE
    }
    if (id === 'data') {
      const bytes = bits / 8;
      const avail = Math.min(size >>> 0, buf.length - offset - 8);
      const frames = Math.floor(avail / (bytes * channels));
      const at = (i: number) => {
        const o = offset + 8 + i * bytes;
        if (format === 3) return bits === 64 ? buf.readDoubleLE(o) : buf.readFloatLE(o);
        if (bits === 16) return buf.readInt16LE(o) / 32768;
        if (bits === 24) return buf.readIntLE(o, 3) / 8388608;
        if (bits === 32) return buf.readInt32LE(o) / 2147483648;
        if (bits === 8) return (buf.readUInt8(o) - 128) / 128;
        throw new Error(`unsupported wav: ${bits}bit`);
      };
      const samples = new Float32Array(frames);
      for (let f = 0; f < frames; f++) {
        let sum = 0;
        for (let c = 0; c < channels; c++) sum += at(f * channels + c);
        samples[f] = sum / channels;
      }
      return { samples, rate };
    }
    offset += 8 + size + (size % 2);
  }
  throw new Error('invalid wav');
};

/**
 * 口パク用の口の開閉（30Hz）。1/30秒ごとの音量から、開いている(1)/閉じている(0)を決める。
 * アニメの口パクらしく、1フレームだけの開閉は避け（最小2フレーム保持）、短い隙間は埋める。
 */
export const mouthEnvelope = (samples: Float32Array, rate: number, hz = 30): number[] => {
  const hop = rate / hz;
  const n = Math.ceil(samples.length / hop);
  const rms: number[] = [];
  for (let i = 0; i < n; i++) {
    let sum = 0;
    const a = Math.floor(i * hop);
    const b = Math.min(samples.length, Math.floor((i + 1) * hop));
    for (let k = a; k < b; k++) sum += samples[k] * samples[k];
    rms.push(Math.sqrt(sum / Math.max(1, b - a)));
  }
  const sorted = [...rms].sort((x, y) => x - y);
  const p90 = sorted[Math.floor(sorted.length * 0.9)] || 0.1;
  const on = p90 * 0.28;
  const off = p90 * 0.16; // ヒステリシス
  let open = false;
  const raw = rms.map((v) => {
    open = open ? v > off : v > on;
    return open ? 1 : 0;
  });
  // 1フレームの隙間を埋め、1フレームだけの開きを消す
  for (let i = 1; i < n - 1; i++) if (!raw[i] && raw[i - 1] && raw[i + 1]) raw[i] = 1;
  for (let i = 1; i < n - 1; i++) if (raw[i] && !raw[i - 1] && !raw[i + 1]) raw[i] = 0;
  return raw;
};

export type SynthOptions = {
  /** セリフごとの演技指示（例: 「驚いて」） */
  delivery?: string;
  /** Irodori-TTS の感情絵文字（セリフの前に付けて読み上げる） */
  emoji?: string;
  provider?: TtsProvider;
  /** 乱数シードを上書きする（崩れた音声を作り直す時に使う） */
  seed?: number;
};

/** 読み上げる文字数（記号・空白を除く） */
export const spokenChars = (text: string) => text.replace(/[\s、。，．,.！？!?…・「」『』（）()ー〜~"'“”]/g, '').length;

/** 文字数と話速から見た、自然な長さ（秒）の目安 */
export const expectedSpeechSec = (text: string, speed = 1) => spokenChars(text) / (7 * Math.max(0.5, speed)) + 0.35;

/** OpenAI TTS: 24kHz の PCM */
const synthOpenAI = async (text: string, voice: CastMember['voice'], delivery?: string) => {
  const client = getOpenAI();
  const instructions = [voice.instructions, delivery ? `このセリフは「${delivery}」という気持ちで読む。` : ''].filter(Boolean).join('\n');
  const res = await client.audio.speech.create({
    model: config.models.tts,
    voice: voice.voice as 'coral',
    input: text,
    instructions: instructions || undefined,
    response_format: 'pcm',
    // 話速は生成時に付ける（同梱の ffmpeg には早回しのフィルターが無いので、あとから伸縮しない）
    speed: Math.min(4, Math.max(0.25, voice.speed || 1)),
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const even = raw.subarray(0, raw.length - (raw.length % 2));
  return { samples: new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length)), rate: TTS_RATE };
};

/**
 * 話速（×1.3 など）を Irodori の duration_scale に直す。
 * Irodori は duration_scale を半分にしても発話は半分にならない（間や語尾で吸収される）ので、実測した対応表で補正する。
 * 実測（参照音声・4文の平均）: 0.77→1.19倍 / 0.65→1.39倍 / 0.55→1.65倍 / 0.45→2.05倍
 */
const SPEED_TABLE: [number, number][] = [
  [1, 1],
  [1.19, 0.77],
  [1.39, 0.65],
  [1.65, 0.55],
  [2.05, 0.45],
];
export const irodoriDurationScale = (speed: number) => {
  if (speed <= 1) return Math.min(1.6, 1 / Math.max(0.5, speed));
  const t = SPEED_TABLE;
  for (let i = 1; i < t.length; i++) {
    if (speed <= t[i][0]) {
      const [s0, d0] = t[i - 1];
      const [s1, d1] = t[i];
      return d0 + ((speed - s0) / (s1 - s0)) * (d1 - d0);
    }
  }
  return t[t.length - 1][1];
};

/** Irodori-TTS（OpenAI 互換サーバー）: 48kHz の WAV。声はキャプション（声のデザイン）＋固定シード、または参照音声で決める */
const synthIrodori = async (text: string, voice: CastMember['voice'], opts: SynthOptions) => {
  const caption = irodoriCaption(voice, opts.delivery);
  const irodori: Record<string, unknown> = {};
  if (caption) irodori.caption = caption;
  if (opts.seed != null) irodori.seed = opts.seed;
  else if (voice.seed != null) irodori.seed = voice.seed;
  if (config.tts.irodoriSteps) irodori.num_steps = config.tts.irodoriSteps;
  // 話速はモデル自身に任せる（時間を伸縮するより自然）。1 より小さいほど速く話す
  const speed = voice.speed || 1;
  if (Math.abs(speed - 1) >= 0.03) irodori.duration_scale = irodoriDurationScale(speed);
  const refVoice = voice.refVoice || 'none';
  await ensureVoice(refVoice);
  const request = () =>
    fetch(`${irodoriBase()}/v1/audio/speech`, {
      method: 'POST',
      headers: irodoriHeaders(),
      body: JSON.stringify({
        model: config.tts.irodoriModel,
        // 短いセリフに感情の絵文字を付けると、笑い声や息などの音が混ざりやすいので付けない
        input: `${opts.emoji && spokenChars(text) >= 6 ? opts.emoji : ''}${text}`,
        voice: refVoice,
        response_format: 'wav',
        irodori,
      }),
      signal: AbortSignal.timeout(config.tts.irodoriTimeoutMs),
    });
  let res: Response;
  try {
    res = await request();
    // Irodori 側の参照音声が消えていたら（サーバーの入れ替えなど）、控えから登録し直して1回だけやり直す
    if (res.status === 400 && refVoice !== 'none') {
      await ensureVoice(refVoice, true);
      res = await request();
    }
  } catch (e) {
    throw new Error(
      `Irodori-TTS サーバーに接続できません（${irodoriBase()}）。scripts/start-irodori.sh で起動してください。
${(e as Error).message}`,
    );
  }
  if (!res.ok) throw new Error(`Irodori-TTS がエラーを返しました (${res.status}): ${(await res.text()).slice(0, 300)}`);
  const { samples, rate } = readWavSamples(Buffer.from(await res.arrayBuffer()));
  return { samples, rate };
};

/**
 * 音声を作り、前後の無音を軽く整えて WAV で保存する。
 * provider は resolveProvider(project.audio.ttsProvider) の結果を渡す（省略時は環境設定に従う）
 */
/** 音色補正の試し読み（声の特徴が出やすい、ふつうの文） */
const CALIBRATION = [
  'こんにちは。今日は新しいサービスについて、わかりやすくご紹介します。',
  'まずは画面を見てください。スマホひとつで、すぐに始められます。',
  'お客さまの声をもとに、使いやすさを大切にしてつくりました。',
  'ぜひ一度、気軽に試してみてくださいね。',
];
const calibrating = new Map<string, Promise<number[] | null>>();

/**
 * 参照音声ごとの音色補正カーブ（dB）。初回だけ試し読みを生成して参照音声と比べ、以後はキャッシュを使う。
 * 参照音声のファイルがこのアプリに無い（サーバーに手置きした）声は補正しない。
 */
export const voiceEqFor = async (refVoice: string | undefined): Promise<number[] | null> => {
  if (!refVoice || refVoice === 'none' || !EQ_ENABLED()) return null;
  const refFile = await localVoiceFile(refVoice);
  if (!refFile) return null;
  const key = await eqKey(refFile);
  const cached = await loadEq(refVoice, key);
  if (cached) return cached;
  if (!calibrating.has(refVoice)) {
    calibrating.set(
      refVoice,
      (async () => {
        // 参照音声（mp3 などでも）を WAV にして分析する
        let ref: { samples: Float32Array; rate: number };
        if (/\.wav$/i.test(refFile)) ref = readWavSamples(await fs.readFile(refFile));
        else {
          const tmp = path.join(os.tmpdir(), `ref-${crypto.randomUUID()}.wav`);
          await runFfmpeg(['-i', refFile, '-ac', '1', '-c:a', 'pcm_s16le', tmp]);
          ref = readWavSamples(await fs.readFile(tmp));
          await fs.rm(tmp, { force: true });
        }
        const gens: number[][] = [];
        for (const [i, text] of CALIBRATION.entries()) {
          const r = await synthIrodori(text, { voice: 'none', instructions: '', speed: 1, refVoice, seed: 100 + i }, {});
          gens.push(bandProfile(trimAndNormalize(r.samples, r.rate), r.rate));
        }
        const gen = gens[0].map((_, b) => gens.reduce((s, g) => s + g[b], 0) / gens.length);
        const gains = correctionCurve(bandProfile(ref.samples, ref.rate), gen);
        await saveEq(refVoice, key, gains);
        return gains;
      })()
        .catch((e) => {
          console.warn(`[voice-eq] ${refVoice}: ${(e as Error).message}`);
          return null;
        })
        .finally(() => calibrating.delete(refVoice)),
    );
  }
  return calibrating.get(refVoice)!;
};

export const synthesizeToFile = async (text: string, voice: CastMember['voice'], out: string, opts: SynthOptions = {}) => {
  const outFile = path.resolve(out);
  const provider = opts.provider ?? resolveProvider();
  const { samples: raw, rate } = provider === 'irodori' ? await synthIrodori(text, voice, opts) : await synthOpenAI(text, voice, opts.delivery);
  if (!raw.length) throw new Error('音声が空でした');
  let cleaned = trimAndNormalize(raw, rate);
  // Irodori は、まれに間延びしたり途中で詰まったりする。文字数に対して長すぎる時は、シードを変えて作り直し、一番自然な長さのものを使う
  if (provider === 'irodori') {
    const expected = expectedSpeechSec(text, voice.speed || 1);
    const len = (s: Float32Array) => s.length / rate;
    const off = (s: Float32Array) => Math.abs(Math.log(len(s) / expected));
    for (let attempt = 1; attempt <= 2 && len(cleaned) > expected * 1.7 + 0.3; attempt++) {
      const retry = await synthIrodori(text, voice, { ...opts, seed: (opts.seed ?? voice.seed ?? 0) + 7919 * attempt });
      const c = trimAndNormalize(retry.samples, retry.rate);
      if (retry.rate === rate && off(c) < off(cleaned)) cleaned = c;
    }
  }
  // 話速はどちらのエンジンも生成時に反映済み（Irodori は duration_scale、OpenAI は speed）
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  // 参照音声の声は、コーデックで弱まった高い音域を参照音声に合わせて戻す
  const gains = provider === 'irodori' ? await voiceEqFor(voice.refVoice) : null;
  const finalSamples = gains ? applyEq(cleaned, rate, gains) : cleaned;
  const wav = encodeWav(finalSamples, rate);
  await fs.writeFile(outFile, wav);
  const parsed = { samples: finalSamples, rate };
  return { durationSec: wavDurationSec(wav), mouth: mouthEnvelope(parsed.samples, parsed.rate) };
};
