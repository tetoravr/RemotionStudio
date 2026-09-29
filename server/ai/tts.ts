import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { narrationHash } from '../../src/video/narrationKey';
import type { CastMember, Line } from '../../src/video/schema';
import { config } from '../env';
import { runFfmpeg, wavDurationSec } from '../ffmpeg';
import { getOpenAI } from './client';

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

export const lineHash = (line: Line, voice: CastMember['voice']) => narrationHash(line, voice, config.models.tts);

const TTS_RATE = 24000; // OpenAI の pcm 出力は 24kHz / 16bit / mono

/**
 * 前後の無音だけを軽く切り、音量を揃える。
 * 息継ぎや語尾の余韻は自然さに効くので、削りすぎない（先頭 80ms / 末尾 140ms の余白を残す）。
 */
export const trimAndNormalize = (pcm: Int16Array, rate = TTS_RATE) => {
  const f = Float32Array.from(pcm, (v) => v / 32768);
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

/** WAV(16bit mono) の PCM を取り出す */
export const readWavSamples = (buf: Buffer): { samples: Float32Array; rate: number } => {
  let offset = 12;
  let rate = 44100;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') rate = buf.readUInt32LE(offset + 12);
    if (id === 'data') {
      const n = Math.floor(Math.min(size, buf.length - offset - 8) / 2);
      const samples = new Float32Array(n);
      for (let i = 0; i < n; i++) samples[i] = buf.readInt16LE(offset + 8 + i * 2) / 32768;
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

/**
 * OpenAI TTS で音声を作り、前後の無音を軽く整えて WAV で保存する。
 * @param delivery セリフごとの演技指示（例: 「驚いて」）。キャラの声の指示に追記される
 */
export const synthesizeToFile = async (text: string, voice: CastMember['voice'], out: string, delivery?: string) => {
  const outFile = path.resolve(out);
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
  const pcm = new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length));
  const cleaned = trimAndNormalize(pcm);
  const speed = Math.min(2, Math.max(0.5, voice.speed || 1));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  if (Math.abs(speed - 1) < 0.03) {
    await fs.writeFile(outFile, encodeWav(cleaned, TTS_RATE));
  } else {
    // わずかな話速調整のみ（1.1倍まで推奨。それ以上は不自然になりやすい）
    const tmp = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
    await fs.writeFile(tmp, encodeWav(cleaned, TTS_RATE));
    try {
      await runFfmpeg(['-i', tmp, '-af', `atempo=${speed.toFixed(3)}`, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outFile]);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const wav = await fs.readFile(outFile);
  const { samples, rate } = readWavSamples(wav);
  return { durationSec: wavDurationSec(wav), mouth: mouthEnvelope(samples, rate) };
};
