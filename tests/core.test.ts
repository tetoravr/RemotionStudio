import assert from 'node:assert/strict';
import fs from 'node:fs';
import { test } from 'node:test';
import { aiToScenes, type AiStoryboard } from '../server/ai/storyboard';
import { trimAndNormalize } from '../server/ai/tts';
import { parseRich, fitFontSize } from '../src/video/components/RichText';
import { adaptForFormat } from '../src/video/adapt';
import { collectSfx } from '../src/video/events';
import { isAudioStale, narrationHash } from '../src/video/narrationKey';
import { Project } from '../src/video/schema';
import { blankProject, DEFAULT_CAST } from '../src/video/templates';
import { computeTimeline } from '../src/video/timeline';

const sample = Project.parse(JSON.parse(fs.readFileSync('public/samples/sushitop-ocr/project.json', 'utf8')));

test('サンプルプロジェクトがスキーマに適合し、全セリフに音声がある', () => {
  assert.equal(sample.scenes.length, 9);
  for (const s of sample.scenes) for (const l of s.lines) assert.ok(l.audio, `${l.id} has audio`);
  for (const s of sample.scenes) for (const l of s.lines) assert.equal(isAudioStale(l, sample.cast, 'gpt-4o-mini-tts'), false, `${l.id} is fresh`);
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
  assert.ok(tl.total / sample.fps > 25 && tl.total / sample.fps < 40, `about 30s (${tl.total / sample.fps})`);
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
        lines: [{ speaker: 'unknown', text: 'やあ', speak: null, pose: null, style: 'bubble' }],
        characters: [{ id: 'hero', pose: 'happy', position: 'left', size: 'm', enter: 'pop', enterDelaySec: 9 }],
        eyebrow: '[[A]]で',
        headline: 'B！',
        footnote: null,
        background: null,
        visual: { kind: 'stack', icon: 'receipt', count: 99 } as never,
      },
      { type: 'cta', transition: 'cut', lines: [], characters: [], buttonText: 'Go', contact: null, notes: [] },
    ],
  };
  const scenes = aiToScenes(ai, DEFAULT_CAST);
  assert.equal(scenes.length, 2);
  const f = scenes[0];
  assert.equal(f.type, 'feature');
  assert.equal(f.lines[0].speaker, 'narrator');
  assert.equal(f.lines[0].style, 'caption');
  assert.equal(f.characters[0].enterDelaySec, 2);
  if (f.type === 'feature' && f.visual.kind === 'stack') assert.equal(f.visual.count, 6);
  else assert.fail('visual should be stack');
});

test('TTS音声の前後無音カットと音量正規化', () => {
  const rate = 24000;
  const pcm = new Int16Array(rate); // 1秒
  for (let i = 8000; i < 16000; i++) pcm[i] = Math.round(Math.sin(i / 5) * 3000);
  const out = trimAndNormalize(pcm, rate);
  assert.ok(out.length < pcm.length * 0.5, 'silence trimmed');
  assert.ok(Math.max(...Array.from(out, Math.abs)) <= 0.9);
});
