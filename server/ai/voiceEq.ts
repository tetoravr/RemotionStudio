import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../env';

/**
 * 声ごとの音色補正（イコライザー）。
 * Irodori-TTS は参照音声の声を真似るが、音声の圧縮（コーデック）で高い音域が弱まり、参照より少しこもった音になる。
 * 声ごとに一度だけ試し読みを生成し、参照音声との帯域ごとの差から補正カーブを作って、以後の音声にかける。
 */

/** 補正する帯域の中心周波数（Hz）。これより下（声の土台）はいじらない */
const BANDS = [1000, 1600, 2500, 3500, 4500, 6000, 8000, 10000, 12500, 16000];
const MAX_BOOST = 8;
const MAX_CUT = -6;

// ---------- 周波数分析 ----------
const fft = (re: Float64Array, im: Float64Array) => {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = (-2 * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const ncr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = ncr;
      }
    }
  }
};

/**
 * 声が出ている部分の、帯域ごとの音量（1〜2.5kHz 付近を基準にした dB）。
 * 帯域の端は、隣の中心との幾何平均で区切る。
 */
export const bandProfile = (samples: Float32Array, rate: number): number[] => {
  const n = 4096;
  const win = Float64Array.from({ length: n }, (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)));
  const acc = new Float64Array(n / 2);
  let frames = 0;
  for (let s = 0; s + n <= samples.length; s += n / 2) {
    let e = 0;
    for (let i = 0; i < n; i++) e += samples[s + i] * samples[s + i];
    if (Math.sqrt(e / n) < 0.02) continue; // 無音・息は除く
    const re = new Float64Array(n);
    const im = new Float64Array(n);
    for (let i = 0; i < n; i++) re[i] = samples[s + i] * win[i];
    fft(re, im);
    for (let k = 0; k < n / 2; k++) acc[k] += re[k] * re[k] + im[k] * im[k];
    frames++;
  }
  if (!frames) return BANDS.map(() => 0);
  const hz = rate / n;
  const edges = BANDS.map((c, i) => [i ? Math.sqrt(BANDS[i - 1] * c) : c / 1.25, i < BANDS.length - 1 ? Math.sqrt(c * BANDS[i + 1]) : Math.min(c * 1.25, rate / 2)]);
  const energy = edges.map(([a, b]) => {
    let sum = 0;
    let cnt = 0;
    for (let k = Math.ceil(a / hz); k < Math.min(n / 2, b / hz); k++) {
      sum += acc[k];
      cnt++;
    }
    return cnt ? sum / cnt : 1e-12;
  });
  const ref = (energy[0] + energy[1] + energy[2]) / 3;
  return energy.map((e) => 10 * Math.log10(Math.max(1e-12, e) / Math.max(1e-12, ref)));
};

/** 参照音声と生成音声の帯域差から、補正カーブ（dB）を作る。隣と平均してなめらかにし、上げすぎ・下げすぎは抑える */
export const correctionCurve = (ref: number[], gen: number[]) => {
  const raw = ref.map((r, i) => r - gen[i]);
  return raw.map((_, i) => {
    const a = raw[Math.max(0, i - 1)];
    const b = raw[i];
    const c = raw[Math.min(raw.length - 1, i + 1)];
    // 試し読みと参照音声は文が違うので差を全部は埋めず、75% だけ戻す（上げすぎてキンキンしないように）
    const v = ((a + 2 * b + c) / 4) * 0.75;
    // 1kHz 付近（声の中心）は動かさない
    const w = BANDS[i] <= 1600 ? 0 : 1;
    return Math.round(Math.min(MAX_BOOST, Math.max(MAX_CUT, v * w)) * 10) / 10;
  });
};

/** 周波数 f（Hz）での補正量（dB）。帯域の中心どうしを、対数周波数で直線につなぐ */
export const gainAt = (gains: number[], f: number) => {
  if (f <= 800) return 0;
  if (f <= BANDS[0]) return (gains[0] * (Math.log(f) - Math.log(800))) / (Math.log(BANDS[0]) - Math.log(800));
  for (let i = 1; i < BANDS.length; i++) {
    if (f <= BANDS[i]) {
      const t = (Math.log(f) - Math.log(BANDS[i - 1])) / (Math.log(BANDS[i]) - Math.log(BANDS[i - 1]));
      return gains[i - 1] + t * (gains[i] - gains[i - 1]);
    }
  }
  return gains[gains.length - 1];
};

// ---------- 声ごとのキャッシュ ----------
type EqCache = { key: string; gains: number[]; createdAt: number };
const cacheFile = (voiceId: string) => path.join(config.voicesDir, `.eq-${voiceId}.json`);

export const loadEq = async (voiceId: string, key: string): Promise<number[] | null> => {
  const c = JSON.parse(await fs.readFile(cacheFile(voiceId), 'utf8').catch(() => 'null')) as EqCache | null;
  return c && c.key === key ? c.gains : null;
};

export const saveEq = async (voiceId: string, key: string, gains: number[]) => {
  await fs.mkdir(config.voicesDir, { recursive: true });
  await fs.writeFile(cacheFile(voiceId), JSON.stringify({ key, gains, createdAt: Date.now() } satisfies EqCache, null, 2));
};

/** 参照音声のファイルと、使っているモデルが変わったら作り直す */
export const eqKey = async (refFile: string) => {
  const st = await fs.stat(refFile);
  return crypto.createHash('sha1').update(`${path.basename(refFile)}|${st.size}|${st.mtimeMs}|${config.tts.irodoriModel}|v1`).digest('hex').slice(0, 12);
};

/**
 * 音声にイコライザーをかける（短時間フーリエ変換で周波数ごとに音量を変え、重ね合わせて戻す）。
 * 窓は √ハン窓を分析・合成の両方に使い、50% 重ねで元の音量に戻る。最後にピークを -1dBFS に抑える。
 */
export const applyEq = (input: Float32Array, rate: number, gains: number[]): Float32Array => {
  if (gains.every((g) => Math.abs(g) < 0.5)) return input;
  const n = 2048;
  const hop = n / 2;
  const win = Float64Array.from({ length: n }, (_, i) => Math.sqrt(0.5 - 0.5 * Math.cos((2 * Math.PI * i) / n)));
  const gain = Float64Array.from({ length: n / 2 + 1 }, (_, k) => 10 ** (gainAt(gains, (k * rate) / n) / 20));
  const padded = new Float64Array(input.length + n * 2);
  padded.set(input, n);
  const out = new Float64Array(padded.length);
  const re = new Float64Array(n);
  const im = new Float64Array(n);
  for (let s = 0; s + n <= padded.length; s += hop) {
    for (let i = 0; i < n; i++) {
      re[i] = padded[s + i] * win[i];
      im[i] = 0;
    }
    fft(re, im);
    for (let k = 0; k <= n / 2; k++) {
      re[k] *= gain[k];
      im[k] *= gain[k];
      if (k && k < n / 2) {
        re[n - k] *= gain[k];
        im[n - k] *= gain[k];
      }
    }
    // 逆変換（共役を取って順変換し、n で割る）
    for (let i = 0; i < n; i++) im[i] = -im[i];
    fft(re, im);
    for (let i = 0; i < n; i++) out[s + i] += (re[i] / n) * win[i];
  }
  const res = Float32Array.from(out.subarray(n, n + input.length));
  let peak = 0;
  for (const v of res) peak = Math.max(peak, Math.abs(v));
  const limit = 10 ** (-1 / 20);
  if (peak > limit) for (let i = 0; i < res.length; i++) res[i] *= limit / peak;
  return res;
};

export const EQ_ENABLED = () => process.env.VOICE_EQ !== 'off';
