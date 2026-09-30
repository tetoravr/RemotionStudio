import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { aiToScenes, type AiStoryboard } from '../server/ai/storyboard';
import { detectMouthRegion } from '../server/ai/mouth';
import { engineId, mouthEnvelope, readWavSamples, resolveProvider, trimAndNormalize } from '../server/ai/tts';
import { LIBRARY_CHARACTERS, libraryCastMember } from '../src/video/library';
import { parseRich, fitFontSize } from '../src/video/components/RichText';
import { adaptForFormat } from '../src/video/adapt';
import { collectSfx } from '../src/video/events';
import { applyTextTarget, normalizeAdjust, sceneElementIds } from '../src/video/edit/textEdit';
import { irodoriCaption, isAudioStale, narrationHash, voiceFor } from '../src/video/narrationKey';
import { Project } from '../src/video/schema';
import { blankProject, DEFAULT_CAST } from '../src/video/templates';
import { computeTimeline } from '../src/video/timeline';

const sample = Project.parse(JSON.parse(fs.readFileSync('public/samples/sushitop-ocr/project.json', 'utf8')));

test('サンプルプロジェクトがスキーマに適合し、全セリフに音声がある', () => {
  assert.equal(sample.scenes.length, 8);
  for (const s of sample.scenes) for (const l of s.lines) assert.ok(l.audio, `${l.id} has audio`);
  for (const s of sample.scenes) for (const l of s.lines) assert.equal(isAudioStale(l, sample.cast, engineId(resolveProvider(sample.audio.ttsProvider))), false, `${l.id} is fresh`);
});

test('タイムライン: シーンが連続し、切り替えが8分音符グリッドに乗る', () => {
  const tl = computeTimeline(sample);
  const eighth = (60 / sample.audio.bpm / 2) * sample.fps; // 6 frames @150bpm/30fps
  let cursor = 0;
  for (const st of tl.scenes) {
    assert.equal(st.start, cursor);
    cursor += st.duration;
    assert.equal(Math.round(cursor / eighth) * eighth, cursor, 'cut on grid');
    for (const lt of st.lines) assert.ok(lt.end <= st.duration, 'line fits in scene');
    for (let i = 1; i < st.lines.length; i++) assert.ok(st.lines[i].start >= st.lines[i - 1].end, 'lines do not overlap');
  }
  assert.equal(tl.total, cursor);
  assert.ok(tl.total / sample.fps > 25 && tl.total / sample.fps < 55, `about 30-50s (${tl.total / sample.fps})`);
});

test('音声がなくても文字数から尺を推定できる', () => {
  const p = Project.parse(blankProject({ id: 'x', title: 't', brandName: 'テスト' }));
  const tl = computeTimeline(p);
  assert.ok(tl.total > 0);
  assert.ok(collectSfx(tl, p).length > 5);
});

test('ナレーションのハッシュは文言・声で変わる', () => {
  const line = sample.scenes[0].lines[0];
  const v = DEFAULT_CAST[0].voice;
  const a = narrationHash(line, v, 'm');
  assert.equal(a, narrationHash({ ...line }, v, 'm'));
  assert.notEqual(a, narrationHash({ ...line, text: 'ちがう', speak: undefined }, v, 'm'));
  assert.notEqual(a, narrationHash(line, { ...v, voice: 'nova' }, 'm'));
});

test('強調記法とフォントサイズ推定', () => {
  assert.deepEqual(parseRich('[[与信審査]]なしで'), [
    { text: '与信審査', highlight: true },
    { text: 'なしで', highlight: false },
  ]);
  assert.ok(fitFontSize('あいうえお', 500, 200) <= 100);
  assert.equal(fitFontSize('あ', 500, 200), 200);
});

test('横型では中央のキャラを左右に逃がす（会話シーン以外）', () => {
  const p = { ...sample, format: 'horizontal' as const };
  const adapted = adaptForFormat(p);
  for (const s of adapted.scenes) if (s.type !== 'talk') assert.ok(s.characters.every((c) => c.position !== 'center'));
  assert.equal(adaptForFormat(sample), sample);
});

test('AI出力をシーンに変換し、不正な値は補正・除外する', () => {
  const ai: AiStoryboard = {
    title: 't',
    tagline: 'tag',
    palette: null,
    scenes: [
      {
        type: 'feature',
        transition: 'wipe',
        lines: [{ speaker: 'unknown', text: 'やあ', speak: null, delivery: null, emoji: null, pose: null, style: 'bubble' }],
        characters: [{ id: 'saki', pose: 'happy', position: 'left', size: 'm', enter: 'pop', enterDelaySec: 9 }],
        eyebrow: '[[A]]で',
        headline: 'B！',
        footnote: null,
        background: null,
        visual: { kind: 'illustration', uiFile: null, illustration: '受付で笑顔のスタッフ', counterFrom: null, counterTo: null, prefix: null, suffix: null, caption: null } as never,
      },
      {
        type: 'feature',
        transition: 'cut',
        lines: [],
        characters: [],
        eyebrow: 'X',
        headline: 'Y！',
        footnote: null,
        background: null,
        visual: { kind: 'ui', uiFile: 'TGM_配布履歴.png', illustration: null, counterFrom: null, counterTo: null, prefix: null, suffix: null, caption: null } as never,
      },
      { type: 'showcase', transition: 'cut', lines: [], characters: [], uiFile: 'a.png', title: 't', note: null } as never,
      { type: 'cta', transition: 'cut', lines: [], characters: [], buttonText: 'Go', contact: null, notes: [] },
    ],
  };
  const scenes = aiToScenes(ai, DEFAULT_CAST);
  assert.equal(scenes.length, 4);
  const f = scenes[0];
  assert.equal(f.type, 'feature');
  assert.equal(f.lines[0].speaker, 'narrator');
  assert.equal(f.lines[0].style, 'caption');
  assert.equal(f.characters[0].enterDelaySec, 2);
  // イラストは後で画像AIが描く（指示文だけ持つ）、画面はUIライブラリを参照する
  if (f.type === 'feature' && f.visual.kind === 'image') assert.deepEqual([f.visual.src, f.visual.prompt], ['', '受付で笑顔のスタッフ']);
  else assert.fail('visual should be image');
  const g = scenes[1];
  if (g.type === 'feature' && g.visual.kind === 'screen') assert.equal(g.visual.src, 'ui:TGM_配布履歴.png');
  else assert.fail('visual should be screen');
  const sc = scenes[2];
  assert.ok(sc.type === 'showcase' && sc.screenshot === 'ui:a.png');
});

test('TTS音声の前後無音カットと音量正規化', () => {
  const rate = 24000;
  const pcm = new Int16Array(rate); // 1秒
  for (let i = 8000; i < 16000; i++) pcm[i] = Math.round(Math.sin(i / 5) * 3000);
  const out = trimAndNormalize(pcm, rate);
  assert.ok(out.length < pcm.length * 0.7 && out.length > 8000, 'silence trimmed but speech kept');
  assert.ok(Math.max(...Array.from(out, Math.abs)) <= 0.9);
});

test('口パク: 音量から口の開閉を作り、1フレームだけの開閉は出さない', () => {
  const rate = 24000;
  const x = new Float32Array(rate); // 1秒
  for (let i = 0; i < rate * 0.4; i++) x[Math.floor(rate * 0.2) + i] = Math.sin(i / 8) * 0.4; // 0.2〜0.6秒に発話
  const env = mouthEnvelope(x, rate);
  assert.equal(env.length, 30);
  assert.equal(env[0], 0);
  assert.equal(env[29], 0);
  assert.ok(env.slice(8, 16).filter(Boolean).length >= 6, 'speech is open');
  for (let i = 1; i < env.length - 1; i++) assert.ok(!(env[i] !== env[i - 1] && env[i] !== env[i + 1]), `no single-frame flip at ${i}`);
});

test('口検出: 差分の塊（口）だけを検出し、細い輪郭ずれと領域外は無視する', () => {
  const W = 400, H = 600;
  const mk = () => ({ data: Buffer.alloc(W * H * 4, 255), width: W, height: H });
  const a = mk(), b = mk();
  // 口: 顔(上部)に 40x24 の暗い塊
  for (let y = 100; y < 124; y++) for (let x = 180; x < 220; x++) for (let c = 0; c < 3; c++) b.data[(y * W + x) * 4 + c] = 20;
  // 輪郭のずれ: 縦の細い線(2px)
  for (let y = 300; y < 500; y++) for (let x = 100; x < 102; x++) for (let c = 0; c < 3; c++) b.data[(y * W + x) * 4 + c] = 0;
  const r = detectMouthRegion(a, b, { yMin: 0, yMax: 0.3 });
  assert.ok(r, 'mouth found');
  assert.ok(Math.abs((r!.x0 + r!.x1) / 2 - 200) < 6 && Math.abs((r!.y0 + r!.y1) / 2 - 112) < 6);
  // 口が顔の範囲外にあるなら None
  assert.equal(detectMouthRegion(a, b, { yMin: 0.5, yMax: 1 }), null);
});

test('ライブラリキャラ: 全表情に口閉じ・口開けの画像ファイルがある', () => {
  for (const id of Object.keys(LIBRARY_CHARACTERS)) {
    const m = libraryCastMember(id);
    assert.ok(m.aspect && m.aspect > 0);
    for (const pose of LIBRARY_CHARACTERS[id].poses) {
      for (const set of [m.images, m.imagesOpen]) {
        const rel = set[pose]!.replace('lib:', 'public/');
        assert.ok(fs.existsSync(rel), `${rel} exists`);
      }
    }
  }
});

test('サンプル: 疑似UIは使わず、画面紹介シーンは実スクリーンショットを持つ', () => {
  for (const s of sample.scenes) if (s.type === 'showcase') assert.ok(s.screenshot, 'showcase needs a real screenshot');
  assert.equal(JSON.stringify(sample).includes('mockup'), false);
});

test('音声: 口パクデータが全セリフにある', () => {
  for (const s of sample.scenes) for (const l of s.lines) assert.ok(l.audio?.mouth && l.audio.mouth.length >= 10, `${l.id} has mouth data`);
});

test('Irodori-TTS: エンジン・声・感情が変わると音声は古い扱いになる', () => {
  const line = sample.scenes[1].lines[0];
  const voice = voiceFor(line.speaker, sample.cast);
  const irodori = narrationHash(line, voice, 'irodori:irodori-tts');
  assert.notEqual(irodori, narrationHash(line, voice, 'gpt-4o-mini-tts'), 'engine');
  assert.notEqual(irodori, narrationHash(line, { ...voice, seed: (voice.seed ?? 0) + 1 }, 'irodori:irodori-tts'), 'seed');
  assert.notEqual(irodori, narrationHash(line, { ...voice, caption: '低い男性の声' }, 'irodori:irodori-tts'), 'caption');
  assert.notEqual(irodori, narrationHash({ ...line, emoji: '😲' }, voice, 'irodori:irodori-tts'), 'emoji');
  // OpenAI 用の項目は Irodori の音声に影響しない
  assert.equal(irodori, narrationHash(line, { ...voice, voice: 'coral' }, 'irodori:irodori-tts'));
  // 逆に、Irodori 用の項目は OpenAI の音声に影響しない
  assert.equal(narrationHash(line, voice, 'gpt-4o-mini-tts'), narrationHash({ ...line, emoji: '😲' }, { ...voice, seed: 1 }, 'gpt-4o-mini-tts'));
});

test('Irodori-TTS: キャプション（参照音声があるときは感情の指示だけ）', () => {
  const voice = { voice: 'marin', instructions: '基本の指示', speed: 1, caption: '若い女性の声' };
  assert.equal(irodoriCaption(voice), '若い女性の声');
  assert.equal(irodoriCaption({ ...voice, caption: undefined }), '基本の指示');
  assert.equal(irodoriCaption(voice, '驚いて。'), '若い女性の声\nこのセリフは「驚いて」という調子で読む。');
  assert.equal(irodoriCaption({ ...voice, refVoice: 'me' }, '驚いて'), 'このセリフは「驚いて」という調子で読む。');
  assert.equal(irodoriCaption({ ...voice, refVoice: 'me' }), '');
});

test('WAV読み込み: 48kHz float32 ステレオ / 16bit を扱える', () => {
  const wav = (fmt: number, bits: number, ch: number, rate: number, frames: number, write: (b: Buffer, o: number, v: number) => void) => {
    const bytes = bits / 8;
    const b = Buffer.alloc(44 + frames * ch * bytes);
    b.write('RIFF', 0);
    b.writeUInt32LE(b.length - 8, 4);
    b.write('WAVEfmt ', 8);
    b.writeUInt32LE(16, 16);
    b.writeUInt16LE(fmt, 20);
    b.writeUInt16LE(ch, 22);
    b.writeUInt32LE(rate, 24);
    b.writeUInt32LE(rate * ch * bytes, 28);
    b.writeUInt16LE(ch * bytes, 32);
    b.writeUInt16LE(bits, 34);
    b.write('data', 36);
    b.writeUInt32LE(frames * ch * bytes, 40);
    for (let i = 0; i < frames; i++) for (let c = 0; c < ch; c++) write(b, 44 + (i * ch + c) * bytes, c === 0 ? 0.5 : -0.5 + i * 0);
    return b;
  };
  const f32 = readWavSamples(wav(3, 32, 2, 48000, 100, (b, o, v) => b.writeFloatLE(v === 0.5 ? 0.5 : 0.25, o)));
  assert.equal(f32.rate, 48000);
  assert.equal(f32.samples.length, 100);
  assert.ok(Math.abs(f32.samples[10] - 0.375) < 1e-6, 'stereo is averaged');
  const i16 = readWavSamples(wav(1, 16, 1, 24000, 50, (b, o) => b.writeInt16LE(16384, o)));
  assert.equal(i16.rate, 24000);
  assert.ok(Math.abs(i16.samples[0] - 0.5) < 1e-4);
});

test('直接調整: ほぼ初期値の調整は保存しない・非表示は残す', () => {
  assert.equal(normalizeAdjust({ dx: 0.2, dy: -0.3, scale: 1.001, rotate: 0.01 }), null);
  const moved = normalizeAdjust({ dx: 12.34, dy: -5, scale: 1.5, rotate: 370, px: 100, py: 200 })!;
  assert.deepEqual([moved.dx, moved.dy, moved.scale, moved.rotate, moved.px, moved.py], [12.3, -5, 1.5, 10, 100, 200]);
  assert.equal(normalizeAdjust({ dx: 0, dy: 0, scale: 1, rotate: 0, hidden: true })?.hidden, true);
  assert.equal(normalizeAdjust({ dx: 0, dy: 0, scale: 99, rotate: 0 })?.scale, 6);
});

test('直接調整: 文字の書き換えは元データに戻り、調整はスキーマを通る', () => {
  const p = Project.parse(structuredClone(sample));
  const talk = p.scenes.find((s) => s.type === 'talk')!;
  const line = talk.lines[0];
  line.speak = '読み替え';
  applyTextTarget(talk, { type: 'line', lineId: line.id }, '新しい文言');
  assert.equal(line.text, '新しい文言');
  assert.equal(line.speak, undefined);
  applyTextTarget(talk, { type: 'field', field: 'headline' }, '新見出し');
  assert.equal((talk as { headline?: string }).headline, '新見出し');
  talk.layout = { headline: { dx: 10, dy: 0, scale: 1.2, rotate: 5 } };
  assert.equal(Project.parse(p).scenes.find((s) => s.id === talk.id)!.layout!.headline.rotate, 5);
  assert.ok(sceneElementIds(talk).includes(`line:${line.id}`));
});

test('直接調整: 文字揃えだけの調整も保存される', () => {
  const a = normalizeAdjust({ dx: 0, dy: 0, scale: 1, rotate: 0, align: 'right' });
  assert.equal(a?.align, 'right');
  assert.equal(normalizeAdjust({ dx: 0, dy: 0, scale: 1, rotate: 0 }), null);
});

test('音声の末尾に取り残された小さな孤立音は切り落とす（本体の語尾は残す）', () => {
  const rate = 24000;
  const tone = (sec: number, amp: number) => Float32Array.from({ length: Math.round(rate * sec) }, (_, i) => amp * Math.sin((i / rate) * 2 * Math.PI * 220));
  const silence = (sec: number) => new Float32Array(Math.round(rate * sec));
  const cat = (...a: Float32Array[]) => {
    const out = new Float32Array(a.reduce((n, x) => n + x.length, 0));
    let o = 0;
    for (const x of a) (out.set(x, o), (o += x.length));
    return out;
  };
  const speech = cat(tone(0.8, 0.5), silence(0.25), tone(0.6, 0.5), silence(0.3));
  const withBlip = cat(speech, silence(0.4), tone(0.1, 0.03));
  const clean = trimAndNormalize(speech, rate);
  const trimmed = trimAndNormalize(withBlip, rate);
  assert.ok(Math.abs(trimmed.length - clean.length) < rate * 0.02, `blip removed: ${trimmed.length} vs ${clean.length}`);
  // 発話の途中の短い間や、本体の後半の語尾は落とさない
  assert.ok(trimmed.length > rate * 1.6);
  // 本体と同じくらい大きな語尾（間のあとの言葉）は残す
  const keepsWord = trimAndNormalize(cat(tone(0.8, 0.5), silence(0.3), tone(0.5, 0.45)), rate);
  assert.ok(keepsWord.length > rate * 1.5);
});

test('直接調整: 重なり順（z）だけの記録も保存され、調整とは別に扱う', () => {
  const a = normalizeAdjust({ dx: 0, dy: 0, scale: 1, rotate: 0, z: 3 });
  assert.equal(a?.z, 3);
  assert.equal(a?.hidden, undefined);
});
