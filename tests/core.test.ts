import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { aiToScenes, type AiStoryboard } from '../server/ai/storyboard';
import { detectMouthRegion } from '../server/ai/mouth';
import { encodeWav, engineId, mouthEnvelope, readWavSamples, resolveProvider, synthesizeToFile, trimAndNormalize } from '../server/ai/tts';
import { config } from '../server/env';
import { generateNarration } from '../server/narration';
import { keytermsOf, normalizeSpeech, speechScore, SURE_OK } from '../server/ai/speechCheck';
import { LIBRARY_CHARACTERS, libraryCastMember } from '../src/video/library';
import { parseRich, fitFontSize } from '../src/video/components/RichText';
import { adaptForFormat } from '../src/video/adapt';
import { collectSfx } from '../src/video/events';
import { applyTextTarget, layerOrder, migrateLayouts, moveLayer, normalizeAdjust, readAdjust, sceneElementIds, sceneLayout, setLayerOrder, setSceneLayout } from '../src/video/edit/textEdit';
import { autoTags, elevenVoiceKey, lineTags, normalizeTag, standardRefVoice, stripAudioTags, withAudioTags } from '../src/video/audioTags';
import { carryAudio, elevenSpeechText, engineKey, irodoriCaption, isAudioStale, narrationHash, plainSpeechText, speechText, voiceFor } from '../src/video/narrationKey';
import { Project } from '../src/video/schema';
import { blankProject, DEFAULT_CAST } from '../src/video/templates';
import { computeTimeline, lineDurationSec } from '../src/video/timeline';

const sample = Project.parse(JSON.parse(fs.readFileSync('public/samples/sushitop-ocr/project.json', 'utf8')));

test('サンプルプロジェクトがスキーマに適合し、全セリフに音声がある', () => {
  assert.equal(sample.scenes.length, 8);
  for (const s of sample.scenes)
    for (const l of s.lines) {
      assert.ok(l.audio, `${l.id} has audio`);
      assert.ok(fs.existsSync(path.join('public/samples/sushitop-ocr', l.audio!.src)), `${l.audio!.src} exists`);
    }
});

test('以前の版で作ったサンプルの音声は、キャラの標準の声で作り直す対象になる（セリフごとに声が違うため）', () => {
  // 参照音声が未設定のライブラリのキャラも、標準の声で読む → 声を固定せずに作った音声は古い扱い
  for (const s of sample.scenes) for (const l of s.lines) assert.equal(isAudioStale(l, sample.cast, engineId('irodori')), true, l.id);
  const voice = voiceFor('saki', sample.cast);
  assert.equal(voice.refVoice, undefined);
  assert.equal(standardRefVoice(voice), 'hayami-saki');
  // 標準の声があるので、Irodori には声のデザイン（キャプション）を渡さない
  assert.equal(irodoriCaption(voice), '');
});

test('音声エンジン: 既定は ElevenLabs（Eleven v4）', () => {
  assert.equal(resolveProvider('auto'), 'elevenlabs');
  // 以前の版でプロジェクトに残っている設定は使わない
  assert.equal(resolveProvider('irodori'), 'elevenlabs');
  assert.match(engineId('elevenlabs'), /^elevenlabs:eleven_v4/);
});

test('オーディオタグ: 演技指示・絵文字から自動で付き、選んだタグが優先される', () => {
  assert.deepEqual(autoTags({ emoji: '😲', delivery: 'ワクワクして、自信たっぷりに' }), ['surprised', 'excited']);
  assert.deepEqual(autoTags({ delivery: '困り顔で小声で' }), ['confused', 'whispers']);
  assert.deepEqual(autoTags({}), []);
  // 選んだタグ（[] はタグなし）は自動より優先。表記ゆれは直す
  assert.deepEqual(lineTags({ tags: ['Sighs', '[sad]'], delivery: '元気よく' }), ['sighs', 'sad']);
  assert.deepEqual(lineTags({ tags: [], delivery: '元気よく' }), []);
  assert.equal(normalizeTag('[laughs softly]'), 'laughs softly');
  assert.equal(normalizeTag('笑う'), '');
});

test('オーディオタグ: ElevenLabs にはタグ付き、ほかのエンジンにはタグを外して送る', () => {
  const line = { id: 'x', speaker: 'saki', text: 'だったら、[[SUSHI TOP OCR]]！', style: 'bubble' as const, tags: ['excited'] };
  assert.equal(elevenSpeechText(line), '[excited] だったら、SUSHI TOP OCR！');
  const inline = { ...line, tags: [] as string[], speak: 'えっ、[laughs] ほんとに？' };
  assert.equal(elevenSpeechText(inline), 'えっ、[laughs] ほんとに？');
  assert.equal(plainSpeechText(inline), 'えっ、 ほんとに？');
  // 強調の [[ ]] はタグとして扱わない
  assert.equal(stripAudioTags('[[レシート]]を[sighs]撮る'), '[[レシート]]を撮る');
  assert.equal(withAudioTags('こんにちは', ['cheerfully', 'warmly']), '[cheerfully] [warmly] こんにちは');
});

test('ElevenLabs: タグ・声・話速・表現の幅が変わると音声は古い扱いになる', () => {
  const line = sample.scenes[1].lines[0];
  const voice = voiceFor(line.speaker, sample.cast);
  const engine = 'elevenlabs:eleven_v3';
  const base = narrationHash(line, voice, engine);
  assert.notEqual(base, narrationHash({ ...line, tags: ['gasps'] }, voice, engine), 'tags');
  assert.notEqual(base, narrationHash(line, { ...voice, eleven: { voiceId: 'abc' } }, engine), 'voice');
  assert.notEqual(base, narrationHash(line, { ...voice, eleven: { speed: 1.25 } }, engine), 'speed');
  // 表現の幅はプロジェクト共通（エンジンの識別子に入る）
  assert.notEqual(base, narrationHash(line, voice, engineKey(engine, { elevenStability: 'creative' })), 'stability');
  assert.equal(engineKey(engine, { elevenStability: 'natural' }), `${engine}|natural`);
  assert.equal(engineKey('irodori:irodori-tts', { elevenStability: 'creative' }), 'irodori:irodori-tts');
  assert.notEqual(base, narrationHash(line, voice, 'elevenlabs:eleven_v4'), 'model');
  // Irodori 用の項目（シード・キャプション）は ElevenLabs の音声に影響しない
  assert.equal(base, narrationHash(line, { ...voice, seed: 999 }, engine));
  // タグを選んでいれば、演技指示を書き換えても作り直さない
  const tagged = { ...line, tags: ['confident'] };
  assert.equal(narrationHash(tagged, voice, engine), narrationHash({ ...tagged, delivery: 'しょんぼり' }, voice, engine));
  // 既定の声は、そのキャラの標準の声（参照音声）をクローンした声（以前のプロジェクトで参照音声が未設定でも）
  assert.equal(voice.refVoice, undefined);
  assert.equal(elevenVoiceKey(voice), 'ref:osushi-chan');
  assert.equal(elevenVoiceKey({ ...voice, library: undefined }), `design:${voice.caption}`);
});

test('タイムライン: 文中のタグは読み上げ時間の見積もりに数えない', () => {
  const p = Project.parse(blankProject({ id: 'x', title: 't', brandName: 'テスト' }));
  const l = p.scenes[0].lines[0] ?? p.scenes.flatMap((s) => s.lines)[0];
  l.audio = undefined;
  const plain = lineDurationSec({ ...l, speak: 'こんにちは、よろしくね' }, p);
  const tagged = lineDurationSec({ ...l, speak: '[laughs] こんにちは、[sighs] よろしくね' }, p);
  assert.equal(plain, tagged);
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

test('シーンの長さ: 手で伸ばす・縮められる。セリフの途中では切らず、カットは拍に乗る', () => {
  const eighth = (60 / sample.audio.bpm / 2) * sample.fps;
  const base = computeTimeline(sample);
  const i = base.scenes.findIndex((st) => st.lines.length > 0 && st.index < sample.scenes.length - 1);
  const auto = base.scenes[i];
  assert.equal(auto.fixed, false);

  const withLen = (sec: number) => {
    const p = structuredClone(sample);
    p.scenes[i].lengthSec = sec;
    return computeTimeline(Project.parse(p));
  };
  const cutsOnGrid = (tl: ReturnType<typeof computeTimeline>) =>
    tl.scenes.every((st) => Math.round((st.start + st.duration) / eighth) * eighth === st.start + st.duration);

  // 伸ばす: 指定した長さ（拍に吸着）になり、後ろのシーンは後ろへずれる
  const longer = withLen(auto.duration / sample.fps + 2);
  assert.ok(longer.scenes[i].fixed);
  assert.ok(Math.abs(longer.scenes[i].duration - (auto.duration + 2 * sample.fps)) <= eighth / 2 + 1);
  assert.equal(longer.scenes[i + 1].start, longer.scenes[i].start + longer.scenes[i].duration);
  assert.ok(cutsOnGrid(longer));

  // 縮める: 自動より短くできるが、最後のセリフを言い終わるまでは残す
  const shorter = withLen(auto.minSec + 0.3);
  assert.ok(shorter.scenes[i].duration < auto.duration, 'shorter than auto');
  assert.ok(cutsOnGrid(shorter));
  const lastEnd = Math.max(...shorter.scenes[i].lines.map((l) => l.end));
  assert.ok(lastEnd <= shorter.scenes[i].duration, 'speech not cut');

  // 極端に短くしても、セリフの終わり（最短の長さ）より短くはならない
  const tiny = withLen(0.3);
  assert.ok(tiny.scenes[i].duration / sample.fps >= auto.minSec - 0.05);
  assert.ok(Math.max(...tiny.scenes[i].lines.map((l) => l.end)) <= tiny.scenes[i].duration);
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
        lines: [{ speaker: 'unknown', text: 'やあ', speak: null, delivery: null, tags: ['excited', 'not-a-tag', 'excited', 'sighs', 'happy'], pose: null, style: 'bubble' }],
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
  // タグは一覧にあるものだけ・重複なし・最大2つ。Irodori 用に最初のタグに合う絵文字も入る
  assert.deepEqual(f.lines[0].tags, ['excited', 'sighs']);
  assert.equal(f.lines[0].emoji, '😆');
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
  // 声のデザイン（キャプション）は、標準の声の無いキャラでだけ効く
  const custom = { ...voice, library: undefined };
  assert.notEqual(narrationHash(line, custom, 'irodori:irodori-tts'), narrationHash(line, { ...custom, caption: '低い男性の声' }, 'irodori:irodori-tts'), 'caption');
  assert.equal(irodori, narrationHash(line, { ...voice, caption: '低い男性の声' }, 'irodori:irodori-tts'), 'library voice ignores caption');
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
  talk.layouts = { vertical: { headline: { dx: 10, dy: 0, scale: 1.2, rotate: 5 } } };
  assert.equal(Project.parse(p).scenes.find((s) => s.id === talk.id)!.layouts!.vertical!.headline.rotate, 5);
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

test('資料の読み込み: HTMLから本文を取り出し、Office文書(ZIP)の文字を読める', async () => {
  const { htmlToText, officeToText } = await import('../server/ai/sources');
  const page = htmlToText('<html><head><title>商品A｜公式</title><meta name="description" content="説明文"><style>.x{}</style></head><body><nav>メニュー</nav><h1>見出し</h1><p>本文&amp;テキスト</p><script>alert(1)</script></body></html>');
  assert.equal(page.title, '商品A｜公式');
  assert.equal(page.description, '説明文');
  assert.ok(page.text.includes('見出し') && page.text.includes('本文&テキスト') && !page.text.includes('alert'));
  // 最小の PPTX（スライド1枚）を組み立てて読む
  const zlib = await import('node:zlib');
  const entry = (name: string, body: string) => {
    const data = zlib.deflateRawSync(Buffer.from(body));
    return { name: Buffer.from(name), data, raw: Buffer.from(body) };
  };
  const files = [entry('ppt/slides/slide1.xml', '<p:sld><a:p><a:r><a:t>課題はデータ分断</a:t></a:r></a:p><a:p><a:t>解決します</a:t></a:p></p:sld>')];
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const f of files) {
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0);
    lh.writeUInt16LE(8, 8);
    lh.writeUInt32LE(f.data.length, 18);
    lh.writeUInt32LE(f.raw.length, 22);
    lh.writeUInt16LE(f.name.length, 26);
    parts.push(lh, f.name, f.data);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0);
    ch.writeUInt16LE(8, 10);
    ch.writeUInt32LE(f.data.length, 20);
    ch.writeUInt32LE(f.raw.length, 24);
    ch.writeUInt16LE(f.name.length, 28);
    ch.writeUInt32LE(offset, 42);
    central.push(ch, f.name);
    offset += 30 + f.name.length + f.data.length;
  }
  const cd = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(cd.length, 12);
  eocd.writeUInt32LE(offset, 16);
  const text = officeToText('deck.pptx', Buffer.concat([...parts, cd, eocd]));
  assert.ok(text.includes('スライド1') && text.includes('課題はデータ分断') && text.includes('解決します'));
});

test('直接調整: 画面の形ごとに調整を別々に持ち、旧形式は今の形へ移す', () => {
  const p = Project.parse(structuredClone(sample));
  const sc = p.scenes[0];
  setSceneLayout(sc, 'vertical', { logo: { dx: 50, dy: 0, scale: 1, rotate: 0 } });
  setSceneLayout(sc, 'horizontal', { logo: { dx: -80, dy: 20, scale: 1.5, rotate: 0 } });
  assert.equal(readAdjust(sc, 'logo', 'vertical').dx, 50);
  assert.equal(readAdjust(sc, 'logo', 'horizontal').scale, 1.5);
  assert.equal(readAdjust(sc, 'logo', 'square').dx, 0); // 正方形は未調整のまま
  setSceneLayout(sc, 'horizontal', {});
  assert.deepEqual(Object.keys(sc.layouts ?? {}), ['vertical']);
  // 旧形式（layout と セリフの tail）
  const q = Project.parse({ ...structuredClone(sample), format: 'square' });
  const t = q.scenes.find((s) => s.lines.length)!;
  t.layout = { headline: { dx: 5, dy: 5, scale: 1, rotate: 0 } };
  t.lines[0].tail = { dx: -100, dy: 0 };
  migrateLayouts(q);
  assert.equal(t.layout, undefined);
  assert.equal(t.lines[0].tail, undefined);
  assert.equal(sceneLayout(t, 'square').headline.dx, 5);
  assert.equal(readAdjust(t, `line:${t.lines[0].id}`, 'square').tail?.dx, -100);
  assert.equal(readAdjust(t, 'headline', 'vertical').dx, 0);
});

test('URL読み込み: 社内・ローカルのアドレスを見分ける（公開時のSSRF対策）', async () => {
  const { isPrivateAddress } = await import('../server/ai/sources');
  for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.10', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:10.0.0.1'])
    assert.ok(isPrivateAddress(ip), ip);
  for (const ip of ['8.8.8.8', '172.32.0.1', '203.0.113.5', '2606:4700::1111']) assert.ok(!isPrivateAddress(ip), ip);
});

test('音色補正: 補正なしなら元のまま、高音域を上げると高音だけが強くなる', async () => {
  const { applyEq, bandProfile } = await import('../server/ai/voiceEq');
  const rate = 48000;
  // 500Hz と 9kHz を混ぜた音
  const x = Float32Array.from({ length: rate }, (_, i) => 0.3 * Math.sin((2 * Math.PI * 500 * i) / rate) + 0.1 * Math.sin((2 * Math.PI * 9000 * i) / rate));
  const same = applyEq(x, rate, new Array(10).fill(0));
  assert.equal(same, x);
  const flat = applyEq(x, rate, [0, 0, 0, 0, 0, 0, 0.6, 0, 0, 0]); // ほぼ0でも処理は通る
  let diff = 0;
  for (let i = 2000; i < rate - 2000; i++) diff = Math.max(diff, Math.abs(flat[i] - x[i]));
  assert.ok(diff < 0.05, `near-identity ${diff}`);
  const boosted = applyEq(x, rate, [0, 0, 0, 0, 0, 0, 6, 6, 6, 6]);
  const low = (y: Float32Array, f: number) => {
    let c = 0;
    let s = 0;
    for (let i = 0; i < y.length; i++) (c += y[i] * Math.cos((2 * Math.PI * f * i) / rate)), (s += y[i] * Math.sin((2 * Math.PI * f * i) / rate));
    return Math.hypot(c, s);
  };
  const r500 = low(boosted, 500) / low(x, 500);
  const r9k = low(boosted, 9000) / low(x, 9000);
  assert.ok(Math.abs(r500 - 1) < 0.08, `500Hz unchanged ${r500}`);
  assert.ok(r9k > 1.7 && r9k < 2.3, `9kHz boosted ~+6dB ${r9k}`);
  assert.equal(bandProfile(new Float32Array(10), rate).length, 10);
});

test('ElevenLabs: タグ付きの文と声の設定を送り、標準の声は初回だけクローンする（模擬サーバー）', async () => {
  const reqs: { url: string; body: string; key?: string }[] = [];
  let ttsCalls = 0;
  let cloneN = 0;
  // アカウントにすでにある声（別の環境で作った声）
  let existing: { voice_id: string; name: string; description?: string }[] = [];
  const rate = 44100;
  const tone = new Float32Array(rate);
  for (let i = 4000; i < 30000; i++) tone[i] = Math.sin(i / 8) * 0.3;
  const wav = encodeWav(tone, rate);
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      reqs.push({ url: req.url ?? '', body: Buffer.concat(chunks).toString('utf8'), key: req.headers['xi-api-key'] as string });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/voices/add') return void res.end(JSON.stringify({ voice_id: `cloned${++cloneN}`, requires_verification: false }));
      if (req.url?.startsWith('/v2/voices')) return void res.end(JSON.stringify({ voices: existing }));
      if (req.url?.startsWith('/v1/text-to-speech/')) {
        ttsCalls++;
        // 2回目は「声が消えた」ことにする → 作り直して1回だけやり直すはず
        if (ttsCalls === 2) return void ((res.statusCode = 404), res.end(JSON.stringify({ detail: { code: 'voice_not_found', message: 'gone' } })));
        res.setHeader('content-type', 'audio/mpeg');
        return void res.end(wav);
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const saved = { ...config.eleven };
  const savedDir = config.voicesDir;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eleven-test-'));
  Object.assign(config.eleven, { apiKey: 'test-key', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'eleven_v3', language: 'ja' });
  config.voicesDir = tmp;
  try {
    const voice = { ...libraryCastMember('hayami-saki').voice, refVoice: undefined, library: 'hayami-saki' };
    const r1 = await synthesizeToFile('[excited] だったら、スシトップ！', voice, path.join(tmp, 'a.wav'), { provider: 'elevenlabs' });
    assert.ok(r1.durationSec > 0.3 && fs.existsSync(path.join(tmp, 'a.wav')));
    const clones = () => reqs.filter((x) => x.url === '/v1/voices/add');
    assert.equal(clones().length, 1, 'standard voice cloned once');
    assert.match(clones()[0].body, /速水さき/);
    const tts = reqs.find((x) => x.url.startsWith('/v1/text-to-speech/'))!;
    assert.equal(tts.url, '/v1/text-to-speech/cloned1?output_format=mp3_44100_128');
    assert.equal(tts.key, 'test-key');
    const body = JSON.parse(tts.body);
    assert.equal(body.text, '[excited] だったら、スシトップ！');
    assert.equal(body.model_id, 'eleven_v3');
    assert.equal(body.language_code, 'ja');
    assert.equal(body.voice_settings.stability, 0.5);
    assert.equal(body.voice_settings.speed, 1.1);
    // 声が消えていたら、作り直して続ける
    await synthesizeToFile('えっ、すごい！', voice, path.join(tmp, 'b.wav'), { provider: 'elevenlabs' });
    assert.equal(clones().length, 2, 're-cloned after voice_not_found');
    // 以後は覚えた声を使う（作り直さない）
    await synthesizeToFile('いいね〜！', { ...voice, eleven: { speed: 1.3 } }, path.join(tmp, 'c.wav'), { provider: 'elevenlabs', stability: 'creative' });
    assert.equal(clones().length, 2, 'cached voice reused');
    const last = JSON.parse(reqs.filter((x) => x.url.startsWith('/v1/text-to-speech/')).at(-1)!.body);
    assert.equal(last.voice_settings.stability, 0);
    // 1.2 を超える速さは、ElevenLabs の上限で作ってから伸縮する
    assert.equal(last.voice_settings.speed, 1.2);
    // 覚えた声が無い環境でも、アカウントに以前作った声（旧名「Ad Studio」）があれば、クローンせずに使い回す
    fs.rmSync(path.join(tmp, 'elevenlabs.json'));
    existing = [{ voice_id: 'old-saki', name: '速水さき（標準の声）（Ad Studio）' }];
    await synthesizeToFile('はい！', voice, path.join(tmp, 'd.wav'), { provider: 'elevenlabs' });
    assert.equal(clones().length, 2, 'existing voice reused');
    assert.match(reqs.filter((x) => x.url.startsWith('/v1/text-to-speech/')).at(-1)!.url, /^\/v1\/text-to-speech\/old-saki\?/);
  } finally {
    Object.assign(config.eleven, saved);
    config.voicesDir = savedDir;
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('ElevenLabs: v4 は1セリフずつ Text to Dialogue で読み、文字起こしで台本と照合して、違えば作り直す（模擬サーバー）', async () => {
  const rate = 44100;
  const reqs: { url: string; body: string }[] = [];
  let v4Ok = true;
  // 文字起こしの返事: 1回目は途中で切れた文、2回目からは台本どおり
  const heard: Record<string, string[]> = {};
  const tone = (sec: number) => {
    const s = new Float32Array(Math.round(rate * (sec + 0.4)));
    for (let i = Math.round(rate * 0.2); i < Math.round(rate * (sec + 0.2)); i++) s[i] = Math.sin(i / 7) * 0.3;
    return encodeWav(s, rate);
  };
  const server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      reqs.push({ url: req.url ?? '', body });
      res.setHeader('content-type', 'application/json');
      if (req.url === '/v1/voices/add') return void res.end(JSON.stringify({ voice_id: /速水/.test(body) ? 'v-saki' : 'v-osushi' }));
      if (req.url?.startsWith('/v1/text-to-dialogue')) {
        if (!v4Ok) return void ((res.statusCode = 400), res.end(JSON.stringify({ detail: { code: 'invalid_model', message: 'model eleven_v4 is not available' } })));
        res.setHeader('content-type', 'audio/mpeg');
        return void res.end(tone(1));
      }
      if (req.url?.startsWith('/v1/text-to-speech/')) return void ((res.setHeader('content-type', 'audio/mpeg'), res.end(tone(1))));
      if (req.url === '/v1/speech-to-text') {
        // 送った台本の文（keyterms ではなく、合図用に model_id の後ろの順番で返す）
        const key = 'line';
        const list = (heard[key] ??= ['だったら', 'だったら、SUSHI TOP OCR！']);
        return void res.end(JSON.stringify({ text: list.length > 1 ? list.shift() : list[0] }));
      }
      res.statusCode = 404;
      res.end('{}');
    });
  });
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', r));
  const saved = { ...config.eleven };
  const savedDir = config.voicesDir;
  const savedProvider = config.tts.provider;
  const savedKey = config.openaiKey;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'eleven-v4-'));
  Object.assign(config.eleven, { apiKey: 'k', baseUrl: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, model: 'eleven_v4', language: 'ja', verify: true, sttModel: 'scribe_v2' });
  config.voicesDir = tmp;
  config.tts.provider = 'elevenlabs';
  config.openaiKey = ''; // 判定は照合だけで（OpenAI は使わない）
  try {
    const project = Project.parse(structuredClone(sample));
    const target = project.scenes.flatMap((s) => s.lines).find((l) => l.text.startsWith('だったら'))!;
    target.speak = undefined;
    target.tags = ['confident'];
    for (const s of project.scenes) for (const l of s.lines) l.audio = undefined;
    const r = await generateNarration(project, tmp, { only: [target.id], force: true });
    assert.equal(r.generated, 1);
    const dialogue = reqs.filter((x) => x.url.startsWith('/v1/text-to-dialogue'));
    // 1回目は途中で切れていた → 作り直し（2回作る）
    assert.equal(dialogue.length, 2, 'retaken once after a truncated read');
    const body = JSON.parse(dialogue[0].body);
    assert.equal(body.model_id, 'eleven_v4');
    assert.equal(body.inputs.length, 1, 'one line per request');
    assert.equal(body.inputs[0].text, '[confident] だったら、SUSHI TOP OCR！');
    assert.equal(body.inputs[0].voice_id, 'v-saki');
    assert.ok(body.settings.stability != null);
    assert.equal(reqs.filter((x) => x.url === '/v1/speech-to-text').length, 2);
    assert.match(reqs.find((x) => x.url === '/v1/speech-to-text')!.body, /SUSHI TOP OCR/, 'brand name sent as a key term');
    assert.deepEqual(target.audio?.check, { ok: true, heard: 'だったら、SUSHI TOP OCR！' });
    // v4 が使えない時は v3（Text to Speech）に切り替える
    v4Ok = false;
    reqs.length = 0;
    target.tags = ['excited'];
    await generateNarration(project, tmp, { only: [target.id], force: true });
    assert.ok(reqs.some((x) => x.url.startsWith('/v1/text-to-speech/v-saki')), 'fell back to eleven_v3');
    assert.equal(JSON.parse(reqs.find((x) => x.url.startsWith('/v1/text-to-speech/'))!.body).model_id, 'eleven_v3');
  } finally {
    Object.assign(config.eleven, saved);
    config.voicesDir = savedDir;
    config.tts.provider = savedProvider;
    config.openaiKey = savedKey;
    server.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('読み上げの確認: 表記の違いは許し、読み落とし・途中で切れる・違う言葉は見つける', () => {
  const exp = ['だったら、SUSHI TOP OCR！'];
  assert.ok(speechScore(exp, 'だったら SUSHI TOP OCR') >= SURE_OK);
  assert.ok(speechScore(['レシートを撮るだけで'], 'レシートを撮るだけで。') >= SURE_OK);
  // カタカナ/ひらがな・長音・記号の違いは同じとみなす
  assert.ok(speechScore(['いいね〜！'], 'イイネ') >= SURE_OK);
  // 漢字をかなで書き起こしても、途切れほどは下がらない（OpenAI が無い時の基準 0.5 を超える）
  assert.ok(speechScore(['アプリも大変で〜……'], 'あぷりもたいへんで') >= 0.5);
  // 途中で切れている
  assert.ok(speechScore(exp, 'だったら') < 0.5);
  // 違う言葉
  assert.ok(speechScore(['特典を出し分け！'], '特典をお届け！') < SURE_OK);
  // 余計な言葉が足されている
  assert.ok(speechScore(['なにがいいの？'], 'ええと、それで、なにがいいのかなあ、教えてほしいな') < SURE_OK);
  // 読み方を指定している時は、どちらかに合えばよい
  assert.ok(speechScore(['POS改修なしで', 'ポス改修なしで'], 'ポス改修なしで') >= SURE_OK);
  assert.equal(normalizeSpeech('[excited] [[SUSHI]] トップ！'), 'sushiとっぷ');
  assert.deepEqual(keytermsOf('だったら、SUSHI TOP OCR！ AIが'), ['SUSHI TOP OCR', 'AI']);
});

test('ElevenLabs の音声は、間のあとの小さな語尾や小声を切らない', () => {
  const rate = 24000;
  const s = new Float32Array(rate * 2);
  // 大きな声 0.5秒 → 間 0.3秒 → 小さな語尾 0.3秒（本体の2割の大きさ）
  for (let i = 2400; i < 2400 + 12000; i++) s[i] = Math.sin(i / 5) * 0.5;
  for (let i = 21600; i < 21600 + 7200; i++) s[i] = Math.sin(i / 5) * 0.1;
  const strict = trimAndNormalize(s, rate);
  const gentle = trimAndNormalize(s, rate, { gentle: true });
  assert.ok(strict.length / rate < 0.8, 'Irodori 向けは取り残された音として外す');
  assert.ok(gentle.length / rate > 1.15, `ElevenLabs 向けは語尾を残す (${(gentle.length / rate).toFixed(2)}s)`);
});

test('レイヤー: 既定の重なり順は描画の順と同じ（キャラは小さい順・小道具・吹き出し・字幕が手前）', () => {
  const p = Project.parse(structuredClone(sample));
  const talk = p.scenes.find((x) => x.type === 'talk' && x.characters.length >= 2 && x.prop)!;
  assert.ok(talk, 'sample has a talk scene with a prop');
  talk.layouts = undefined;
  const order = layerOrder(talk, 'vertical');
  const sizes = talk.characters.map((c) => c.size);
  const chars = order.filter((id) => id.startsWith('char:'));
  const rank = { s: 0, m: 1, l: 2, xl: 3 } as const;
  for (let i = 1; i < chars.length; i++) assert.ok(rank[sizes[Number(chars[i - 1].slice(5))]] <= rank[sizes[Number(chars[i].slice(5))]], 'smaller characters behind');
  assert.ok(order.indexOf('prop') > Math.max(...chars.map((c) => order.indexOf(c))), 'prop in front of characters');
  const bubbles = order.filter((id) => id.startsWith('line:'));
  assert.ok(bubbles.length && order.indexOf(bubbles[0]) > order.indexOf('prop'), 'bubbles in front of the prop');
  // 声だけのセリフ（吹き出し無し）はレイヤーに出さない
  for (const l of talk.lines) if (l.style === 'none') assert.ok(!order.includes(`line:${l.id}`));
});

test('レイヤー: 並べ替え・最前面・最背面は、その画面の形の重なり順だけを変える', () => {
  const p = Project.parse(structuredClone(sample));
  const sc = p.scenes.find((x) => x.type === 'feature')!;
  sc.layouts = undefined;
  const before = layerOrder(sc, 'vertical');
  const reversed = [...before].reverse();
  setLayerOrder(sc, 'vertical', reversed);
  assert.deepEqual(layerOrder(sc, 'vertical'), reversed);
  // 位置の調整は消さずに z だけ付く
  assert.equal(readAdjust(sc, reversed[0], 'vertical').z, 0);
  moveLayer(sc, 'vertical', 'visual', 'front');
  assert.equal(layerOrder(sc, 'vertical').at(-1), 'visual');
  moveLayer(sc, 'vertical', 'visual', 'back');
  assert.equal(layerOrder(sc, 'vertical')[0], 'visual');
  moveLayer(sc, 'vertical', 'visual', 1);
  assert.equal(layerOrder(sc, 'vertical')[1], 'visual');
  // 横型は変わらない
  assert.deepEqual(layerOrder(sc, 'horizontal'), before);
  // 調整（移動）と重なり順は両立する
  const map = { ...sceneLayout(sc, 'vertical') };
  map.headline = { ...readAdjust(sc, 'headline', 'vertical'), dx: 40 };
  setSceneLayout(sc, 'vertical', map);
  moveLayer(sc, 'vertical', 'headline', 'front');
  assert.equal(readAdjust(sc, 'headline', 'vertical').dx, 40);
  assert.equal(layerOrder(sc, 'vertical').at(-1), 'headline');
});

test('元に戻す: 戻した内容に合う音声が今・履歴にあれば引き継ぐ（作り直した音声が前の音声に戻らない）', () => {
  const engine = 'elevenlabs:eleven_v4';
  const p0 = Project.parse(structuredClone(sample));
  const line = (p: Project) => p.scenes.flatMap((s) => s.lines).find((l) => l.text.trim())!;
  const hashOf = (p: Project) => narrationHash(line(p), voiceFor(line(p).speaker, p.cast), engine);
  // p0: 古い音声 → p1: 文を変えた（まだ古い音声）→ p2: ほかを変えた → 作り直し（新しい音声）→ 元に戻すで p1 に戻る
  line(p0).audio = { src: 'audio/old.wav', durationSec: 1, hash: 'old' };
  const p1 = structuredClone(p0);
  line(p1).text = '書き換えたセリフ';
  const p2 = structuredClone(p1);
  p2.title = '別の変更';
  line(p2).audio = { src: 'audio/new.wav', durationSec: 1.2, hash: hashOf(p2) };
  const back = carryAudio(p1, [p2, p0], engine);
  assert.equal(line(back).audio?.src, 'audio/new.wav');
  assert.equal(line(p1).audio?.src, 'audio/old.wav', 'does not mutate the history entry');
  // 文も元に戻した時は、その文の音声（前の音声）のまま
  line(p0).audio!.hash = hashOf(p0);
  assert.equal(line(carryAudio(p0, [p2], engine)).audio?.src, 'audio/old.wav');
});

test('保存: 同時に保存・更新しても壊れず、「読んで直して書く」は1つずつ順番に行う', async () => {
  const { saveProject, updateProject, loadProject } = await import('../server/projects');
  const savedDir = config.projectsDir;
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'projects-test-'));
  config.projectsDir = tmp;
  try {
    const base = Project.parse({ ...structuredClone(sample), id: 'lock-test', title: '0' });
    await saveProject(base);
    // 20回の「読んで +1 して書く」と、割り込む保存を同時に走らせる
    await Promise.all([
      ...Array.from({ length: 20 }, () => updateProject('lock-test', (p) => void (p.title = String(Number(p.title) + 1)))),
      ...Array.from({ length: 5 }, () => saveProject({ ...base, brand: { ...base.brand, tagline: 'x' } }).catch((e) => e)),
    ]);
    const p = await loadProject('lock-test');
    assert.ok(Number(p.title) >= 0, 'still a valid project');
    // 割り込む保存が無ければ、20回分すべて反映される
    await saveProject({ ...base, title: '0' });
    await Promise.all(Array.from({ length: 20 }, () => updateProject('lock-test', (q) => void (q.title = String(Number(q.title) + 1)))));
    assert.equal((await loadProject('lock-test')).title, '20');
    assert.deepEqual(fs.readdirSync(path.join(tmp, 'lock-test')).filter((f) => f.endsWith('.tmp')), [], 'no leftover temp files');
  } finally {
    config.projectsDir = savedDir;
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});
