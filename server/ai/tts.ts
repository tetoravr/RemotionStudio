import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { irodoriCaption, narrationHash, type TtsProvider } from '../../src/video/narrationKey';
import type { AudioSettings, CastMember, Line } from '../../src/video/schema';
import { config } from '../env';
import { runFfmpeg, wavDurationSec } from '../ffmpeg';
import { getOpenAI } from './client';
import { ensureVoice, localVoices } from './voices';

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

/** プロジェクト設定（auto / openai / irodori）から実際に使うエンジンを決める */
export const resolveProvider = (setting: AudioSettings['ttsProvider'] = 'auto'): TtsProvider => {
  const pick = setting !== 'auto' ? setting : config.tts.provider;
  if (pick === 'openai' || pick === 'irodori') return pick;
  return config.tts.irodoriUrl ? 'irodori' : 'openai';
};

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
  const thr = 0.004;
  const win = Math.round(rate * 0.01);
  const loud = (i: number) => {
    let m = 0;
    for (let k = i; k < Math.min(f.length, i + win); k++) m = Math.max(m, Math.abs(f[k]));
    return m > thr;
  };
  let start = 0;
  while (start < f.length && !loud(start)) start += win;
  let end = f.length;
  while (end > start && !loud(Math.max(0, end - win))) end -= win;
  start = Math.max(0, start - Math.round(rate * 0.08));
  end = Math.min(f.length, end + Math.round(rate * 0.14));
  const out = f.slice(start, Math.max(start + 1, end));
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
  for (let i = 0; i < out.length; i++) {
    const e = Math.min(1, i / fade, (out.length - 1 - i) / fade);
    out[i] = Math.max(-1, Math.min(1, out[i] * gain * e));
  }
  return out;
};

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
};

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
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const even = raw.subarray(0, raw.length - (raw.length % 2));
  return { samples: new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length)), rate: TTS_RATE };
};

/** Irodori-TTS（OpenAI 互換サーバー）: 48kHz の WAV。声はキャプション（声のデザイン）＋固定シード、または参照音声で決める */
const synthIrodori = async (text: string, voice: CastMember['voice'], opts: SynthOptions) => {
  const caption = irodoriCaption(voice, opts.delivery);
  const irodori: Record<string, unknown> = {};
  if (caption) irodori.caption = caption;
  if (voice.seed != null) irodori.seed = voice.seed;
  if (config.tts.irodoriSteps) irodori.num_steps = config.tts.irodoriSteps;
  // 話速はモデル自身に任せる（時間を伸縮するより自然）。1 より小さいほど速く話す
  const speed = voice.speed || 1;
  if (Math.abs(speed - 1) >= 0.03) irodori.duration_scale = Math.min(1.5, Math.max(0.5, 1 / speed));
  const refVoice = voice.refVoice || 'none';
  await ensureVoice(refVoice);
  const request = () =>
    fetch(`${irodoriBase()}/v1/audio/speech`, {
      method: 'POST',
      headers: irodoriHeaders(),
      body: JSON.stringify({
        model: config.tts.irodoriModel,
        input: `${opts.emoji ?? ''}${text}`,
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
export const synthesizeToFile = async (text: string, voice: CastMember['voice'], out: string, opts: SynthOptions = {}) => {
  const outFile = path.resolve(out);
  const provider = opts.provider ?? resolveProvider();
  const { samples: raw, rate } = provider === 'irodori' ? await synthIrodori(text, voice, opts) : await synthOpenAI(text, voice, opts.delivery);
  if (!raw.length) throw new Error('音声が空でした');
  const cleaned = trimAndNormalize(raw, rate);
  // Irodori-TTS は生成時に話速を反映済み。OpenAI TTS だけ後から伸縮する
  const speed = provider === 'irodori' ? 1 : Math.min(2, Math.max(0.5, voice.speed || 1));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  if (Math.abs(speed - 1) < 0.03) {
    await fs.writeFile(outFile, encodeWav(cleaned, rate));
  } else {
    // わずかな話速調整のみ（1.1倍まで推奨。それ以上は不自然になりやすい）
    const tmp = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
    await fs.writeFile(tmp, encodeWav(cleaned, rate));
    try {
      await runFfmpeg(['-i', tmp, '-af', `atempo=${speed.toFixed(3)}`, '-ar', String(Math.min(rate, 48000)), '-ac', '1', '-c:a', 'pcm_s16le', outFile]);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const wav = await fs.readFile(outFile);
  const parsed = readWavSamples(wav);
  return { durationSec: wavDurationSec(wav), mouth: mouthEnvelope(parsed.samples, parsed.rate) };
};
