import { RenderInternals } from '@remotion/renderer';
import { spawn } from 'node:child_process';
import path from 'node:path';

let ffmpegPath: string | null = null;

/** Remotion 同梱の ffmpeg を使う（別途インストール不要） */
export const getFfmpeg = () => {
  if (!ffmpegPath) {
    ffmpegPath = RenderInternals.getExecutablePath({ indent: false, logLevel: 'error', type: 'ffmpeg', binariesDirectory: null });
  }
  return ffmpegPath;
};

export const runFfmpeg = (args: string[]): Promise<void> =>
  new Promise((resolve, reject) => {
    const bin = getFfmpeg();
    const p = spawn(bin, ['-hide_banner', '-loglevel', 'error', '-y', ...args], { cwd: path.dirname(bin) });
    let err = '';
    p.stderr.on('data', (d) => (err += d.toString()));
    p.on('error', reject);
    p.on('close', (code) => (code === 0 ? resolve() : reject(new Error(`ffmpeg failed (${code}): ${err.slice(-800)}`))));
  });

/** PCM WAV の長さ（秒） */
export const wavDurationSec = (buf: Buffer): number => {
  if (buf.toString('ascii', 0, 4) !== 'RIFF') throw new Error('not a wav');
  let offset = 12;
  let byteRate = 0;
  while (offset + 8 <= buf.length) {
    const id = buf.toString('ascii', offset, offset + 4);
    const size = buf.readUInt32LE(offset + 4);
    if (id === 'fmt ') byteRate = buf.readUInt32LE(offset + 16);
    if (id === 'data') {
      const dataSize = Math.min(size, buf.length - offset - 8);
      return byteRate ? dataSize / byteRate : 0;
    }
    offset += 8 + size + (size % 2);
  }
  return 0;
};
