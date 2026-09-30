import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { config } from '../env';
import { encodeWav, irodoriBase, irodoriHeaders, readWavSamples, trimAndNormalize } from './tts';

/**
 * 参照音声（声の固定）。
 * Voice Design は呼ぶたびに別の声が生まれるので、気に入った1本を参照音声として登録し、
 * 以降の全セリフをその声でクローン合成する。
 * 登録した音声は Irodori サーバーの voices と、このアプリの voices/（控え）の両方に置く。
 */

export type VoiceMeta = { id: string; label: string; caption?: string; text?: string; seed?: number; createdAt: number };

const AUDIO_EXT = new Set(['.wav', '.flac', '.mp3', '.m4a', '.ogg', '.opus', '.aac', '.webm']);

const candidateDir = () => path.join(os.tmpdir(), 'ad-studio-voice-candidates');
const isSafeId = (id: string) => /^[A-Za-z0-9_-]+$/.test(id);

const baseUrl = () => `${irodoriBase()}/v1`;

/** 候補を1本つくる。seed を変えると別の声になる。返す WAV は前後の無音を切って音量を揃えたもの */
export const createCandidate = async ({ caption, text, seed }: { caption: string; text: string; seed?: number }) => {
  const usedSeed = seed ?? crypto.randomInt(1, 2_000_000_000);
  let res: Response;
  try {
    res = await fetch(`${baseUrl()}/audio/speech`, {
      method: 'POST',
      headers: irodoriHeaders(true),
      body: JSON.stringify({
        model: config.tts.irodoriModel,
        input: text,
        voice: 'none',
        response_format: 'wav',
        irodori: { caption: caption || undefined, seed: usedSeed },
      }),
      signal: AbortSignal.timeout(600_000),
    });
  } catch {
    throw new Error(`Irodori TTS に接続できません（${baseUrl()}）。サーバーが起動しているか確認してください。`);
  }
  if (!res.ok) throw new Error(`Irodori TTS: HTTP ${res.status}`);
  const { samples, rate } = readWavSamples(Buffer.from(await res.arrayBuffer()));
  const wav = encodeWav(trimAndNormalize(samples, rate), rate);
  const id = `${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`;
  await fs.mkdir(candidateDir(), { recursive: true });
  await fs.writeFile(path.join(candidateDir(), `${id}.wav`), wav);
  void pruneCandidates();
  return { id, seed: usedSeed, durationSec: (wav.length - 44) / 2 / rate };
};

export const candidateFile = (id: string) => (isSafeId(id) ? path.join(candidateDir(), `${id}.wav`) : null);

/** 1日より古い候補を消す */
const pruneCandidates = async () => {
  const dir = candidateDir();
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, f);
    const st = await fs.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 24 * 3600_000) await fs.rm(p, { force: true });
  }
};

/** アプリに同梱の標準の声（標準キャラの既定の参照音声）。public/voices/ に置く */
export const BUILTIN_VOICES: { id: string; label: string; file: string }[] = [
  { id: 'hayami-saki', label: '速水さき（標準の声）', file: 'hayami-saki.wav' },
  { id: 'osushi-chan', label: 'おすしちゃん（標準の声）', file: 'osushi-chan.wav' },
];
const builtinFile = (id: string) => {
  const b = BUILTIN_VOICES.find((v) => v.id === id);
  return b ? path.join(config.publicDir, 'voices', b.file) : null;
};

const localFile = async (id: string) => {
  const builtin = builtinFile(id);
  if (builtin) return (await fs.stat(builtin).catch(() => null)) ? builtin : null;
  for (const f of await fs.readdir(config.voicesDir).catch(() => [] as string[])) {
    if (path.parse(f).name === id && AUDIO_EXT.has(path.extname(f).toLowerCase())) return path.join(config.voicesDir, f);
  }
  return null;
};

const uploadToServer = async (id: string, file: string) => {
  const data = await fs.readFile(file);
  const fd = new FormData();
  fd.append('file', new Blob([new Uint8Array(data)]), path.basename(file));
  fd.append('voice_id', id);
  let res = await fetch(`${baseUrl()}/audio/voices`, { method: 'POST', headers: irodoriHeaders(false), body: fd });
  if (res.status === 409) {
    const put = new FormData();
    put.append('file', new Blob([new Uint8Array(data)]), path.basename(file));
    res = await fetch(`${baseUrl()}/audio/voices/${id}`, { method: 'PUT', headers: irodoriHeaders(false), body: put });
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { detail?: string } | null;
    throw new Error(`参照音声の登録に失敗しました: ${body?.detail ?? `HTTP ${res.status}`}`);
  }
};

/**
 * 参照音声を登録する。IDは名前＋音声の内容ハッシュ。
 * 別の声に差し替えるとIDも変わるので、ナレーションの再生成対象（ハッシュ不一致）が自動で判定される。
 */
export const registerVoice = async ({
  name, label, audio, ext = '.wav', caption, text, seed,
}: { name: string; label?: string; audio: Buffer; ext?: string; caption?: string; text?: string; seed?: number }): Promise<VoiceMeta> => {
  ext = ext.toLowerCase();
  if (!AUDIO_EXT.has(ext)) throw new Error(`対応していない音声形式です（${[...AUDIO_EXT].join(' ')}）`);
  const slug = name.replace(/[^A-Za-z0-9_-]+/g, '').slice(0, 24) || 'voice';
  const id = `${slug}-${crypto.createHash('sha1').update(audio).digest('hex').slice(0, 6)}`;
  await fs.mkdir(config.voicesDir, { recursive: true });
  const file = path.join(config.voicesDir, `${id}${ext}`);
  await fs.writeFile(file, audio);
  const meta: VoiceMeta = { id, label: label?.trim() || id, caption, text, seed, createdAt: Date.now() };
  await fs.writeFile(path.join(config.voicesDir, `${id}.json`), JSON.stringify(meta, null, 2));
  await uploadToServer(id, file);
  const st = await fs.stat(file);
  ensured.set(id, `${st.size}:${st.mtimeMs}`);
  return meta;
};

export const localVoices = async (): Promise<VoiceMeta[]> => {
  const out: VoiceMeta[] = [];
  const builtins: VoiceMeta[] = [];
  for (const b of BUILTIN_VOICES) if (await localFile(b.id)) builtins.push({ id: b.id, label: b.label, createdAt: 0 });
  for (const f of await fs.readdir(config.voicesDir).catch(() => [] as string[])) {
    if (!f.endsWith('.json')) continue;
    const meta = JSON.parse(await fs.readFile(path.join(config.voicesDir, f), 'utf8').catch(() => 'null')) as VoiceMeta | null;
    if (meta?.id && (await localFile(meta.id))) out.push(meta);
  }
  return [...builtins, ...out.sort((a, b) => b.createdAt - a.createdAt)];
};

export const localVoiceFile = localFile;

export const deleteVoice = async (id: string) => {
  if (!isSafeId(id)) throw new Error('invalid voice id');
  if (builtinFile(id)) throw Object.assign(new Error('標準の声は削除できません'), { status: 400 });
  const file = await localFile(id);
  if (file) await fs.rm(file, { force: true });
  await fs.rm(path.join(config.voicesDir, `${id}.json`), { force: true });
  ensured.delete(id);
  await fetch(`${baseUrl()}/audio/voices/${id}`, { method: 'DELETE', headers: irodoriHeaders(false) }).catch(() => undefined);
};

/** 確認済みの声（id → このアプリ側のファイルの版）。ファイルを差し替えたら版が変わるので確認し直す */
const ensured = new Map<string, string>();

/**
 * 合成の前に、その声が Irodori サーバーにあるか確認し、無い・中身が違う時は控えから登録し直す。
 * 同じ名前のままファイルを差し替えた場合（標準の声の更新など）も、サーバー側を新しい音声にそろえる。force で確認済みの記憶を捨てる
 */
export const ensureVoice = async (id: string, force = false) => {
  if (id === 'none') return;
  const file = await localFile(id);
  const st = file ? await fs.stat(file).catch(() => null) : null;
  const version = st ? `${st.size}:${st.mtimeMs}` : 'remote';
  if (force) ensured.delete(id);
  if (ensured.get(id) === version) return;
  const res = await fetch(`${baseUrl()}/audio/voices/${id}`, { headers: irodoriHeaders(false), signal: AbortSignal.timeout(5000) }).catch(() => null);
  const meta = res?.ok ? ((await res.json().catch(() => null)) as { bytes?: number } | null) : null;
  // サーバーにあって、大きさもこのアプリの控えと同じならそのまま使う
  if (meta && (!st || meta.bytes === st.size)) {
    ensured.set(id, version);
    return;
  }
  if (!file) return; // サーバー側にだけ手置きした音声の場合は、そのまま合成を試みる
  await uploadToServer(id, file);
  ensured.set(id, version);
};
