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

/** 前後の無音カット + 音量正規化（Remotion 同梱 ffmpeg は最小構成なので JS で処理） */
export const trimAndNormalize = (pcm: Int16Array, rate = TTS_RATE) => {
  const f = Float32Array.from(pcm, (v) => v / 32768);
  const thr = 0.006;
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
  start = Math.max(0, start - Math.round(rate * 0.06));
  end = Math.min(f.length, end + Math.round(rate * 0.08));
  const out = f.slice(start, Math.max(start + 1, end));
  // 音声部分の RMS を -15dBFS に揃える（ピークは -1dBFS で制限）
  let sum = 0;
  let n = 0;
  let peak = 0;
  for (const v of out) {
    peak = Math.max(peak, Math.abs(v));
    if (Math.abs(v) > thr) {
      sum += v * v;
      n++;
    }
  }
  const rms = Math.sqrt(sum / Math.max(1, n));
  const gain = Math.min(Math.pow(10, -15 / 20) / Math.max(1e-4, rms), Math.pow(10, -1 / 20) / Math.max(1e-4, peak));
  // フェード（クリック防止）
  const fade = Math.round(rate * 0.008);
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

/**
 * OpenAI TTS で音声を作り、前後の無音カット・音量・話速を整えて WAV で保存する。
 */
export const synthesizeToFile = async (text: string, voice: CastMember['voice'], out: string) => {
  const outFile = path.resolve(out);
  const client = getOpenAI();
  const res = await client.audio.speech.create({
    model: config.models.tts,
    voice: voice.voice as 'coral',
    input: text,
    instructions: voice.instructions || undefined,
    response_format: 'pcm',
  });
  const raw = Buffer.from(await res.arrayBuffer());
  const even = raw.subarray(0, raw.length - (raw.length % 2));
  const pcm = new Int16Array(even.buffer.slice(even.byteOffset, even.byteOffset + even.length));
  const cleaned = trimAndNormalize(pcm);
  const speed = Math.min(2, Math.max(0.5, voice.speed || 1));
  await fs.mkdir(path.dirname(outFile), { recursive: true });
  if (Math.abs(speed - 1) < 0.01) {
    await fs.writeFile(outFile, encodeWav(cleaned, TTS_RATE));
  } else {
    // 話速は ffmpeg の atempo（ピッチを保ったまま）で調整
    const tmp = path.join(os.tmpdir(), `tts-${crypto.randomUUID()}.wav`);
    await fs.writeFile(tmp, encodeWav(cleaned, TTS_RATE));
    try {
      await runFfmpeg(['-i', tmp, '-af', `atempo=${speed.toFixed(3)}`, '-ar', '44100', '-ac', '1', '-c:a', 'pcm_s16le', outFile]);
    } finally {
      await fs.rm(tmp, { force: true });
    }
  }
  const durationSec = wavDurationSec(await fs.readFile(outFile));
  return { durationSec };
};
