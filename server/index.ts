import express, { type NextFunction, type Request, type Response } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import { BACKGROUNDS, FORMATS, ICON_NAMES, POSES, Project, TRANSITIONS } from '../src/video/schema';
import { blankProject, DEFAULT_CAST } from '../src/video/templates';
import { STYLE_PRESETS } from './ai/images';
import { generateStoryboard, reviseStoryboard, type Brief } from './ai/storyboard';
import { OPENAI_VOICES, synthesizeToFile } from './ai/tts';
import { generateCharacter, type CharacterRequest } from './characters';
import { config, hasOpenAI, ROOT } from './env';
import { getJob, runningJobs, startJob } from './jobs';
import { generateNarration, staleLines } from './narration';
import {
  deleteProject, duplicateProject, listProjects, loadProject, newProjectId, projectDir, saveAsset, saveProject, seedSamples,
} from './projects';
import { renderProject } from './render';

const app = express();
app.use(express.json({ limit: '10mb' }));
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 60 * 1024 * 1024 } });

type Handler = (req: Request, res: Response) => Promise<unknown>;
const h = (fn: Handler) => (req: Request, res: Response, next: NextFunction) => fn(req, res).catch(next);
const param = (req: Request, key: string) => String(req.params[key]);

// ---------- メタ情報 ----------
app.get('/api/meta', (_req, res) => {
  res.json({
    openai: hasOpenAI(),
    models: config.models,
    voices: OPENAI_VOICES,
    icons: ICON_NAMES,
    poses: POSES,
    formats: FORMATS,
    backgrounds: BACKGROUNDS,
    transitions: TRANSITIONS,
    styles: Object.keys(STYLE_PRESETS),
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
    res.json(await saveProject(parsed.data));
  }),
);

app.delete(
  '/api/projects/:id',
  h(async (req, res) => {
    await deleteProject(param(req, 'id'));
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
    res.json({ path: await saveAsset(param(req, 'id'), name, req.file.buffer) });
  }),
);

app.get('/api/projects/:id/renders', h(async (req, res) => {
  const dir = path.join(projectDir(param(req, 'id')), 'renders');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter((f) => f.endsWith('.mp4')) : [];
  res.json(
    files
      .map((f) => ({ name: f, url: `/files/${param(req, 'id')}/renders/${f}`, size: fs.statSync(path.join(dir, f)).size, at: fs.statSync(path.join(dir, f)).mtimeMs }))
      .sort((a, b) => b.at - a.at),
  );
}));

// ---------- AI ----------
app.post(
  '/api/ai/storyboard',
  h(async (req, res) => {
    const { brief, format = 'vertical', colors } = req.body as { brief: Brief; format?: Project['format']; colors?: Project['brand']['colors'] };
    if (!brief?.productName || !brief?.oneLiner) {
      res.status(400).json({ error: '商品名と「ひとことで」は必須です' });
      return;
    }
    const job = startJob('storyboard', undefined, async (ctx) => {
      ctx.progress(0.1, 'AIが台本を書いています（30〜60秒）');
      const cast = DEFAULT_CAST.map((c) => ({ ...c }));
      const { ai, scenes } = await generateStoryboard(brief, cast, format);
      const id = newProjectId(brief.productName);
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
      return { projectId: project.id };
    });
    res.json({ jobId: job.id });
  }),
);

/** 改稿後も、同じセリフ（話者・文言が同じ）の音声は使い回す */
const carryOverAudio = (before: Project, after: Project) => {
  const map = new Map<string, NonNullable<Project['scenes'][number]['lines'][number]['audio']>>();
  for (const s of before.scenes) for (const l of s.lines) if (l.audio) map.set(`${l.speaker}|${l.speak || l.text}`, l.audio);
  for (const s of after.scenes) for (const l of s.lines) l.audio = map.get(`${l.speaker}|${l.speak || l.text}`);
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
    const job = startJob('revise', id, async (ctx) => {
      ctx.progress(0.1, 'AIが台本を修正しています');
      const project = await loadProject(id);
      const { ai, scenes } = await reviseStoryboard(project, instruction);
      const next: Project = { ...project, title: ai.title || project.title, brand: { ...project.brand, tagline: ai.tagline || project.brand.tagline }, scenes };
      carryOverAudio(project, next);
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
    const force = Boolean(req.body?.force);
    const job = startJob('narration', id, async (ctx) => {
      const project = await loadProject(id);
      const todo = staleLines(project, force).length;
      if (!todo) return { generated: 0 };
      await generateNarration(project, projectDir(id), {
        force,
        onProgress: (d, t, m) => ctx.progress(t ? d / t : 1, `ナレーション生成 ${d}/${t} ${m}`),
      });
      // 生成中にエディタで編集された内容を壊さないよう、最新を読み直して音声だけ反映
      const latest = await loadProject(id);
      const audio = new Map(project.scenes.flatMap((s) => s.lines.map((l) => [l.id, l.audio] as const)));
      for (const s of latest.scenes) for (const l of s.lines) if (audio.get(l.id)) l.audio = audio.get(l.id);
      await saveProject(latest);
      return { generated: todo };
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
    const job = startJob('character', id, async (ctx) => {
      const project = await loadProject(id);
      const result = await generateCharacter(
        project,
        { castId: param(req, 'castId'), description: body.description, style: body.style ?? 'anime', poses: body.poses ?? [...POSES], keepBase: body.keepBase },
        (p, m) => ctx.progress(p, m),
      );
      const latest = await loadProject(id);
      const member = latest.cast.find((c) => c.id === param(req, 'castId'));
      if (member) {
        member.images = result.images;
        member.kind = 'image';
      }
      await saveProject(latest);
      return result;
    });
    res.json({ jobId: job.id });
  }),
);

app.post(
  '/api/tts/preview',
  h(async (req, res) => {
    const { text = 'こんにちは！よろしくね！', voice } = req.body ?? {};
    const tmp = path.join(config.projectsDir, `.tts-preview-${Date.now()}.wav`);
    try {
      await synthesizeToFile(String(text).slice(0, 200), voice ?? DEFAULT_CAST[0].voice, tmp);
      res.type('audio/wav').send(fs.readFileSync(tmp));
    } finally {
      fs.rmSync(tmp, { force: true });
    }
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
    const job = startJob('render', id, async (ctx) => {
      const project = await loadProject(id);
      return renderProject({ project, serverUrl: `http://127.0.0.1:${config.port}`, onProgress: (p, m) => ctx.progress(p, m) });
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
app.use('/files', express.static(config.projectsDir, { fallthrough: false, maxAge: 0 }));
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

await seedSamples();
app.listen(config.port, () => {
  console.log(`\n  Ad Studio server: http://localhost:${config.port}`);
  console.log(`  OpenAI: ${hasOpenAI() ? `有効 (${config.models.text} / ${config.models.tts} / ${config.models.image})` : '未設定（.env に OPENAI_API_KEY を設定すると AI 機能が使えます）'}\n`);
});
