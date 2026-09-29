/**
 * 組み込みBGM・効果音をコードで合成して public/audio に書き出す。
 * 著作権フリーのプレースホルダー素材。本番ではライセンス済みBGMへの差し替えを推奨。
 *
 *   npm run audio:build
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';

const SR = 44100;
const OUT = path.resolve('public/audio');
fs.mkdirSync(path.join(OUT, 'sfx'), { recursive: true });

// ---------- 基本ユーティリティ ----------
let seed = 12345;
const rnd = () => {
  seed = (seed * 1664525 + 1013904223) >>> 0;
  return seed / 4294967296;
};
const noise = () => rnd() * 2 - 1;
const mtof = (m: number) => 440 * Math.pow(2, (m - 69) / 12);

const writeWav = (file: string, left: Float32Array, right?: Float32Array) => {
  const ch = right ? 2 : 1;
  const n = left.length;
  const buf = Buffer.alloc(44 + n * ch * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * ch * 2, 4);
  buf.write('WAVE', 8);
  buf.write('fmt ', 12);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(ch, 22);
  buf.writeUInt32LE(SR, 24);
  buf.writeUInt32LE(SR * ch * 2, 28);
  buf.writeUInt16LE(ch * 2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * ch * 2, 40);
  let o = 44;
  for (let i = 0; i < n; i++) {
    for (let c = 0; c < ch; c++) {
      const v = Math.max(-1, Math.min(1, (c === 0 ? left : right!)[i]));
      buf.writeInt16LE(Math.round(v * 32767), o);
      o += 2;
    }
  }
  fs.writeFileSync(file, buf);
};

const normalize = (bufs: Float32Array[], peak = 0.89) => {
  let m = 0;
  for (const b of bufs) for (const v of b) m = Math.max(m, Math.abs(v));
  if (m === 0) return;
  const k = peak / m;
  for (const b of bufs) for (let i = 0; i < b.length; i++) b[i] *= k;
};

/** 状態変数フィルタ（LP/BP/HP） */
class SVF {
  low = 0;
  band = 0;
  process(x: number, cutoff: number, q = 0.7) {
    const f = 2 * Math.sin((Math.PI * Math.min(cutoff, SR * 0.2)) / SR);
    const high = x - this.low - q * this.band;
    this.band += f * high;
    this.low += f * this.band;
    return { low: this.low, band: this.band, high };
  }
}

/** バンド制限っぽいノコギリ波（polyBLEP） */
const polyBlep = (t: number, dt: number) => {
  if (t < dt) {
    t /= dt;
    return t + t - t * t - 1;
  }
  if (t > 1 - dt) {
    t = (t - 1) / dt;
    return t * t + t + t + 1;
  }
  return 0;
};
class Saw {
  phase = rnd();
  next(freq: number) {
    const dt = freq / SR;
    let v = 2 * this.phase - 1;
    v -= polyBlep(this.phase, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}
class Square {
  phase = 0;
  next(freq: number, pw = 0.5) {
    const dt = freq / SR;
    let v = this.phase < pw ? 1 : -1;
    v += polyBlep(this.phase, dt);
    v -= polyBlep((this.phase + 1 - pw) % 1, dt);
    this.phase += dt;
    if (this.phase >= 1) this.phase -= 1;
    return v;
  }
}

const buffer = (sec: number) => new Float32Array(Math.ceil(sec * SR));

// ---------- 効果音 ----------
const sfx: Record<string, () => Float32Array> = {
  pop: () => {
    const b = buffer(0.18);
    let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const f = 480 + 900 * (1 - Math.exp(-t * 60));
      ph += (2 * Math.PI * f) / SR;
      const env = Math.min(1, t / 0.002) * Math.exp(-t * 32);
      b[i] = (Math.sin(ph) + 0.25 * Math.sin(ph * 2)) * env;
    }
    return b;
  },
  whoosh: () => {
    const b = buffer(0.55);
    const f = new SVF();
    for (let i = 0; i < b.length; i++) {
      const t = i / b.length;
      const cutoff = 400 + 3600 * Math.sin(Math.PI * Math.pow(t, 0.8));
      const env = Math.sin(Math.PI * Math.pow(t, 0.6)) ** 2;
      b[i] = f.process(noise(), cutoff, 0.35).band * env * 1.6;
    }
    return b;
  },
  swish: () => {
    const b = buffer(0.3);
    const f = new SVF();
    for (let i = 0; i < b.length; i++) {
      const t = i / b.length;
      const cutoff = 1200 + 5000 * t;
      const env = Math.sin(Math.PI * Math.pow(t, 0.5)) ** 2;
      b[i] = f.process(noise(), cutoff, 0.4).band * env * 1.5;
    }
    return b;
  },
  impact: () => {
    const b = buffer(0.9);
    const lp = new SVF();
    let ph = 0;
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const f = 45 + 110 * Math.exp(-t * 14);
      ph += (2 * Math.PI * f) / SR;
      const boom = Math.sin(ph) * Math.exp(-t * 4.5);
      const crack = lp.process(noise(), 2500 * Math.exp(-t * 8) + 200, 0.6).low * Math.exp(-t * 18);
      const click = t < 0.004 ? noise() * (1 - t / 0.004) : 0;
      b[i] = Math.tanh((boom * 1.2 + crack * 1.4 + click * 0.6) * 1.4);
    }
    return b;
  },
  thud: () => {
    const b = buffer(0.3);
    let ph = 0;
    const lp = new SVF();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const f = 60 + 120 * Math.exp(-t * 25);
      ph += (2 * Math.PI * f) / SR;
      b[i] = Math.sin(ph) * Math.exp(-t * 14) + lp.process(noise(), 900, 0.7).low * Math.exp(-t * 40) * 0.8;
    }
    return b;
  },
  ding: () => {
    const b = buffer(1.2);
    const base = mtof(88); // E6
    const partials = [
      [1, 1, 3.2],
      [2.0, 0.35, 5],
      [2.76, 0.22, 7],
      [5.4, 0.08, 12],
    ];
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      let v = 0;
      for (const [r, a, d] of partials) v += Math.sin(2 * Math.PI * base * r * t) * a * Math.exp(-t * d);
      b[i] = v * Math.min(1, t / 0.002);
    }
    return b;
  },
  coin: () => {
    const b = buffer(0.55);
    const sq = new Square();
    const lp = new SVF();
    for (let i = 0; i < b.length; i++) {
      const t = i / SR;
      const f = t < 0.07 ? mtof(83) : mtof(88);
      const env = t < 0.07 ? 1 : Math.exp(-(t - 0.07) * 7);
      b[i] = lp.process(sq.next(f, 0.5), 5000, 0.7).low * env * 0.6;
    }
    return b;
  },
  sparkle: () => {
    const b = buffer(0.9);
    const notes = [96, 100, 103, 108, 103, 108];
    for (let n = 0; n < notes.length; n++) {
      const start = Math.floor(n * 0.045 * SR);
      const f = mtof(notes[n]);
      for (let i = start; i < b.length; i++) {
        const t = (i - start) / SR;
        b[i] += Math.sin(2 * Math.PI * f * t) * Math.exp(-t * 9) * 0.3;
      }
    }
    // 簡易ディレイ
    const d = Math.floor(0.09 * SR);
    for (let i = d; i < b.length; i++) b[i] += b[i - d] * 0.35;
    return b;
  },
};

for (const [name, gen] of Object.entries(sfx)) {
  const b = gen();
  normalize([b], 0.85);
  writeWav(path.join(OUT, 'sfx', `${name}.wav`), b);
  console.log('sfx', name, (b.length / SR).toFixed(2) + 's');
}

// ---------- BGM（150BPM / 王道進行のポップ・ループ） ----------
const BPM = 150;
const beat = 60 / BPM;
const bar = beat * 4;
const BARS = 24;
const total = bar * BARS + 2;
type Stem = { L: Float32Array; R: Float32Array };
const stem = (): Stem => ({ L: buffer(total), R: buffer(total) });
const kick = stem();
const clap = stem();
const hat = stem();
const bassS = stem();
const chordS = stem();
const leadS = stem();
const riser = stem();

const add = (buf: Float32Array, start: number, i: number, v: number) => {
  const idx = start + i;
  if (idx < buf.length) buf[idx] += v;
};

// 王道進行 IV-V-iii-vi（C調）: F G Em Am
const chords = [
  [53, 57, 60, 64], // Fmaj7
  [55, 59, 62, 65], // G7
  [52, 55, 59, 62], // Em7
  [57, 60, 64, 67], // Am7
];
const roots = [41, 43, 40, 45];

// キック（サイドチェイン用に位置を記録）
const kickTimes: number[] = [];
for (let b = 0; b < BARS; b++) {
  for (let k = 0; k < 4; k++) {
    const t0 = b * bar + k * beat;
    if (b === BARS - 1 && k === 3) continue;
    kickTimes.push(t0);
    const s = Math.floor(t0 * SR);
    let ph = 0;
    for (let i = 0; i < 0.3 * SR; i++) {
      const t = i / SR;
      const f = 48 + 110 * Math.exp(-t * 30);
      ph += (2 * Math.PI * f) / SR;
      const v = Math.sin(ph) * Math.exp(-t * 9) * 0.95 + (t < 0.003 ? noise() * 0.3 : 0);
      add(kick.L, s, i, v);
      add(kick.R, s, i, v);
    }
  }
}
const pump = (t: number) => {
  let g = 1;
  for (const k of kickTimes) {
    const d = t - k;
    if (d >= 0 && d < beat) g = Math.min(g, 0.45 + 0.55 * Math.min(1, d / (beat * 0.55)));
  }
  return g;
};

// クラップ（2・4拍）
for (let b = 0; b < BARS; b++) {
  for (const k of [1, 3]) {
    const s = Math.floor((b * bar + k * beat) * SR);
    const f = new SVF();
    for (let i = 0; i < 0.25 * SR; i++) {
      const t = i / SR;
      const env = (t < 0.01 ? 0.7 : 0) + Math.exp(-t * 18) * (t > 0.008 ? 1 : 0.5);
      const v = f.process(noise(), 1600, 0.5).band * env * 1.1;
      add(clap.L, s, i, v * 0.9);
      add(clap.R, s, i, v);
    }
  }
}

// ハイハット（裏拍オープン気味）
for (let b = 0; b < BARS; b++) {
  for (let e = 0; e < 16; e++) {
    const s = Math.floor((b * bar + (e * beat) / 4) * SR);
    const open = e % 4 === 2;
    const vel = e % 2 === 0 ? (open ? 0.5 : 0.25) : 0.14;
    const dec = open ? 12 : 45;
    const f = new SVF();
    for (let i = 0; i < 0.18 * SR; i++) {
      const t = i / SR;
      const v = f.process(noise(), 9000, 0.5).high * Math.exp(-t * dec) * vel;
      add(hat.L, s, i, v * 0.8);
      add(hat.R, s, i, v);
    }
  }
}

// ベース（8分のオクターブ）
{
  const saw = new Saw();
  const f = new SVF();
  for (let i = 0; i < bassS.L.length; i++) {
    const t = i / SR;
    const b = Math.floor(t / bar);
    if (b >= BARS) break;
    const e = Math.floor((t % bar) / (beat / 2));
    const et = (t % (beat / 2)) / (beat / 2);
    const note = roots[b % 4] + (e % 2 === 1 ? 12 : 0);
    const env = Math.exp(-et * 3.5);
    const v = f.process(saw.next(mtof(note)), 400 + 1400 * env, 0.6).low * env * 0.55 * pump(t);
    bassS.L[i] += v;
    bassS.R[i] += v;
  }
}

// コード（裏拍スタブ + パッド）
{
  const voices = chords[0].map(() => [new Saw(), new Saw()]);
  const fl = new SVF();
  const fr = new SVF();
  for (let i = 0; i < chordS.L.length; i++) {
    const t = i / SR;
    const b = Math.floor(t / bar);
    if (b >= BARS) break;
    const ch = chords[b % 4];
    const inBeat = (t % beat) / beat;
    const stab = inBeat > 0.5 ? Math.exp(-(inBeat - 0.5) * beat * 16) : 0;
    let l = 0;
    let r = 0;
    ch.forEach((n, vi) => {
      const fq = mtof(n + 12);
      l += voices[vi][0].next(fq * 1.004);
      r += voices[vi][1].next(fq * 0.996);
    });
    const amp = (stab * 0.22 + 0.05) * pump(t);
    const cut = 1800 + 2600 * stab;
    chordS.L[i] += fl.process(l, cut, 0.7).low * amp;
    chordS.R[i] += fr.process(r, cut, 0.7).low * amp;
  }
}

// リード（9小節目から、チップチューン風）
{
  // 4小節ぶんのメロディ（16分単位, -1=休符, 長さは16分の数）
  const phrase: [number, number][][] = [
    [[72, 2], [74, 2], [76, 4], [77, 2], [76, 2], [74, 2], [72, 2]],
    [[74, 2], [76, 2], [79, 6], [-1, 2], [79, 2], [81, 2]],
    [[79, 2], [76, 2], [74, 4], [76, 2], [74, 2], [71, 4]],
    [[72, 3], [74, 3], [76, 2], [72, 6], [-1, 2]],
  ];
  const phrase2: [number, number][][] = [
    [[77, 2], [76, 2], [77, 2], [81, 4], [79, 2], [77, 2], [76, 2]],
    [[79, 2], [81, 2], [83, 4], [84, 6], [-1, 2]],
    [[83, 2], [81, 2], [79, 4], [76, 2], [79, 2], [81, 4]],
    [[84, 4], [83, 2], [81, 2], [79, 6], [-1, 2]],
  ];
  const sq = new Square();
  const f = new SVF();
  const s16 = beat / 4;
  const events: { t: number; d: number; n: number }[] = [];
  for (let b = 8; b < BARS; b++) {
    const ph = (Math.floor((b - 8) / 4) % 2 === 0 ? phrase : phrase2)[b % 4];
    let pos = 0;
    for (const [n, len] of ph) {
      if (n > 0) events.push({ t: b * bar + pos * s16, d: len * s16, n });
      pos += len;
    }
  }
  const lead = buffer(total);
  for (const ev of events) {
    const s = Math.floor(ev.t * SR);
    const len = Math.floor((ev.d + 0.08) * SR);
    for (let i = 0; i < len; i++) {
      const t = i / SR;
      const vib = 1 + Math.sin(2 * Math.PI * 5.5 * t) * 0.004 * Math.min(1, t / 0.15);
      const env = Math.min(1, t / 0.005) * (t < ev.d ? 1 - 0.3 * (t / ev.d) : Math.exp(-(t - ev.d) * 40));
      const v = sq.next(mtof(ev.n) * vib, 0.25) * 0.5 + Math.sin(2 * Math.PI * mtof(ev.n) * t) * 0.5;
      add(lead, s, i, v * env * 0.16);
    }
  }
  // ステレオディレイ
  const dl = Math.floor(beat * 0.75 * SR);
  for (let i = 0; i < lead.length; i++) {
    const v = f.process(lead[i], 5200, 0.8).low;
    leadS.L[i] += v;
    leadS.R[i] += v * 0.9;
    if (i + dl < total * SR) leadS.R[i + dl] += v * 0.3;
    if (i + dl * 2 < total * SR) leadS.L[i + dl * 2] += v * 0.18;
  }
}

// ライザー（最後の小節の手前・8小節ごと）
for (const b of [7, 15]) {
  const s = Math.floor(b * bar * SR);
  const f = new SVF();
  for (let i = 0; i < bar * SR; i++) {
    const t = i / (bar * SR);
    const v = f.process(noise(), 500 + 7000 * t * t, 0.5).band * t * t * 0.35;
    add(riser.L, s, i, v);
    add(riser.R, s, i, v * 0.9);
  }
}

// ---------- ミックス（パートごとのRMSを目標値に揃える） ----------
const rmsDb = (st: Stem) => {
  let sum = 0;
  let n = 0;
  for (let i = 0; i < st.L.length; i++) {
    sum += st.L[i] * st.L[i] + st.R[i] * st.R[i];
    n += 2;
  }
  return 10 * Math.log10(sum / Math.max(1, n) + 1e-12);
};
const L = buffer(total);
const R = buffer(total);
const mix: [string, Stem, number][] = [
  ['kick', kick, -15],
  ['bass', bassS, -17],
  ['clap', clap, -24],
  ['hat', hat, -31],
  ['chords', chordS, -21],
  ['lead', leadS, -21],
  ['riser', riser, -34],
];
for (const [name, st, target] of mix) {
  const g = Math.pow(10, (target - rmsDb(st)) / 20);
  console.log(`  ${name.padEnd(6)} rms ${rmsDb(st).toFixed(1)}dB -> ${target}dB`);
  for (let i = 0; i < L.length; i++) {
    L[i] += st.L[i] * g;
    R[i] += st.R[i] * g;
  }
}


// マスター: ソフトクリップ + ノーマライズ
for (let i = 0; i < L.length; i++) {
  L[i] = Math.tanh(L[i] * 1.6) / 1.2;
  R[i] = Math.tanh(R[i] * 1.6) / 1.2;
}
// 末尾フェード
const fade = Math.floor(1.5 * SR);
for (let i = 0; i < fade; i++) {
  const g = 1 - i / fade;
  L[L.length - fade + i] *= g;
  R[R.length - fade + i] *= g;
}
normalize([L, R], 0.9);

const wavPath = path.join(OUT, 'bgm-pop.wav');
writeWav(wavPath, L, R);
const mp3Path = path.join(OUT, 'bgm-pop.mp3');
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const r = spawnSync(npx, ['remotion', 'ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', '-i', wavPath, '-codec:a', 'libmp3lame', '-b:a', '160k', mp3Path], {
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (r.status === 0) {
  fs.unlinkSync(wavPath);
  console.log('bgm', mp3Path, (total).toFixed(1) + 's');
} else {
  console.warn('mp3 encode failed; keeping WAV. Set project.audio.bgm to audio/bgm-pop.wav');
}
