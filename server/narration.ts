import fs from 'node:fs/promises';
import path from 'node:path';
import { elevenSpeechText } from '../src/video/narrationKey';
import type { Line, Project } from '../src/video/schema';
import { config } from './env';
import { DIALOGUE_MAX_CHARS, DIALOGUE_MAX_VOICES, synthElevenDialogue, type DialogueInput } from './ai/elevenlabs';
import { lineHash, resolveProvider, saveSpeech, speechText, synthesizeToFile, trimAndNormalize, ttsText, voiceFor } from './ai/tts';
import { elevenVoiceKey } from '../src/video/audioTags';

export type NarrationProgress = (done: number, total: number, message: string) => void;

type Item = { sceneIndex: number; lineIndex: number; hash: string };

/** 音声が古い／無いセリフを数える */
export const staleLines = (project: Project, force = false, only?: string[]) => {
  const out: Item[] = [];
  const provider = resolveProvider(project.audio.ttsProvider);
  project.scenes.forEach((s, si) =>
    s.lines.forEach((l, li) => {
      if (!speechText(l).trim()) return;
      if (only && !only.includes(l.id)) return;
      const hash = lineHash(l, voiceFor(l.speaker, project.cast), provider, project.audio);
      if (force || !l.audio || l.audio.hash !== hash) out.push({ sceneIndex: si, lineIndex: li, hash });
    }),
  );
  return out;
};

/** 作り直しても同じ名前だと、ブラウザが古い音声を使い回すことがあるので、毎回別名にする */
const audioPath = (line: Line, hash: string) => `audio/${line.id}-${hash}-${Math.random().toString(36).slice(2, 7)}.wav`;

/** ElevenLabs が「まとめて読む」に対応していない（プランやモデルの都合）時は、1セリフずつに切り替える */
const dialogueUnsupported = (e: unknown) => {
  const x = e as { status?: number; code?: string };
  return [400, 403, 404, 405, 422].includes(x.status ?? 0) && x.code !== 'voice_not_found' && x.code !== 'quota_exceeded';
};

/**
 * 全セリフのナレーションを生成（ElevenLabs・Irodori-TTS・OpenAI TTS）（変更のあったセリフだけ）。
 * ElevenLabs は、台本全体を1回で読ませてからセリフごとに切り分ける（シーンが変わっても同じキャラは同じ声のまま）。
 * そのため ElevenLabs では、変更のあったセリフが1つでもあれば全セリフを読み直す。only（1セリフの作り直し）は前後の文をつながりの手がかりにして、そのセリフだけ作る。
 * 音声は <projectDir>/audio/<lineId>-<hash>.wav に保存され、project に書き戻される。
 */
export const generateNarration = async (
  project: Project,
  projectDir: string,
  { force = false, only, concurrency, onProgress }: { force?: boolean; only?: string[]; concurrency?: number; onProgress?: NarrationProgress } = {},
) => {
  const provider = resolveProvider(project.audio.ttsProvider);
  const stale = staleLines(project, force, only);
  if (!stale.length) return { generated: 0 };

  if (provider === 'elevenlabs') {
    try {
      const generated = only ? await elevenRetake(project, projectDir, stale, onProgress) : await elevenWholeTake(project, projectDir, onProgress);
      await cleanupAudio(project, projectDir);
      return { generated };
    } catch (e) {
      if (!dialogueUnsupported(e)) {
        await cleanupAudio(project, projectDir);
        throw e;
      }
      console.warn(`[elevenlabs] まとめて読めなかったので、1セリフずつ作ります: ${(e as Error).message}`);
    }
  }

  // Irodori-TTS のサーバーは 1 件ずつ処理する（並列にしても速くならない）。ElevenLabs はプランの同時実行数まで
  concurrency ??= provider === 'irodori' ? 1 : provider === 'elevenlabs' ? Math.max(1, config.eleven.concurrency) : 4;
  let done = 0;
  onProgress?.(0, stale.length, '音声を生成しています');
  const queue = [...stale];
  const errors: string[] = [];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const line = project.scenes[item.sceneIndex].lines[item.lineIndex];
      const voice = voiceFor(line.speaker, project.cast);
      const rel = audioPath(line, item.hash);
      try {
        const { durationSec, mouth } = await synthesizeToFile(ttsText(line, provider), voice, path.join(projectDir, rel), {
          delivery: line.delivery,
          emoji: line.emoji,
          provider,
          stability: project.audio.elevenStability,
        });
        line.audio = { src: rel, durationSec, hash: item.hash, mouth };
      } catch (e) {
        errors.push(`${line.text}: ${(e as Error).message}`);
      }
      done++;
      onProgress?.(done, stale.length, `「${line.text.replace(/\n/g, '')}」`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, stale.length) }, worker));
  await cleanupAudio(project, projectDir);
  if (errors.length) throw new Error(`${errors.length}件の音声生成に失敗しました\n${errors.slice(0, 3).join('\n')}`);
  return { generated: stale.length };
};

type Entry = { line: Line; hash: string; input: DialogueInput };

/** 読み上げるセリフを台本の順に。ElevenLabs に送る文（タグ付き）と声も添える */
const allEntries = (project: Project): Entry[][] =>
  project.scenes.map((s) =>
    s.lines
      .filter((l) => speechText(l).trim())
      .map((l) => {
        const voice = voiceFor(l.speaker, project.cast);
        return { line: l, hash: lineHash(l, voice, 'elevenlabs', project.audio), input: { text: elevenSpeechText(l), voice } };
      }),
  );

/** 1回で読む分に分ける（文字数・声の数の上限）。シーンの途中では切らない */
export const dialogueChunks = (scenes: Entry[][]): Entry[][] => {
  const chunks: Entry[][] = [];
  let cur: Entry[] = [];
  const chars = (es: Entry[]) => es.reduce((n, e) => n + e.input.text.length, 0);
  const voices = (es: Entry[]) => new Set(es.map((e) => elevenVoiceKey(e.input.voice))).size;
  for (const scene of scenes) {
    if (!scene.length) continue;
    const next = [...cur, ...scene];
    if (cur.length && (chars(next) > DIALOGUE_MAX_CHARS || voices(next) > DIALOGUE_MAX_VOICES)) {
      chunks.push(cur);
      cur = [...scene];
    } else cur = next;
  }
  if (cur.length) chunks.push(cur);
  return chunks;
};

const store = async (projectDir: string, e: Entry, take: { samples: Float32Array; rate: number }) => {
  const rel = audioPath(e.line, e.hash);
  const cleaned = trimAndNormalize(take.samples, take.rate);
  if (!cleaned.length) throw new Error(`「${e.line.text}」の音声が空でした`);
  const { durationSec, mouth } = await saveSpeech(cleaned, take.rate, path.join(projectDir, rel));
  e.line.audio = { src: rel, durationSec, hash: e.hash, mouth };
};

/** 台本全体を1回（長い時はシーンの区切りで数回）で読み、セリフごとに保存する */
const elevenWholeTake = async (project: Project, projectDir: string, onProgress?: NarrationProgress) => {
  const chunks = dialogueChunks(allEntries(project));
  const total = chunks.reduce((n, c) => n + c.length, 0);
  let done = 0;
  for (const [ci, chunk] of chunks.entries()) {
    onProgress?.(done, total, chunks.length > 1 ? `台本をまとめて読み上げています（${ci + 1}/${chunks.length}）` : '台本をまとめて読み上げています');
    const prev = chunks[ci - 1]?.at(-1)?.line;
    const next = chunks[ci + 1]?.[0]?.line;
    const takes = await synthElevenDialogue(
      chunk.map((e) => e.input),
      { stability: project.audio.elevenStability, previousText: prev ? speechText(prev) : undefined, futureText: next ? speechText(next) : undefined },
    );
    for (const [i, e] of chunk.entries()) {
      await store(projectDir, e, takes[i]);
      done++;
      onProgress?.(done, total, `「${e.line.text.replace(/\n/g, '')}」`);
    }
  }
  return total;
};

/** 指定したセリフだけ作り直す。前後のセリフをつながりの手がかりにする */
const elevenRetake = async (project: Project, projectDir: string, items: Item[], onProgress?: NarrationProgress) => {
  const flat = allEntries(project).flat();
  let done = 0;
  for (const item of items) {
    const line = project.scenes[item.sceneIndex].lines[item.lineIndex];
    const k = flat.findIndex((e) => e.line.id === line.id);
    if (k < 0) continue;
    const e = { ...flat[k], hash: item.hash };
    onProgress?.(done, items.length, `「${line.text.replace(/\n/g, '')}」`);
    const [take] = await synthElevenDialogue([e.input], {
      stability: project.audio.elevenStability,
      previousText: flat[k - 1] ? speechText(flat[k - 1].line) : undefined,
      futureText: flat[k + 1] ? speechText(flat[k + 1].line) : undefined,
    });
    await store(projectDir, e, take);
    done++;
  }
  onProgress?.(done, items.length, '完了');
  return done;
};

/** 使われなくなった音声ファイルを削除 */
const cleanupAudio = async (project: Project, projectDir: string) => {
  const used = new Set(project.scenes.flatMap((s) => s.lines.map((l) => l.audio?.src).filter(Boolean)));
  const dir = path.join(projectDir, 'audio');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => !used.has(`audio/${f}`)).map((f) => fs.rm(path.join(dir, f), { force: true })));
};
