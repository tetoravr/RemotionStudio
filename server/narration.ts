import fs from 'node:fs/promises';
import path from 'node:path';
import type { Line, Project } from '../src/video/schema';
import { config } from './env';
import { lineHash, resolveProvider, speechText, synthesizeToFile, ttsText, voiceFor } from './ai/tts';

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

/** 読み上げの確認に使う台本（表示の文と、読み方を指定していればその文） */
export const expectedTexts = (line: Line) => [line.text.replace(/\[\[|\]\]/g, '').replace(/\n/g, ''), line.speak ?? ''].filter((t) => t.trim());

/**
 * セリフのナレーションを生成（ElevenLabs・Irodori-TTS・OpenAI TTS）（変更のあったセリフだけ）。
 * 1セリフずつ、キャラごとに決まった声（ElevenLabs は標準の声を Instant Voice Cloning した声など）で読むので、どのシーンでも同じ声になる。
 * ElevenLabs は作った音声を文字起こしして台本と照合し、読み違い・途中で切れている時は作り直す。
 * 音声は <projectDir>/audio/<lineId>-<hash>.wav に保存され、project に書き戻される。
 */
export const generateNarration = async (
  project: Project,
  projectDir: string,
  { force = false, only, concurrency, onProgress }: { force?: boolean; only?: string[]; concurrency?: number; onProgress?: NarrationProgress } = {},
) => {
  const provider = resolveProvider(project.audio.ttsProvider);
  // Irodori-TTS のサーバーは 1 件ずつ処理する（並列にしても速くならない）。ElevenLabs はプランの同時実行数まで
  concurrency ??= provider === 'irodori' ? 1 : provider === 'elevenlabs' ? Math.max(1, config.eleven.concurrency) : 4;
  const todo = staleLines(project, force, only);
  let done = 0;
  onProgress?.(0, todo.length, '音声を生成しています');
  const queue = [...todo];
  const errors: string[] = [];
  const worker = async () => {
    while (queue.length) {
      const item = queue.shift()!;
      const line = project.scenes[item.sceneIndex].lines[item.lineIndex];
      const voice = voiceFor(line.speaker, project.cast);
      // 作り直しても同じ名前だと、ブラウザが古い音声を使い回すことがあるので、毎回別名にする
      const rel = `audio/${line.id}-${item.hash}-${Math.random().toString(36).slice(2, 7)}.wav`;
      try {
        const r = await synthesizeToFile(ttsText(line, provider), voice, path.join(projectDir, rel), {
          delivery: line.delivery,
          emoji: line.emoji,
          provider,
          stability: project.audio.elevenStability,
          expected: expectedTexts(line),
        });
        line.audio = { src: rel, durationSec: r.durationSec, hash: item.hash, mouth: r.mouth, ...(r.check ? { check: r.check } : {}) };
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

/**
 * 使われなくなった音声ファイルを削除。
 * 作ったばかりのファイルは残す（エディターが別の作成の結果をまだ保存していない間に消さないように）
 */
const cleanupAudio = async (project: Project, projectDir: string) => {
  const used = new Set(project.scenes.flatMap((s) => s.lines.map((l) => l.audio?.src).filter(Boolean)));
  const dir = path.join(projectDir, 'audio');
  const files = await fs.readdir(dir).catch(() => [] as string[]);
  const keepAfter = Date.now() - 30 * 60_000;
  await Promise.all(
    files
      .filter((f) => !used.has(`audio/${f}`))
      .map(async (f) => {
        const st = await fs.stat(path.join(dir, f)).catch(() => null);
        if (st && st.mtimeMs < keepAfter) await fs.rm(path.join(dir, f), { force: true });
      }),
  );
};
