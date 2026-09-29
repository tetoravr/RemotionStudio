import fs from 'node:fs/promises';
import path from 'node:path';
import type { Project } from '../src/video/schema';
import { lineHash, resolveProvider, speechText, synthesizeToFile, voiceFor } from './ai/tts';

export type NarrationProgress = (done: number, total: number, message: string) => void;

/** 音声が古い／無いセリフを数える */
export const staleLines = (project: Project, force = false) => {
  const out: { sceneIndex: number; lineIndex: number; hash: string }[] = [];
  const provider = resolveProvider(project.audio.ttsProvider);
  project.scenes.forEach((s, si) =>
    s.lines.forEach((l, li) => {
      if (!speechText(l).trim()) return;
      const hash = lineHash(l, voiceFor(l.speaker, project.cast), provider);
      if (force || !l.audio || l.audio.hash !== hash) out.push({ sceneIndex: si, lineIndex: li, hash });
    }),
  );
  return out;
};

/**
 * 全セリフのナレーションを生成（OpenAI TTS または Irodori-TTS）（変更のあったセリフだけ）。
 * 音声は <projectDir>/audio/<lineId>-<hash>.wav に保存され、project に書き戻される。
 */
export const generateNarration = async (
  project: Project,
  projectDir: string,
  { force = false, concurrency, onProgress }: { force?: boolean; concurrency?: number; onProgress?: NarrationProgress } = {},
) => {
  const provider = resolveProvider(project.audio.ttsProvider);
  // Irodori-TTS のサーバーは 1 件ずつ処理する（並列にしても速くならない）
  concurrency ??= provider === 'irodori' ? 1 : 4;
  const todo = staleLines(project, force);
  let done = 0;
  onProgress?.(0, todo.length, '音声を生成しています');
  const queue = [...todo];
  const errors: string[] = [];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const line = project.scenes[item.sceneIndex].lines[item.lineIndex];
      const voice = voiceFor(line.speaker, project.cast);
      const rel = `audio/${line.id}-${item.hash}.wav`;
      try {
        const { durationSec, mouth } = await synthesizeToFile(speechText(line), voice, path.join(projectDir, rel), { delivery: line.delivery, emoji: line.emoji, provider });
        line.audio = { src: rel, durationSec, hash: item.hash, mouth };
      } catch (e) {
        errors.push(`${line.text}: ${(e as Error).message}`);
      }
      done++;
      onProgress?.(done, todo.length, `「${line.text.replace(/\n/g, '')}」`);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, todo.length) }, worker));
  await cleanupAudio(project, projectDir);
  if (errors.length) throw new Error(`${errors.length}件の音声生成に失敗しました\n${errors.slice(0, 3).join('\n')}`);
  return { generated: todo.length };
};

/** 使われなくなった音声ファイルを削除 */
const cleanupAudio = async (project: Project, projectDir: string) => {
  const used = new Set(project.scenes.flatMap((s) => s.lines.map((l) => l.audio?.src).filter(Boolean)));
  const dir = path.join(projectDir, 'audio');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  await Promise.all(files.filter((f) => !used.has(`audio/${f}`)).map((f) => fs.rm(path.join(dir, f), { force: true })));
};
