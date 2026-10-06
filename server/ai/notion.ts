import { config } from '../env';

/**
 * 社内 Notion の読み込み（読むだけ。書き換えはしない）。
 * Notion の「インテグレーション」（内部連携）のトークン（NOTION_TOKEN）で読む。
 * 読めるのは、そのインテグレーションに共有したページ（ページ右上「…」→「接続」）とその下のページだけ。
 * 商談の議事録など、広告に使わない社外秘のページは共有しないでおく
 */

export const notionEnabled = () => Boolean(config.notion.token);

const NOT_SHARED = 'このページは Video Creator の連携に共有されていません。Notion でページ右上の「…」→「接続」から Video Creator（の連携）を追加してください';

type NotionError = Error & { status?: number };

const call = async <T,>(pathname: string, init: { method?: string; body?: unknown } = {}): Promise<T> => {
  const res = await fetch(`${config.notion.baseUrl}/v1${pathname}`, {
    method: init.method ?? 'GET',
    headers: {
      Authorization: `Bearer ${config.notion.token}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
    },
    body: init.body ? JSON.stringify(init.body) : undefined,
    signal: AbortSignal.timeout(20_000),
  });
  const body = (await res.json().catch(() => ({}))) as { message?: string; code?: string };
  if (!res.ok) {
    const msg =
      res.status === 401
        ? 'Notion の連携トークン（NOTION_TOKEN）が正しくありません'
        : res.status === 404 || body.code === 'object_not_found'
          ? NOT_SHARED
          : res.status === 429
            ? 'Notion が混み合っています。少し待ってから、もう一度お試しください'
            : `Notion から読み込めませんでした（${body.message ?? `HTTP ${res.status}`}）`;
    throw Object.assign(new Error(msg), { status: res.status, code: body.code }) as NotionError;
  }
  return body as T;
};

/** Notion のページの URL か（notion.so・notion.site・app.notion.com） */
export const isNotionUrl = (raw: string) => {
  try {
    const h = new URL(raw).hostname.toLowerCase();
    return h === 'notion.so' || h.endsWith('.notion.so') || h.endsWith('.notion.site') || h === 'app.notion.com' || h === 'notion.com' || h.endsWith('.notion.com');
  } catch {
    return false;
  }
};

/** URL からページ（またはデータベース）の ID を取り出す。ページ名の後ろの 32 文字の英数字が ID */
export const notionIdFrom = (raw: string): string | null => {
  let s = raw;
  try {
    const u = new URL(raw);
    // ?p=<id>（ページをプレビューで開いた時）を優先。#以降（見出しへのリンク）は除く
    s = u.searchParams.get('p') ?? u.pathname;
  } catch {
    // URL でなければ ID そのものとして扱う
  }
  const m = s.replace(/-/g, '').match(/([0-9a-f]{32})(?!.*[0-9a-f]{32})/i);
  if (!m) return null;
  const h = m[1].toLowerCase();
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
};

type RichText = { plain_text?: string }[];
const plain = (rt?: RichText) => (rt ?? []).map((t) => t.plain_text ?? '').join('');

type Block = { id: string; type: string; has_children?: boolean; [k: string]: unknown };
type Page = { id: string; url?: string; object?: string; last_edited_time?: string; properties?: Record<string, { type: string; [k: string]: unknown }> };

/** ページ・データベースの行の、プロパティの値を文字にする */
const propText = (p: { type: string; [k: string]: unknown }): string => {
  const v = p[p.type] as unknown;
  switch (p.type) {
    case 'title':
    case 'rich_text':
      return plain(v as RichText);
    case 'select':
    case 'status':
      return (v as { name?: string } | null)?.name ?? '';
    case 'multi_select':
      return ((v as { name?: string }[]) ?? []).map((x) => x.name).join('、');
    case 'number':
      return v == null ? '' : String(v);
    case 'url':
    case 'email':
    case 'phone_number':
      return (v as string) ?? '';
    case 'checkbox':
      return v ? 'はい' : '';
    case 'date':
      return (v as { start?: string } | null)?.start ?? '';
    default:
      return '';
  }
};

const titleOf = (page: Page) => {
  for (const p of Object.values(page.properties ?? {})) if (p.type === 'title') return plain(p.title as RichText);
  return '';
};

/** ブロック1つを、見出し・箇条書きなどの形を残した文字にする */
const blockLine = (b: Block): string => {
  const d = (b[b.type] ?? {}) as { rich_text?: RichText; caption?: RichText; title?: string; url?: string; checked?: boolean; cells?: RichText[] };
  const t = plain(d.rich_text);
  switch (b.type) {
    case 'heading_1':
      return `\n# ${t}`;
    case 'heading_2':
      return `\n## ${t}`;
    case 'heading_3':
      return `\n### ${t}`;
    case 'bulleted_list_item':
      return `- ${t}`;
    case 'numbered_list_item':
      return `1. ${t}`;
    case 'to_do':
      return `- [${d.checked ? 'x' : ' '}] ${t}`;
    case 'quote':
      return `> ${t}`;
    case 'callout':
    case 'paragraph':
    case 'toggle':
    case 'code':
      return t;
    case 'table_row':
      return (d.cells ?? []).map((c) => plain(c)).join(' | ');
    case 'child_page':
      return `（子ページ: ${d.title ?? ''}）`;
    case 'child_database':
      return `（データベース: ${d.title ?? ''}）`;
    case 'bookmark':
    case 'link_preview':
    case 'embed':
      return d.url ? `（リンク: ${d.url}）` : '';
    case 'image':
    case 'video':
    case 'file':
    case 'pdf': {
      const cap = plain(d.caption);
      return cap ? `（${b.type === 'image' ? '画像' : 'ファイル'}: ${cap}）` : '';
    }
    default:
      return '';
  }
};

/** 読み込む文字数の上限（AI に渡す量。長い資料は途中まで） */
const MAX_CHARS = 24_000;

/** ページの中身を上から順に読む。子ページの中までは読まない（社内の Wiki 全体を読み込まないように） */
const readBlocks = async (id: string, depth: number, out: string[], budget: { chars: number; calls: number }) => {
  let cursor: string | undefined;
  do {
    if (budget.chars <= 0 || budget.calls <= 0) return;
    budget.calls--;
    const r = await call<{ results: Block[]; has_more: boolean; next_cursor: string | null }>(
      `/blocks/${id}/children?page_size=100${cursor ? `&start_cursor=${encodeURIComponent(cursor)}` : ''}`,
    );
    for (const b of r.results) {
      const line = blockLine(b);
      if (line.trim()) {
        const s = `${'  '.repeat(depth)}${line}`;
        out.push(s);
        budget.chars -= s.length;
        if (budget.chars <= 0) return;
      }
      if (b.has_children && depth < 3 && b.type !== 'child_page' && b.type !== 'child_database') await readBlocks(b.id, depth + 1, out, budget);
    }
    cursor = r.has_more ? (r.next_cursor ?? undefined) : undefined;
  } while (cursor);
};

/** データベースは、行（最大50件）の名前とプロパティを読む */
const readDatabase = async (id: string) => {
  const db = await call<{ title?: RichText; url?: string }>(`/databases/${id}`);
  const rows = await call<{ results: Page[] }>(`/databases/${id}/query`, { method: 'POST', body: { page_size: 50 } });
  const lines = rows.results.map((row) => {
    const props = Object.entries(row.properties ?? {})
      .filter(([, p]) => p.type !== 'title')
      .map(([k, p]) => [k, propText(p)] as const)
      .filter(([, v]) => v)
      .map(([k, v]) => `${k}: ${v}`)
      .join(' / ');
    return `- ${titleOf(row) || '（無題）'}${props ? `（${props}）` : ''}`;
  });
  return { title: plain(db.title) || 'データベース', url: db.url ?? '', text: lines.join('\n') };
};

export type NotionDoc = { title: string; url: string; text: string };

/** Notion のページ（またはデータベース）を文字で読む */
export const readNotion = async (raw: string): Promise<NotionDoc> => {
  if (!notionEnabled()) throw new Error('Notion のページを読むには、サーバーに NOTION_TOKEN（Notion の連携のトークン）を設定してください（docs/deploy.md）');
  const id = notionIdFrom(raw);
  if (!id) throw new Error(`Notion のページの URL ではありません（${raw}）`);
  let page: Page;
  try {
    page = await call<Page>(`/pages/${id}`);
  } catch (e) {
    // データベースの URL の時は、ページとしては読めない
    if ((e as NotionError).status === 400 || (e as NotionError).status === 404) {
      try {
        return await readDatabase(id);
      } catch {
        throw e;
      }
    }
    throw e;
  }
  const out: string[] = [];
  const props = Object.entries(page.properties ?? {})
    .filter(([, p]) => p.type !== 'title')
    .map(([k, p]) => [k, propText(p)] as const)
    .filter(([, v]) => v);
  if (props.length) out.push(props.map(([k, v]) => `${k}: ${v}`).join('\n'), '');
  await readBlocks(id, 0, out, { chars: MAX_CHARS, calls: 40 });
  return { title: titleOf(page) || '無題のページ', url: page.url ?? raw, text: out.join('\n').replace(/\n{3,}/g, '\n\n').trim() };
};

export type NotionHit = { id: string; title: string; url: string; editedAt?: string; kind: 'page' | 'database' };

/** 連携に共有されたページ・データベースを、タイトルで探す（新しく編集された順） */
export const searchNotion = async (query: string): Promise<NotionHit[]> => {
  if (!notionEnabled()) throw new Error('Notion の連携（NOTION_TOKEN）が設定されていません');
  const r = await call<{ results: (Page & { title?: RichText })[] }>('/search', {
    method: 'POST',
    body: { query: query.slice(0, 100), page_size: 20, sort: { direction: 'descending', timestamp: 'last_edited_time' } },
  });
  return r.results.map((x) => ({
    id: x.id,
    title: (x.object === 'database' ? plain(x.title) : titleOf(x)) || '無題',
    url: x.url ?? '',
    editedAt: x.last_edited_time,
    kind: x.object === 'database' ? 'database' : 'page',
  }));
};
