import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { ELEVEN_STABILITY, elevenSettings, standardRefVoice, type VoiceWithLibrary } from '../../src/video/audioTags';
import { config } from '../env';
import { runFfmpeg } from '../ffmpeg';
import { encodeWav, readWavSamples } from './tts';
import { localVoiceFile, localVoices } from './voices';

/**
 * ElevenLabs（Eleven v3）の音声合成と声の管理。
 * - セリフの前のオーディオタグ（[excited] など）で、気持ち・話し方・笑い声やため息を乗せる
 * - 声は ElevenLabs の voice_id。キャラで声を選んでいなければ、標準の声（参照音声）をクローンした声を使う
 */

/** 送る文字の上限（Eleven v3 は1リクエスト 5,000 文字。セリフはずっと短い） */
const MAX_CHARS = 3000;
/** 生成した音声は 44.1kHz の mp3 で受け取り、WAV にしてから整える（全プランで使える形式） */
const OUTPUT_FORMAT = 'mp3_44100_128';
const RATE = 44100;

/** 声のデザイン（Voice Design）や自動作成で読む見本の文（100文字以上が必要） */
export const VOICE_SAMPLE_TEXT =
  'こんにちは。今日は新しいサービスについて、わかりやすくご紹介します。まずは画面を見てください。スマホひとつで、すぐに始められます。お客さまの声をもとに、使いやすさを大切にしてつくりました。ぜひ一度、気軽に試してみてくださいね。';

export const hasEleven = () => Boolean(config.eleven.apiKey);

type ElevenErr = Error & { status?: number; code?: string };

const friendly = (status: number, code: string | undefined, msg: string | undefined) => {
  if (code === 'quota_exceeded') return 'ElevenLabs の今月の文字数（クレジット）を使い切りました。プランの残りを確認してください';
  if (code === 'voice_limit_reached') return 'ElevenLabs に登録できる声の数が上限です。ElevenLabs の「My Voices」で使わない声を削除してください';
  if (code === 'can_not_use_instant_voice_cloning' || /instant voice clon/i.test(msg ?? '')) return 'いまの ElevenLabs のプランでは、手持ちの音声から声を作れません（Starter 以上のプランが必要です）';
  if (code === 'missing_permissions') return `ElevenLabs の API キーに必要な権限がありません（Text to Speech と Voices を許可してください）${msg ? `: ${msg}` : ''}`;
  if (status === 401) return 'ElevenLabs の API キーが正しくありません（.env の ELEVENLABS_API_KEY を確認してください）';
  if (code === 'voice_not_found' || status === 404) return 'ElevenLabs に声が見つかりません（削除された可能性があります）。キャストの「声を選ぶ…」で選び直してください';
  if (status === 429) return 'ElevenLabs が混み合っています（同時に作れる数の上限）。少し待ってからやり直してください';
  return `ElevenLabs がエラーを返しました（${status}${code ? ` ${code}` : ''}）${msg ? `: ${msg}` : ''}`;
};

const toError = async (res: Response): Promise<ElevenErr> => {
  const body = (await res.json().catch(() => null)) as { detail?: { status?: string; code?: string; message?: string } | string } | null;
  const d = body?.detail;
  const code = typeof d === 'object' && d ? d.code ?? d.status : undefined;
  const msg = typeof d === 'string' ? d : d?.message;
  return Object.assign(new Error(friendly(res.status, code, msg)), { status: res.status, code, detail: msg });
};

/** ElevenLabs の API を呼ぶ。混雑（429）は少し待って最大3回やり直す */
const call = async (pathname: string, init: RequestInit = {}, timeoutMs = 120_000): Promise<Response> => {
  if (!hasEleven()) throw new Error('ElevenLabs の API キーが未設定です（.env に ELEVENLABS_API_KEY を設定して、サーバーを再起動してください）');
  const isForm = init.body instanceof FormData;
  for (let attempt = 0; ; attempt++) {
    let res: Response;
    try {
      res = await fetch(`${config.eleven.baseUrl}${pathname}`, {
        ...init,
        headers: { 'xi-api-key': config.eleven.apiKey, ...(init.body && !isForm ? { 'Content-Type': 'application/json' } : {}), ...(init.headers as Record<string, string>) },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (e) {
      throw new Error(`ElevenLabs に接続できません: ${(e as Error).message}`);
    }
    if (res.ok) return res;
    if (res.status === 429 && attempt < 3) {
      await new Promise((r) => setTimeout(r, 2000 * 2 ** attempt));
      continue;
    }
    throw await toError(res);
  }
};

/* ---------------- 状態 ---------------- */

export type ElevenStatus = {
  configured: boolean;
  online: boolean;
  model: string;
  error?: string;
  /** 今月の文字数（クレジット） */
  quota?: { used: number; limit: number; resetAt?: number; tier?: string };
  canClone?: boolean;
};

let statusCache: { at: number; value: ElevenStatus } | null = null;

/** エディターに出す接続状態（1分キャッシュ）。refresh=true で取り直す */
export const elevenStatus = async (refresh = false): Promise<ElevenStatus> => {
  const model = config.eleven.model;
  if (!hasEleven()) return { configured: false, online: false, model, error: '.env に ELEVENLABS_API_KEY が設定されていません' };
  if (!refresh && statusCache && Date.now() - statusCache.at < 60_000) return statusCache.value;
  let value: ElevenStatus;
  try {
    const s = (await (await call('/v1/user/subscription', {}, 8000)).json()) as {
      character_count?: number;
      character_limit?: number;
      next_character_count_reset_unix?: number;
      tier?: string;
      can_use_instant_voice_cloning?: boolean;
    };
    value = {
      configured: true,
      online: true,
      model,
      quota: s.character_limit ? { used: s.character_count ?? 0, limit: s.character_limit, resetAt: s.next_character_count_reset_unix, tier: s.tier } : undefined,
      canClone: s.can_use_instant_voice_cloning,
    };
  } catch (e) {
    const err = e as ElevenErr;
    // 読み取り権限の無いキーでも、音声は作れることがある
    value = err.code === 'missing_permissions' ? { configured: true, online: true, model } : { configured: true, online: false, model, error: err.message };
  }
  statusCache = { at: Date.now(), value };
  return value;
};

/* ---------------- 音声合成 ---------------- */

/** Eleven v4 は speed を受け付けないので、話速は生成後に伸縮する */
const nativeSpeedModel = (model: string) => !/^eleven_v4/.test(model);

const tmpFile = (ext: string) => path.join(os.tmpdir(), `eleven-${crypto.randomUUID()}${ext}`);

/** mp3 → モノラルの Float32（tempo≠1 なら音程を変えずに速さだけ変える） */
const decode = async (audio: Buffer, tempo = 1, ext = '.mp3') => {
  const src = tmpFile(ext);
  const out = tmpFile('.wav');
  await fs.writeFile(src, audio);
  try {
    const filter = Math.abs(tempo - 1) >= 0.01 ? ['-filter:a', `atempo=${Math.min(2, Math.max(0.5, tempo)).toFixed(3)}`] : [];
    await runFfmpeg(['-i', src, ...filter, '-ac', '1', '-ar', String(RATE), '-c:a', 'pcm_s16le', out]);
    return readWavSamples(await fs.readFile(out));
  } finally {
    await fs.rm(src, { force: true });
    await fs.rm(out, { force: true });
  }
};

type Stability = keyof typeof ELEVEN_STABILITY;

/** 速さだけを変える（音程はそのまま）。全体を1回で読んだ音声を、キャラごとの速さに合わせるのに使う */
const stretch = async (samples: Float32Array, rate: number, tempo: number) => {
  if (Math.abs(tempo - 1) < 0.01) return { samples, rate };
  return decode(encodeWav(samples, rate), tempo, '.wav');
};

/** 言語の指定・自動で用意した声が原因の失敗は、1回だけ条件を変えてやり直す */
const withRetries = async <T>(voices: VoiceWithLibrary[], run: (withLanguage: boolean) => Promise<T>): Promise<T> => {
  try {
    return await run(true);
  } catch (err) {
    const x = err as ElevenErr & { detail?: string };
    // このモデルが言語の指定を受け付けない時は、指定なしでやり直す
    if (x.status === 400 && /language/i.test(x.detail ?? x.message)) return run(false);
    // 自動で用意した声が ElevenLabs 側で消されていたら、作り直して1回だけやり直す
    const auto = voices.filter((v) => !v.eleven?.voiceId);
    if ((x.status === 404 || x.code === 'voice_not_found') && auto.length) {
      for (const v of auto) await forgetAutoVoice(v);
      return run(true);
    }
    throw err;
  }
};

/**
 * セリフを1つ読み上げる（試聴・1セリフだけの作り直しの予備）。text には先頭のタグ（[excited] など）を含めて渡す。
 * 話速は 0.7〜1.2 の範囲は ElevenLabs 側で、はみ出した分は生成後に伸縮する
 */
export const synthEleven = async (text: string, voice: VoiceWithLibrary, opts: { seed?: number; stability?: Stability } = {}) => {
  const e = elevenSettings(voice);
  const model = config.eleven.model;
  const native = nativeSpeedModel(model) ? Math.min(1.2, Math.max(0.7, e.speed)) : 1;
  const voiceSettings: Record<string, unknown> = { stability: ELEVEN_STABILITY[opts.stability ?? 'natural'].value, similarity_boost: 0.75, use_speaker_boost: true };
  if (native !== 1) voiceSettings.speed = native;
  const mp3 = await withRetries([voice], async (withLanguage) => {
    const voiceId = await resolveElevenVoice(voice);
    const body: Record<string, unknown> = { text: text.slice(0, MAX_CHARS), model_id: model, voice_settings: voiceSettings };
    if (withLanguage && config.eleven.language) body.language_code = config.eleven.language;
    if (opts.seed != null) body.seed = opts.seed >>> 0;
    const res = await call(`/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=${OUTPUT_FORMAT}`, { method: 'POST', body: JSON.stringify(body) });
    return Buffer.from(await res.arrayBuffer());
  });
  return decode(mp3, e.speed / native);
};

/** 1回の読み上げ（Text to Dialogue）に入れる文字数の上限（ElevenLabs の目安は 2,000 文字） */
export const DIALOGUE_MAX_CHARS = 1800;
export const DIALOGUE_MAX_VOICES = 10;

export type DialogueInput = { text: string; voice: VoiceWithLibrary };

/**
 * 複数のセリフを、1回の読み上げ（Text to Dialogue）で作り、セリフごとに切り分けて返す。
 * セリフを1つずつ作ると、短い文ほど声が揺れて、シーンによって別の人のように聞こえることがある。
 * 台本をまとめて読ませると、同じキャラは同じ声のまま、掛け合いの間や抑揚も自然につながる。
 * previousText / futureText は前後の文（読まないが、つながりの手がかりにする）
 */
export const synthElevenDialogue = async (
  inputs: DialogueInput[],
  opts: { stability?: Stability; previousText?: string; futureText?: string } = {},
): Promise<{ samples: Float32Array; rate: number }[]> => {
  if (!inputs.length) return [];
  const r = await withRetries(
    inputs.map((x) => x.voice),
    async (withLanguage) => {
      const ids: string[] = [];
      // 同じ声を同時に作らないよう、1つずつ解決する（2回目からは覚えた声を使う）
      for (const x of inputs) ids.push(await resolveElevenVoice(x.voice));
      const body: Record<string, unknown> = {
        inputs: inputs.map((x, i) => ({ text: x.text, voice_id: ids[i] })),
        model_id: config.eleven.model,
        settings: { stability: ELEVEN_STABILITY[opts.stability ?? 'natural'].value },
      };
      if (withLanguage && config.eleven.language) body.language_code = config.eleven.language;
      if (opts.previousText) body.previous_text = opts.previousText;
      if (opts.futureText) body.future_text = opts.futureText;
      const res = await call(`/v1/text-to-dialogue/with-timestamps?output_format=${OUTPUT_FORMAT}`, { method: 'POST', body: JSON.stringify(body) }, 300_000);
      return (await res.json()) as {
        audio_base64?: string;
        voice_segments?: { start_time_seconds: number; end_time_seconds: number; dialogue_input_index: number }[];
      };
    },
  );
  if (!r.audio_base64) throw new Error('ElevenLabs から音声が返ってきませんでした');
  const whole = await decode(Buffer.from(r.audio_base64, 'base64'));
  // セリフ（dialogue_input_index）ごとの範囲。1つのセリフが複数の区間に分かれることもあるので、まとめる
  const spans = new Map<number, { start: number; end: number }>();
  for (const seg of r.voice_segments ?? []) {
    const cur = spans.get(seg.dialogue_input_index);
    spans.set(seg.dialogue_input_index, cur ? { start: Math.min(cur.start, seg.start_time_seconds), end: Math.max(cur.end, seg.end_time_seconds) } : { start: seg.start_time_seconds, end: seg.end_time_seconds });
  }
  if (inputs.some((_, i) => !spans.has(i))) throw Object.assign(new Error('ElevenLabs の読み上げを、セリフごとに切り分けられませんでした'), { status: 422 });
  const order = inputs.map((_, i) => i).sort((a, b) => spans.get(a)!.start - spans.get(b)!.start);
  const total = whole.samples.length / whole.rate;
  const out: { samples: Float32Array; rate: number }[] = new Array(inputs.length);
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    const sp = spans.get(i)!;
    const prevEnd = k > 0 ? spans.get(order[k - 1])!.end : 0;
    const nextStart = k < order.length - 1 ? spans.get(order[k + 1])!.start : total;
    // 少しだけ余白を付けて切る（前後のセリフの声が入らない範囲で）。無音は後で整える
    const a = Math.max(prevEnd, sp.start - 0.04);
    const b = Math.min(nextStart, sp.end + 0.12, total);
    const slice = whole.samples.slice(Math.floor(a * whole.rate), Math.max(Math.floor(a * whole.rate) + 1, Math.floor(b * whole.rate)));
    // ElevenLabs の話速の設定は1回の読み上げ全体にしか効かないので、キャラごとの速さは切り分けたあとで合わせる
    out[i] = await stretch(slice, whole.rate, elevenSettings(inputs[i].voice).speed);
  }
  return out;
};

/* ---------------- 声の解決（選んでいない時の自動の声） ---------------- */

type AutoVoice = { voiceId: string; label: string; createdAt: number };
const cacheFile = () => path.join(config.voicesDir, 'elevenlabs.json');
const readCache = async (): Promise<Record<string, AutoVoice>> => JSON.parse(await fs.readFile(cacheFile(), 'utf8').catch(() => '{}'));
const writeCache = async (c: Record<string, AutoVoice>) => {
  await fs.mkdir(config.voicesDir, { recursive: true });
  await fs.writeFile(cacheFile(), JSON.stringify(c, null, 2));
};
const sha = (b: Buffer | string) => crypto.createHash('sha1').update(b).digest('hex').slice(0, 10);

const designDescription = (voice: VoiceWithLibrary) => (voice.caption || voice.instructions || '').trim() || '明るく聞き取りやすい日本人の声';

/** 自動の声のキャッシュのキー（参照音声は中身、声のイメージは文から） */
const autoKey = async (voice: VoiceWithLibrary) => {
  const ref = standardRefVoice(voice);
  if (ref) {
    const file = await localVoiceFile(ref);
    if (file) return { key: `ref:${ref}:${sha(await fs.readFile(file))}`, file, ref };
  }
  return { key: `design:${sha(designDescription(voice))}`, file: null, ref: undefined };
};

const inflight = new Map<string, Promise<string>>();

/**
 * 合成に使う voice_id。
 * 1) キャストで選んだ声 2) 参照音声（標準の声など）をクローンした声 3) 声のイメージから作った声
 * 2・3 は初回だけ ElevenLabs に作り、以後は voices/elevenlabs.json に覚えておく
 */
export const resolveElevenVoice = async (voice: VoiceWithLibrary): Promise<string> => {
  if (voice.eleven?.voiceId) return voice.eleven.voiceId;
  const { key, file, ref } = await autoKey(voice);
  const cached = (await readCache())[key];
  if (cached) return cached.voiceId;
  // 並行して作らない（同じキャラのセリフが同時に来ても1回だけ作る）
  if (!inflight.has(key)) {
    inflight.set(
      key,
      (async () => {
        let made: { voiceId: string; label: string } | null = null;
        if (file && ref) {
          const label = (await localVoices()).find((v) => v.id === ref)?.label ?? ref;
          try {
            made = { voiceId: await cloneVoice({ name: `${label}（Ad Studio）`, audio: await fs.readFile(file), filename: path.basename(file), description: 'Ad Studio の標準の声' }), label };
          } catch (e) {
            // クローンできないプランでは、声のイメージから作る
            console.warn(`[elevenlabs] ${ref} をクローンできませんでした: ${(e as Error).message}`);
          }
        }
        if (!made) {
          const description = designDescription(voice);
          const previews = await designVoice({ description, seed: parseInt(sha(description).slice(0, 7), 16) });
          if (!previews.length) throw new Error('ElevenLabs で声を作れませんでした');
          const label = `${description.slice(0, 24)}（Ad Studio）`;
          made = { voiceId: await adoptDesignedVoice({ generatedVoiceId: previews[0].generatedVoiceId, name: label, description }), label };
        }
        const c = await readCache();
        c[key] = { ...made, createdAt: Date.now() };
        await writeCache(c);
        return made.voiceId;
      })().finally(() => inflight.delete(key)),
    );
  }
  return inflight.get(key)!;
};

const forgetAutoVoice = async (voice: VoiceWithLibrary) => {
  const { key } = await autoKey(voice);
  const c = await readCache();
  delete c[key];
  await writeCache(c);
};

/* ---------------- 声の管理（エディターの「声を選ぶ」） ---------------- */

export type ElevenVoice = {
  id: string;
  name: string;
  description?: string;
  previewUrl?: string;
  /** 共有ライブラリの声（使う前に自分の声に追加する） */
  publicOwnerId?: string;
  tags: string[];
};

/** 自分の声（My Voices） */
export const myVoices = async (search = ''): Promise<ElevenVoice[]> => {
  const q = new URLSearchParams({ page_size: '100', ...(search ? { search } : {}) });
  const r = (await (await call(`/v2/voices?${q}`, {}, 15000)).json()) as {
    voices?: { voice_id: string; name: string; description?: string; preview_url?: string; category?: string; labels?: Record<string, string> }[];
  };
  return (r.voices ?? []).map((v) => ({
    id: v.voice_id,
    name: v.name,
    description: v.description ?? undefined,
    previewUrl: v.preview_url ?? undefined,
    tags: [v.category, ...Object.values(v.labels ?? {})].filter((x): x is string => Boolean(x)).slice(0, 4),
  }));
};

/** 共有ライブラリの日本語の声 */
export const libraryVoices = async ({ search = '', gender = '' }: { search?: string; gender?: string } = {}): Promise<ElevenVoice[]> => {
  const q = new URLSearchParams({ page_size: '40', language: 'ja', ...(search ? { search } : {}), ...(gender ? { gender } : {}) });
  const r = (await (await call(`/v1/shared-voices?${q}`, {}, 15000)).json()) as {
    voices?: { voice_id: string; public_owner_id: string; name: string; description?: string; preview_url?: string; gender?: string; age?: string; accent?: string; use_case?: string; descriptive?: string }[];
  };
  const ja: Record<string, string> = { female: '女性', male: '男性', young: '若い', middle_aged: '中年', old: '年配', neutral: '中性' };
  return (r.voices ?? []).map((v) => ({
    id: v.voice_id,
    publicOwnerId: v.public_owner_id,
    name: v.name,
    description: v.description ?? undefined,
    previewUrl: v.preview_url ?? undefined,
    tags: [v.gender, v.age, v.descriptive, v.use_case].filter((x): x is string => Boolean(x)).map((x) => ja[x] ?? x.replace(/_/g, ' ')).slice(0, 4),
  }));
};

/** 共有ライブラリの声を自分の声に追加して、使える voice_id を返す */
export const addLibraryVoice = async ({ publicOwnerId, voiceId, name }: { publicOwnerId: string; voiceId: string; name: string }) => {
  try {
    const r = (await (await call(`/v1/voices/add/${encodeURIComponent(publicOwnerId)}/${encodeURIComponent(voiceId)}`, { method: 'POST', body: JSON.stringify({ new_name: name.slice(0, 80) || 'voice' }) })).json()) as { voice_id: string };
    return r.voice_id;
  } catch (e) {
    // すでに追加済みなら、自分の声から同じ名前を探して使う
    const mine = await myVoices(name).catch(() => []);
    const hit = mine.find((v) => v.name === name) ?? mine.find((v) => v.id === voiceId);
    if (hit) return hit.id;
    throw e;
  }
};

/** 手持ちの音声から声を作る（Instant Voice Cloning） */
export const cloneVoice = async ({ name, audio, filename, description }: { name: string; audio: Buffer; filename: string; description?: string }) => {
  const fd = new FormData();
  fd.append('name', name.slice(0, 80) || 'voice');
  fd.append('files', new Blob([new Uint8Array(audio)]), filename);
  if (description) fd.append('description', description);
  fd.append('remove_background_noise', 'false');
  const r = (await (await call('/v1/voices/add', { method: 'POST', body: fd }, 180_000)).json()) as { voice_id: string };
  return r.voice_id;
};

const previewDir = () => path.join(os.tmpdir(), 'ad-studio-eleven-previews');
const isSafeId = (id: string) => /^[A-Za-z0-9_-]{4,64}$/.test(id);
export const designPreviewFile = (id: string) => (isSafeId(id) ? path.join(previewDir(), `${id}.mp3`) : null);

/** 声のイメージ（文章）から声の候補を作る（Voice Design）。候補の試し読みは一時ファイルに置く */
export const designVoice = async ({ description, text, seed }: { description: string; text?: string; seed?: number }) => {
  let sample = (text ?? '').trim();
  // 試し読みの文は100文字以上が必要。短い時は見本の文を足す
  if (sample.length < 100) sample = `${sample}${sample ? ' ' : ''}${VOICE_SAMPLE_TEXT}`.slice(0, 1000);
  const body: Record<string, unknown> = {
    // 日本語の声になるよう、英語でも念を押す
    voice_description: `${description.trim()}\nA native Japanese speaker who speaks natural, clear standard Japanese.`.slice(0, 1000),
    model_id: config.eleven.designModel,
    text: sample.slice(0, 1000),
  };
  if (seed != null) body.seed = seed >>> 0;
  const r = (await (await call(`/v1/text-to-voice/design?output_format=${OUTPUT_FORMAT}`, { method: 'POST', body: JSON.stringify(body) }, 180_000)).json()) as {
    previews?: { audio_base_64: string; generated_voice_id: string; duration_secs?: number }[];
  };
  await fs.mkdir(previewDir(), { recursive: true });
  void prunePreviews();
  const out: { generatedVoiceId: string; durationSec: number }[] = [];
  for (const p of r.previews ?? []) {
    const file = designPreviewFile(p.generated_voice_id);
    if (!file) continue;
    await fs.writeFile(file, Buffer.from(p.audio_base_64, 'base64'));
    out.push({ generatedVoiceId: p.generated_voice_id, durationSec: p.duration_secs ?? 0 });
  }
  return out;
};

/** 気に入った候補を、自分の声として保存する */
export const adoptDesignedVoice = async ({ generatedVoiceId, name, description }: { generatedVoiceId: string; name: string; description: string }) => {
  const r = (await (
    await call('/v1/text-to-voice', {
      method: 'POST',
      body: JSON.stringify({ voice_name: name.slice(0, 80) || 'voice', voice_description: description.slice(0, 1000) || name, generated_voice_id: generatedVoiceId }),
    })
  ).json()) as { voice_id: string };
  return r.voice_id;
};

/** 1日より古い候補を消す */
const prunePreviews = async () => {
  const dir = previewDir();
  for (const f of await fs.readdir(dir).catch(() => [] as string[])) {
    const p = path.join(dir, f);
    const st = await fs.stat(p).catch(() => null);
    if (st && Date.now() - st.mtimeMs > 24 * 3600_000) await fs.rm(p, { force: true });
  }
};
