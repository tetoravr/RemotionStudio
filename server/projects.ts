import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { migrateLayouts } from '../src/video/edit/textEdit';
import { Project, type ProjectInput } from '../src/video/schema';
import { config } from './env';

export const safeId = (id: string) => {
  if (!/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw Object.assign(new Error('invalid project id'), { status: 400 });
  return id;
};

export const projectDir = (id: string) => path.join(config.projectsDir, safeId(id));
const projectFile = (id: string) => path.join(projectDir(id), 'project.json');

export const newProjectId = (title: string) => {
  const slug = title
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 30);
  return `${slug || 'project'}-${crypto.randomBytes(3).toString('hex')}`;
};

export const loadProject = async (id: string): Promise<Project> => {
  const raw = await fs.readFile(projectFile(id), 'utf8').catch(() => {
    throw Object.assign(new Error('プロジェクトが見つかりません'), { status: 404 });
  });
  // 旧形式の調整（画面の形を区別しない）を、今の画面の形のものとして移す
  return migrateLayouts(Project.parse(JSON.parse(raw)));
};

export const saveProject = async (input: ProjectInput): Promise<Project> => {
  const project = Project.parse({ ...input, updatedAt: new Date().toISOString() });
  const dir = projectDir(project.id);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.project.${process.pid}.${Date.now()}.tmp`);
  await fs.writeFile(tmp, JSON.stringify(project, null, 2));
  await fs.rename(tmp, projectFile(project.id));
  return project;
};

export type ProjectSummary = {
  id: string;
  title: string;
  format: Project['format'];
  brand: string;
  primary: string;
  scenes: number;
  updatedAt?: string;
  updatedBy?: string;
  thumbnail?: string;
};

export const listProjects = async (): Promise<ProjectSummary[]> => {
  await fs.mkdir(config.projectsDir, { recursive: true });
  const entries = await fs.readdir(config.projectsDir, { withFileTypes: true });
  const out: ProjectSummary[] = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    try {
      const p = await loadProject(e.name);
      const img = p.cast[0]?.images.default;
      out.push({
        id: p.id,
        title: p.title,
        format: p.format,
        brand: p.brand.name,
        primary: p.brand.colors.primary,
        scenes: p.scenes.length,
        updatedAt: p.updatedAt,
        updatedBy: p.updatedBy,
        thumbnail: img ? (img.startsWith('lib:') ? `${config.basePath}/${img.slice(4)}` : `${config.basePath}/files/${p.id}/${img}`) : undefined,
      });
    } catch {
      // 壊れたプロジェクトは一覧から除外
    }
  }
  return out.sort((a, b) => (b.updatedAt ?? '').localeCompare(a.updatedAt ?? ''));
};

export const deleteProject = async (id: string) => {
  const dir = projectDir(id);
  try {
    // Windows では、動画や音声を他のアプリで開いていると一時的に消せないので、少し待って再試行する
    await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
  } catch (e) {
    // それでも消せない時は、ゴミ箱フォルダへ移して一覧から外す（ファイルを閉じたあと、次回の起動時に片付ける）
    const trash = path.join(config.projectsDir, '.trash', `${id}-${Date.now()}`);
    await fs.mkdir(path.dirname(trash), { recursive: true });
    await fs.rename(dir, trash).catch(() => {
      throw Object.assign(new Error(`削除できませんでした。プロジェクトのファイル（書き出した動画など）を他のアプリで開いていないか確認してください。
${(e as Error).message}`), { status: 409 });
    });
  }
};

/** 前回消せなかったプロジェクトの片付け */
export const emptyTrash = async () => {
  await fs.rm(path.join(config.projectsDir, '.trash'), { recursive: true, force: true, maxRetries: 2 }).catch(() => undefined);
};

export const copyDir = async (from: string, to: string, skip: (name: string) => boolean = () => false) => {
  await fs.mkdir(to, { recursive: true });
  for (const e of await fs.readdir(from, { withFileTypes: true })) {
    if (skip(e.name)) continue;
    const a = path.join(from, e.name);
    const b = path.join(to, e.name);
    if (e.isDirectory()) await copyDir(a, b, skip);
    else await fs.copyFile(a, b);
  }
};

export const duplicateProject = async (id: string) => {
  const p = await loadProject(id);
  const newId = newProjectId(p.title);
  await copyDir(projectDir(id), projectDir(newId), (n) => n === 'renders');
  return saveProject({ ...p, id: newId, title: `${p.title}（コピー）` });
};

/** 初回起動時にサンプルプロジェクトを projects/ にコピー */
export const seedSamples = async () => {
  const samplesDir = path.join(config.publicDir, 'samples');
  await fs.mkdir(config.projectsDir, { recursive: true });
  const marker = path.join(config.projectsDir, '.seeded');
  if (await fs.stat(marker).catch(() => null)) return;
  for (const e of await fs.readdir(samplesDir, { withFileTypes: true }).catch(() => [])) {
    if (!e.isDirectory()) continue;
    const dest = path.join(config.projectsDir, e.name);
    if (await fs.stat(dest).catch(() => null)) continue;
    await copyDir(path.join(samplesDir, e.name), dest);
    console.log(`[seed] sample project: ${e.name}`);
  }
  await fs.writeFile(marker, new Date().toISOString());
};

/** アップロードファイルを assets/ に保存し、プロジェクト相対パスを返す */
export const saveAsset = async (id: string, originalName: string, data: Buffer) => {
  const ext = (path.extname(originalName) || '.bin').toLowerCase().replace(/[^.a-z0-9]/g, '');
  const base = path
    .basename(originalName, path.extname(originalName))
    .normalize('NFKC')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .slice(0, 40);
  const name = `${base || 'file'}-${crypto.createHash('sha1').update(data).digest('hex').slice(0, 8)}${ext}`;
  const dir = path.join(projectDir(id), 'assets');
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, name), data);
  return `assets/${name}`;
};
