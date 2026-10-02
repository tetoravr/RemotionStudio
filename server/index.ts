import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { BACKGROUNDS, FORMATS, ICON_NAMES, POSES, Project, TRANSITIONS } from '../src/video/schema';
import { blankProject, DEFAULT_CAST } from '../src/video/templates';
import { LIBRARY_CHARACTERS } from '../src/video/library';
import { STYLE_PRESETS } from './ai/images';
import { attachScreenshots, generateStoryboard, reviseStoryboard, type Brief, type ScreenshotRef } from './ai/storyboard';
import { resolveMedia } from './ai/media';
import { draftBrief } from './ai/sources';
import { loadUiLibrary } from './ai/uiLibrary';
import { candidateFile, createCandidate, deleteVoice, localVoiceFile, localVoices, registerVoice } from './ai/voices';
import { engineId, irodoriStatus, OPENAI_VOICES, resolveProvider, synthesizeToFile } from './ai/tts';
import {
  addLibraryVoice, adoptDesignedVoice, cloneVoice, designPreviewFile, designVoice, elevenStatus, libraryVoices, myVoices,
} from './ai/elevenlabs';
import { normalizeTag, stripAudioTags, withAudioTags } from '../src/video/audioTags';
import { generateCharacter, type CharacterRequest } from './characters';
import { config, hasOpenAI, ROOT } from './env';
import { conflictFor, getJob, runningJobs, startJob } from './jobs';
import { generateNarration, staleLines } from './narration';
import {
  deleteProject, duplicateProject, emptyTrash, listProjects, loadProject, newProjectId, projectDir, saveAsset, saveProject, seedSamples,
} from './projects';
import { renderProject, withFileServer } from './render';
import { authEnabled, authProblems, authRouter, currentUser, requireLogin } from './auth';

const app = express();
// リバースプロキシ（Cloudflare Tunnel・ロードバランサ等）の内側で動かす時に、https やクライアントIPを正しく扱う
app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  // ログインが要る中身は、前段の CDN（ポータルからのリライト経由など）に残さない
  if (/^\/files\/[^/]+\/audio\//.test(req.path))
    // セリフの音声は作るたびに別の名前になり、中身は変わらない。ブラウザに残して、再生のたびに読み込み直さない
    res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');
  else if (/^\/(api|auth|files)\//.test(req.path)) res.setHeader('Cache-Control', 'private, no-store');
  next();
});
app.use(authRouter());
// ここから下は、ログインが必要（Google ログインを設定した時だけ有効）
app.use(requireLogin);
app.use(express.json({ limit: '10mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, key: string) => String(req.params[key]);

// ---------- メタ情報 ----------
app.get('/api/meta', async (req, res) => {
  const provider = resolveProvider('auto');
  // 使っていないエンジンの状態は調べない（つながらない相手を毎回待たないように）
  const [irodori, elevenlabs] = await Promise.all([
    provider === 'irodori' ? irodoriStatus() : Promise.resolve({ online: false, url: '', voices: [] as string[] }),
    elevenStatus(req.query.refresh === '1'),
  ]);
  res.json({
    openai: hasOpenAI(),
    models: config.models,
    tts: {
      /** 環境設定（TTS_PROVIDER）で解決した既定のエンジン */
      default: provider,
      engines: { elevenlabs: engineId('elevenlabs'), openai: engineId('openai'), irodori: engineId('irodori') },
      irodori,
      elevenlabs,
    },
    voices: OPENAI_VOICES,
    icons: ICON_NAMES,
    poses: POSES,
    formats: FORMATS,
    backgrounds: BACKGROUNDS,
    transitions: TRANSITIONS,
    styles: Object.keys(STYLE_PRESETS),
    library: Object.entries(LIBRARY_CHARACTERS).map(([id, c]) => ({ id, name: c.name, kind: c.kind })),
  });
});

// ---------- プロジェクト ----------
app.get('/api/projects', h(async (_req, res) => res.json(await listProjects())));

app.post(
  '/api/projects',
  h(async (req, res) => {
    const { title = '新しい動画', brandName = 'ブランド名', format = 'vertical' } = req.body ?? {};
    const id = newProjectId(title);
    res.json(await saveProject(blankProject({ id, title, brandName, format })));
  }),
);

app.get('/api/projects/:id', h(async (req, res) => res.json(await loadProject(param(req, 'id')))));

app.put(
  '/api/projects/:id',
  h(async (req, res) => {
    const id = param(req, 'id');
    const parsed = Project.safeParse({ ...req.body, id });
    if (!parsed.success) {
      res.status(400).json({ error: 'プロジェクトの形式が正しくありません', issues: parsed.error.issues.slice(0, 5) });
      return;
    }
    // 誰が最後に編集したか（ログイン時のみ）
    const user = currentUser(req);
    res.json(await saveProject({ ...parsed.data, updatedBy: user?.email ?? parsed.data.updatedBy }));
  }),
);

app.delete(
  '/api/projects/:id',
  h(async (req, res) => {
    const id = param(req, 'id');
    if (runningJobs(id).length) {
      res.status(409).json({ error: 'このプロジェクトは処理中です（音声生成・書き出しなど）。終わってから削除してください' });
      return;
    }
    await deleteProject(id);
    res.json({ ok: true });
  }),
);

app.post('/api/projects/:id/duplicate', h(async (req, res) => res.json(await duplicateProject(param(req, 'id')))));

app.post(
  '/api/projects/:id/upload',
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルがありません' });
      return;
    }
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const saved = await saveAsset(param(req, 'id'), name, req.file.buffer);
    res.json({ path: saved, size: await imageSize(req.file.buffer) });
  }),
);

app.get('/api/projects/:id/renders', h(async (req, res) => {
  const dir = path.join(projectDir(param(req, 'id')), 'renders');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
  res.json(
    files
      .map((f) => ({ name: f, url: `${config.basePath}/files/${param(req, 'id')}/renders/${f}`, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at),
  );
}));

// ---------- 新規作成前のスクリーンショット預かり ----------
const stagingDir = () => path.join(config.projectsDir, '.staging');
const imageSize = async (buf: Buffer) => {
  try {
    const m = await sharp(buf).metadata();
    // EXIF の回転を考慮
    const rotated = (m.orientation ?? 1) >= 5;
    return m.width && m.height ? { w: rotated ? m.height : m.width, h: rotated ? m.width : m.height } : undefined;
  } catch {
    return undefined;
  }
};

app.post(
  '/api/staging/upload',
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルがありません' });
      return;
    }
    fs.mkdirSync(stagingDir(), { recursive: true });
    const name = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const staged = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}${path.extname(name).toLowerCase().replace(/[^.a-z0-9]/g, '') || '.png'}`;
    fs.writeFileSync(path.join(stagingDir(), staged), req.file.buffer);
    res.json({ staged, name, size: await imageSize(req.file.buffer) });
  }),
);

/** 預かったスクリーンショットをプロジェクトの assets に移す */
const adoptStaged = async (projectId: string, staged: string): Promise<ScreenshotRef> => {
  if (!/^[a-z0-9.-]+$/i.test(staged)) throw new Error('invalid staged file');
  const file = path.join(stagingDir(), staged);
  const buf = fs.readFileSync(file);
  const rel = await saveAsset(projectId, staged, buf);
  fs.rmSync(file, { force: true });
  return { path: rel, size: await imageSize(buf) };
};

// ---------- AI ----------
app.post(
  '/api/ai/storyboard',
  h(async (req, res) => {
    const { brief, format = 'vertical', colors, screenshots = [] } = req.body as {
      brief: Brief;
      format?: Project['format'];
      colors?: Project['brand']['colors'];
      /** /api/staging/upload で預けた実スクリーンショット */
      screenshots?: { staged: string; name?: string }[];
    };
    if (!brief?.productName || !brief?.oneLiner) {
      res.status(400).json({ error: '商品名と「ひとことで」は必須です' });
      return;
    }
    const job = startJob('storyboard', undefined, async (ctx) => {
      ctx.progress(0.1, 'AIが台本を書いています（30〜60秒）');
      const cast = DEFAULT_CAST.map((c) => structuredClone(c));
      // 製品のUI画面集（SUSHI UI フォルダなど）を読み込み、台本AIに選ばせる
      const uiLib = await loadUiLibrary().catch(() => []);
      const { ai, scenes: rawScenes } = await generateStoryboard(brief, cast, format, screenshots.map((s) => s.name || s.staged), uiLib);
      const id = newProjectId(brief.productName);
      const shots: ScreenshotRef[] = [];
      for (const sh of screenshots) shots.push(await adoptStaged(id, sh.staged));
      const scenes = attachScreenshots(rawScenes, shots);
      const project = await saveProject({
        id,
        title: ai.title || `${brief.productName} 広告`,
        format,
        fps: 30,
        brand: {
          name: brief.productName,
          tagline: ai.tagline,
          colors: colors ?? {
            primary: ai.palette?.primary ?? '#1f5cff',
            dark: ai.palette?.dark ?? '#0d1b5e',
            accent: ai.palette?.accent ?? '#ffd93b',
            light: ai.palette?.light ?? '#eaf0ff',
            text: ai.palette?.dark ?? '#15172b',
          },
          font: 'noto',
        },
        cast,
        scenes,
        brief,
      });
      // 製品画面の取り込みと、図解・イラストの生成（失敗しても台本はそのまま使える）
      await resolveMedia(project, (n, d) => saveAsset(project.id, n, d), { onProgress: (p, m) => ctx.progress(0.5 + p * 0.5, m) }).catch(() => null);
      await saveProject(project);
      return { projectId: project.id };
    });
    res.json({ jobId: job.id });
  }),
);

/** URL・資料から、ブリーフ（商品情報）の下書きを作る。ウィザードの入力欄を埋めるのに使う */
app.post(
  '/api/ai/brief-from-sources',
  upload.array('files', 10),
  h(async (req, res) => {
    const urls = String(req.body?.urls ?? '')
      .split(/[\s,]+/)
      .map((s) => s.trim())
      .filter((s) => /^https?:\/\//i.test(s));
    const files = ((req.files as Express.Multer.File[] | undefined) ?? []).map((f) => ({
      name: Buffer.from(f.originalname, 'latin1').toString('utf8'),
      data: f.buffer,
    }));
    if (!urls.length && !files.length) {
      res.status(400).json({ error: 'URLか資料ファイルを指定してください' });
      return;
    }
    const job = startJob('brief', undefined, (ctx) => draftBrief({ urls, files, hint: String(req.body?.hint ?? '') }, (p, m) => ctx.progress(p, m)));
    res.json({ jobId: job.id });
  }),
);

/** 改稿後も、同じセリフ（話者・文言が同じ）の音声は使い回す */
const carryOverAudio = (before: Project, after: Project) => {
  const map = new Map<string, NonNullable<Project['scenes'][number]['lines'][number]['audio']>>();
  for (const s of before.scenes) for (const l of s.lines) if (l.audio) map.set(`${l.speaker}|${l.speak || l.text}`, l.audio);
  for (const s of after.scenes) for (const l of s.lines) l.audio = map.get(`${l.speaker}|${l.speak || l.text}`);
};

/** AI改稿後も、画面紹介シーンには元のスクリーンショットを順番に割り当て直す（足りなければそのシーンは外す） */
/** 改稿後も、同じ内容のイラストは描き直さない（課題の図解はラベルが同じなら、特徴のイラストは指示文が同じなら使い回す） */
const keepIllustrations = (before: Project, after: Project) => {
  const props = new Map<string, string>();
  const feats = new Map<string, string>();
  for (const s of before.scenes) {
    if (s.type === 'talk' && s.prop?.image) props.set(`${s.prop.label ?? ''}|${s.headline ?? ''}`, s.prop.image);
    if (s.type === 'feature' && s.visual.kind === 'image' && s.visual.src && s.visual.prompt) feats.set(s.visual.prompt, s.visual.src);
  }
  for (const s of after.scenes) {
    if (s.type === 'talk' && s.prop && !s.prop.image) s.prop.image = props.get(`${s.prop.label ?? ''}|${s.headline ?? ''}`);
    if (s.type === 'feature' && s.visual.kind === 'image' && !s.visual.src && s.visual.prompt) s.visual.src = feats.get(s.visual.prompt) ?? '';
  }
};

const keepScreenshots = (before: Project, scenes: Project['scenes']) => {
  const shots = before.scenes.flatMap((s) => (s.type === 'showcase' && s.screenshot ? [{ path: s.screenshot, size: s.screenshotSize }] : []));
  return attachScreenshots(scenes, shots);
};

app.post(
  '/api/projects/:id/ai/revise',
  h(async (req, res) => {
    const id = param(req, 'id');
    const instruction = String(req.body?.instruction ?? '').trim();
    if (!instruction) {
      res.status(400).json({ error: '修正指示を入力してください' });
      return;
    }
    const busy = conflictFor(id, 'revise');
    if (busy) {
      res.status(409).json({ error: busy });
      return;
    }
    const job = startJob('revise', id, async (ctx) => {
      ctx.progress(0.1, 'AIが台本を修正しています');
      const project = await loadProject(id);
      const { ai, scenes } = await reviseStoryboard(project, instruction, await loadUiLibrary().catch(() => []));
      const next: Project = { ...project, title: ai.title || project.title, brand: { ...project.brand, tagline: ai.tagline || project.brand.tagline }, scenes };
      carryOverAudio(project, next);
      next.scenes = keepScreenshots(project, next.scenes);
      keepIllustrations(project, next);
      await resolveMedia(next, (n, d) => saveAsset(id, n, d), { onProgress: (p, m) => ctx.progress(0.5 + p * 0.5, m) }).catch(() => null);
      await saveProject(next);
      return { projectId: id };
    });
    res.json({ jobId: job.id });
  }),
);

app.post(
  '/api/projects/:id/narration',
  h(async (req, res) => {
    const id = param(req, 'id');
    // lineIds を指定すると、そのセリフだけを作り直す（force:false なら、音声が古いものだけ。エディターの自動の作り直し）
    const only = Array.isArray(req.body?.lineIds) ? (req.body.lineIds as unknown[]).map(String) : undefined;
    const force = req.body?.force !== undefined ? Boolean(req.body.force) : Boolean(only);
    const busy = conflictFor(id, 'narration');
    if (busy) {
      res.status(409).json({ error: busy });
      return;
    }
    const job = startJob('narration', id, async (ctx) => {
      const project = await loadProject(id);
      const todo = staleLines(project, force, only).length;
      if (!todo) return { generated: 0, audio: {} };
      const before = new Map(project.scenes.flatMap((s) => s.lines.map((l) => [l.id, l.audio?.src] as const)));
      // 一部のセリフが失敗しても（文字数の上限など）、できた分の音声は残す（作り直しでクレジットを無駄にしない）
      let failure: unknown = null;
      try {
        await generateNarration(project, projectDir(id), {
          force,
          only,
          onProgress: (d, t, m) => ctx.progress(t ? d / t : 1, `ナレーション生成 ${d}/${t} ${m}`),
        });
      } catch (e) {
        failure = e;
      }
      // 生成中にエディタで編集された内容を壊さないよう、最新を読み直して音声だけ反映
      const latest = await loadProject(id);
      const audio = new Map(project.scenes.flatMap((s) => s.lines.map((l) => [l.id, l.audio] as const)));
      for (const s of latest.scenes) for (const l of s.lines) if (audio.get(l.id)) l.audio = audio.get(l.id);
      await saveProject(latest);
      // 今回作った音声を結果で返す。エディターは保存されたプロジェクトを読み直さず、これをそのまま取り込む
      // （読み直すと、その間にエディターが保存した前の音声に戻っていることがあるため）
      const made: Record<string, unknown> = {};
      for (const s of project.scenes) for (const l of s.lines) if (l.audio && l.audio.src !== before.get(l.id)) made[l.id] = l.audio;
      if (failure && !Object.keys(made).length) throw failure;
      return { generated: Object.keys(made).length, audio: made, ...(failure ? { error: (failure as Error).message } : {}) };
    });
    res.json({ jobId: job.id });
  }),
);

app.post(
  '/api/projects/:id/cast/:castId/generate',
  h(async (req, res) => {
    const id = param(req, 'id');
    const body = req.body as Omit<CharacterRequest, 'castId'>;
    if (!body?.description?.trim()) {
      res.status(400).json({ error: 'キャラクターの説明を入力してください' });
      return;
    }
    const busy = conflictFor(id, 'character');
    if (busy) {
      res.status(409).json({ error: busy });
      return;
    }
    const job = startJob('character', id, async (ctx) => {
      const project = await loadProject(id);
      const result = await generateCharacter(
        project,
        {
          castId: param(req, 'castId'),
          description: body.description,
          style: body.style ?? 'anime',
          kind: body.kind ?? 'human',
          poses: body.poses ?? [...POSES],
          referenceAssets: body.referenceAssets,
        },
        (p, m) => ctx.progress(p, m),
      );
      const latest = await loadProject(id);
      const member = latest.cast.find((c) => c.id === param(req, 'castId'));
      if (member) {
        member.images = result.images;
        member.imagesOpen = result.imagesOpen;
        member.library = undefined;
        member.aspect = result.aspect;
        // 画像が変わったので、口パクデータは変わらない（音声は同じ）。表情の欠けはそのまま近い表情で代用される
      }
      await saveProject(latest);
      return { count: Object.keys(result.images).length, failures: result.failures };
    });
    res.json({ jobId: job.id });
  }),
);

app.post(
  '/api/tts/preview',
  h(async (req, res) => {
    const { text = 'こんにちは！よろしくね！', voice, delivery, emoji, tags, stability } = req.body ?? {};
    const provider = resolveProvider('auto');
    const plain = String(text).slice(0, 200);
    // ElevenLabs はタグを先頭に付けて読む。タグを読めないエンジンには外して渡す
    const input =
      provider === 'elevenlabs'
        ? withAudioTags(plain, Array.isArray(tags) ? (tags as unknown[]).map((t) => normalizeTag(String(t))).filter(Boolean).slice(0, 3) : [])
        : stripAudioTags(plain);
    const tmp = path.join(config.projectsDir, `.tts-preview-${Date.now()}.wav`);
    try {
      await synthesizeToFile(input, voice ?? DEFAULT_CAST[0].voice, tmp, {
        delivery: delivery || undefined,
        emoji: emoji || undefined,
        provider,
        stability: ['creative', 'natural', 'robust'].includes(stability) ? stability : undefined,
      });
      res.type('audio/wav').send(fs.readFileSync(tmp));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
  }),
);

/** 課題シーンの図解を作る（sceneIds 指定でそのシーンだけ作り直す） */
app.post(
  '/api/projects/:id/illustrations',
  h(async (req, res) => {
    const id = param(req, 'id');
    const sceneIds = Array.isArray(req.body?.sceneIds) ? (req.body.sceneIds as unknown[]).map(String) : undefined;
    const busy = conflictFor(id, 'illustration');
    if (busy) {
      res.status(409).json({ error: busy });
      return;
    }
    const job = startJob('illustration', id, async (ctx) => {
      const project = await loadProject(id);
      const r = await resolveMedia(project, (n, d) => saveAsset(id, n, d), { sceneIds, onProgress: (p, m) => ctx.progress(p, m) });
      if (r.errors.length) throw new Error(`図解の生成に失敗しました: ${r.errors[0]}`);
      // 生成中の編集を壊さないよう、最新を読み直して画像だけ反映
      const latest = await loadProject(id);
      for (const s of latest.scenes) {
        const made = project.scenes.find((x) => x.id === s.id);
        if (s.type === 'talk' && s.prop && made?.type === 'talk' && made.prop?.image) s.prop.image = made.prop.image;
        if (s.type === 'feature' && made?.type === 'feature' && made.visual.kind === 'image' && s.visual.kind === 'image') s.visual.src = made.visual.src;
      }
      await saveProject(latest);
      return r;
    });
    res.json({ jobId: job.id });
  }),
);

// ---------- ElevenLabs の声 ----------
/** 声の一覧。scope=mine は自分の声、library は共有ライブラリの日本語の声 */
app.get(
  '/api/tts/eleven/voices',
  h(async (req, res) => {
    const search = String(req.query.q ?? '').slice(0, 80);
    const voices = req.query.scope === 'library' ? await libraryVoices({ search, gender: String(req.query.gender ?? '') }) : await myVoices(search);
    res.json({ voices });
  }),
);

/** 共有ライブラリの声を自分の声に追加する */
app.post(
  '/api/tts/eleven/library/add',
  h(async (req, res) => {
    const { publicOwnerId, voiceId, name } = req.body ?? {};
    if (!publicOwnerId || !voiceId) {
      res.status(400).json({ error: '声が指定されていません' });
      return;
    }
    res.json({ voiceId: await addLibraryVoice({ publicOwnerId: String(publicOwnerId), voiceId: String(voiceId), name: String(name ?? '') }), name: String(name ?? '') });
  }),
);

/** 声のイメージから候補を作る（Voice Design。1回で3つ前後） */
app.post(
  '/api/tts/eleven/design',
  h(async (req, res) => {
    const description = String(req.body?.description ?? '').trim();
    if (description.length < 4) {
      res.status(400).json({ error: '声のイメージを入力してください' });
      return;
    }
    const previews = await designVoice({ description, text: String(req.body?.text ?? '') });
    res.json({ previews: previews.map((p) => ({ id: p.generatedVoiceId, durationSec: p.durationSec, url: `${config.basePath}/api/tts/eleven/previews/${p.generatedVoiceId}.mp3` })) });
  }),
);

app.get('/api/tts/eleven/previews/:file', (req, res) => {
  const file = designPreviewFile(param(req, 'file').replace(/\.mp3$/, ''));
  if (!file || !fs.existsSync(file)) {
    res.status(404).json({ error: 'preview not found' });
    return;
  }
  res.type('audio/mpeg').send(fs.readFileSync(file));
});

/** 気に入った候補を自分の声として保存する */
app.post(
  '/api/tts/eleven/design/adopt',
  h(async (req, res) => {
    const { generatedVoiceId, name, description } = req.body ?? {};
    if (!generatedVoiceId) {
      res.status(400).json({ error: '候補が指定されていません' });
      return;
    }
    const voiceName = String(name ?? '').trim() || 'voice';
    res.json({ voiceId: await adoptDesignedVoice({ generatedVoiceId: String(generatedVoiceId), name: voiceName, description: String(description ?? '') }), name: voiceName });
  }),
);

/** 手持ちの音声から声を作る（自分の声、または許諾を得た声だけ） */
app.post(
  '/api/tts/eleven/clone',
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルがありません' });
      return;
    }
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    const name = String(req.body?.name ?? '').trim() || path.parse(original).name;
    res.json({ voiceId: await cloneVoice({ name, audio: req.file.buffer, filename: original }), name });
  }),
);

// ---------- 参照音声（声の固定・Irodori-TTS） ----------
/** Voice Design で声の候補を1本つくる（seed を変えるたびに別の声になる） */
app.post(
  '/api/tts/voice-candidates',
  h(async (req, res) => {
    const { caption = '', text, seed } = req.body ?? {};
    const sample = String(text ?? '').trim().slice(0, 200);
    if (!sample) {
      res.status(400).json({ error: '試し読みのテキストを入力してください' });
      return;
    }
    const c = await createCandidate({ caption: String(caption), text: sample, seed: Number.isInteger(seed) ? seed : undefined });
    res.json({ ...c, url: `${config.basePath}/api/tts/voice-candidates/${c.id}.wav` });
  }),
);

app.get('/api/tts/voice-candidates/:file', (req, res) => {
  const file = candidateFile(param(req, 'file').replace(/\.wav$/, ''));
  if (!file || !fs.existsSync(file)) {
    res.status(404).json({ error: 'candidate not found' });
    return;
  }
  res.type('audio/wav').send(fs.readFileSync(file));
});

/** 気に入った候補を、全編で使う参照音声として登録する */
app.post(
  '/api/tts/voices',
  h(async (req, res) => {
    const { candidateId, name, label, caption, text, seed } = req.body ?? {};
    const file = candidateFile(String(candidateId));
    if (!file || !fs.existsSync(file)) {
      res.status(400).json({ error: '候補の音声が見つかりません。もう一度つくり直してください' });
      return;
    }
    res.json(await registerVoice({ name: String(name ?? ''), label, audio: fs.readFileSync(file), caption, text, seed }));
  }),
);

/** 手持ちの音声ファイルを参照音声として登録する */
app.post(
  '/api/tts/voices/upload',
  upload.single('file'),
  h(async (req, res) => {
    if (!req.file) {
      res.status(400).json({ error: 'ファイルがありません' });
      return;
    }
    const original = Buffer.from(req.file.originalname, 'latin1').toString('utf8');
    res.json(
      await registerVoice({
        name: String(req.body?.name ?? ''),
        label: String(req.body?.label ?? '') || path.parse(original).name,
        audio: req.file.buffer,
        ext: path.extname(original),
      }),
    );
  }),
);

/** 参照音声のファイル（?download=1 で保存用）。標準の声・このアプリで作った声・取り込んだ声が対象 */
app.get(
  '/api/tts/voices/:id/file',
  h(async (req, res) => {
    const id = param(req, 'id');
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      res.status(400).json({ error: 'invalid voice id' });
      return;
    }
    const file = await localVoiceFile(id);
    if (!file) {
      res.status(404).json({ error: 'この声のファイルはこのアプリにありません（Irodori サーバーに直接置かれた声です）' });
      return;
    }
    const label = (await localVoices()).find((v) => v.id === id)?.label ?? id;
    const name = `${label.replace(/[\\/:*?"<>|]/g, '_')}${path.extname(file)}`;
    res.setHeader('Content-Disposition', `${req.query.download ? 'attachment' : 'inline'}; filename="${id}${path.extname(file)}"; filename*=UTF-8''${encodeURIComponent(name)}`);
    res.sendFile(file);
  }),
);

app.delete(
  '/api/tts/voices/:id',
  h(async (req, res) => {
    await deleteVoice(param(req, 'id'));
    res.json({ ok: true });
  }),
);

// ---------- 書き出し ----------
app.post(
  '/api/projects/:id/render',
  h(async (req, res) => {
    const id = param(req, 'id');
    if (runningJobs(id).some((j) => j.kind === 'render')) {
      res.status(409).json({ error: 'この動画はすでに書き出し中です' });
      return;
    }
    const check = await loadProject(id);
    // ui: は取り込み前の参照（取り込みに失敗した）なので、未設定と同じ扱い
    const missing = check.scenes.map((sc, i) => (sc.type === 'showcase' && (!sc.screenshot || sc.screenshot.startsWith('ui:')) ? i + 1 : 0)).filter(Boolean);
    if (missing.length) {
      res.status(400).json({ error: `シーン${missing.join('・')}（画面紹介）に実際のスクリーンショットが設定されていません。画像を設定するか、シーンを削除してください。` });
      return;
    }
    const job = startJob('render', id, async (ctx) => {
      const project = await loadProject(id);
      return withFileServer((serverUrl) => renderProject({ project, serverUrl, onProgress: (p, m) => ctx.progress(p, m) }));
    });
    res.json({ jobId: job.id });
  }),
);

app.get('/api/jobs/:id', (req, res) => {
  const job = getJob(param(req, 'id'));
  if (!job) {
    res.status(404).json({ error: 'job not found' });
    return;
  }
  res.json(job);
});

// ---------- 静的ファイル ----------
app.use('/files', express.static(config.projectsDir, { fallthrough: false, cacheControl: false }));
const dist = path.join(ROOT, 'dist');
if (fs.existsSync(dist)) {
  app.use(express.static(dist));
  app.use(express.static(config.publicDir));
  app.get(/^\/(?!api|files).*/, (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

app.use((err: Error & { status?: number }, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(err.status ?? 500).json({ error: err.message });
});

// 外部から接続できる設定なのにログインが無い状態では起動しない（社外に丸見えになるのを防ぐ）
const loopback = ['127.0.0.1', 'localhost', '::1'].includes(config.host);
if (!loopback && !authEnabled() && process.env.ALLOW_PUBLIC_WITHOUT_AUTH !== 'true') {
  console.error(`\n  ✖ HOST=${config.host} で外部に公開する時は、Google ログインの設定が必要です。未設定: ${authProblems().join(', ')}\n    （docs/deploy.md を参照。どうしてもログインなしで LAN に出す時だけ ALLOW_PUBLIC_WITHOUT_AUTH=true）\n`);
  process.exit(1);
}
if (authEnabled() && authProblems().length) console.warn(`  ⚠ ログイン設定の不足: ${authProblems().join(', ')}`);

// BASE_PATH（例: /video-creator）の下に、画面・API・ファイルをまとめて置く。ヘルスチェックはルートのまま
const root = express();
root.set('trust proxy', 1);
root.disable('x-powered-by');
root.get('/healthz', (_req, res) => res.json({ ok: true }));
if (config.basePath) {
  // 末尾の / なし（/video-creator）とルートは、/video-creator/ へ。Express は末尾の / を区別しないので path で見る
  root.use((req, res, next) => (req.path === '/' || req.path === config.basePath ? res.redirect(`${config.basePath}/`) : next()));
}
root.use(config.basePath || '/', app);

await seedSamples();
await emptyTrash();
root.listen(config.port, config.host, async () => {
  console.log(`\n  Video Creator server: http://localhost:${config.port}${config.basePath}/`);
  console.log(`  ログイン: ${authEnabled() ? `Google（${[...(process.env.AUTH_ALLOWED_DOMAINS ?? '').split(','), ...(process.env.AUTH_ALLOWED_EMAILS ?? '').split(',')].filter(Boolean).join(', ')}）` : 'なし（このPCだけで使う設定）'}`);
  console.log(`  OpenAI: ${hasOpenAI() ? `有効 (${config.models.text} / ${config.models.tts} / ${config.models.image})` : '未設定（.env に OPENAI_API_KEY を設定すると AI 機能が使えます）'}`);
  const provider = resolveProvider('auto');
  if (provider === 'elevenlabs') {
    const el = await elevenStatus();
    console.log(
      `  ナレーション: ElevenLabs（${config.eleven.model}）` +
        (el.online ? `（接続OK${el.quota ? `・今月 ${el.quota.used.toLocaleString()} / ${el.quota.limit.toLocaleString()} 文字` : ''}）` : `（⚠ ${el.error}）`) +
        '\n',
    );
  } else if (provider === 'irodori') {
    const irodori = await irodoriStatus();
    console.log(`  ナレーション: Irodori-TTS${irodori.online ? `（接続OK: ${irodori.url}）` : `（⚠ ${irodori.url} に接続できません。scripts/start-irodori.sh で起動してください）`}\n`);
  } else console.log('  ナレーション: OpenAI TTS\n');
});
