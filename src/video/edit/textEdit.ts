import type { ElementAdjust, FormatId, Project, Scene } from '../schema';

/** 画面上の文字を、どのデータに書き戻すか */
export type TextTarget =
  | { type: 'field'; field: 'logoText' | 'subtitle' | 'headline' | 'eyebrow' | 'footnote' | 'title' | 'note' | 'buttonText' | 'contact' }
  | { type: 'line'; lineId: string }
  | { type: 'notes'; index: number }
  | { type: 'propLabel' }
  | { type: 'brandName' };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 6;

type WithLayouts = Pick<Scene, 'layouts' | 'layout'>;

/** その画面の形での、シーンの要素の調整（要素ID -> 調整） */
export const sceneLayout = (scene: WithLayouts, format: FormatId): Record<string, ElementAdjust> => scene.layouts?.[format] ?? {};

/** その画面の形の調整を書き換える（空になったらキーごと消す） */
export const setSceneLayout = (scene: WithLayouts, format: FormatId, map: Record<string, ElementAdjust>) => {
  const layouts = { ...(scene.layouts ?? {}) };
  if (Object.keys(map).length) layouts[format] = map;
  else delete layouts[format];
  scene.layouts = Object.keys(layouts).length ? layouts : undefined;
};

export const readAdjust = (scene: WithLayouts, id: string, format: FormatId): ElementAdjust => {
  const a = sceneLayout(scene, format)[id];
  return { dx: a?.dx ?? 0, dy: a?.dy ?? 0, scale: a?.scale ?? 1, rotate: a?.rotate ?? 0, px: a?.px, py: a?.py, hidden: a?.hidden, align: a?.align, z: a?.z, tail: a?.tail };
};

/**
 * 旧形式（画面の形を区別しない layout と、セリフの tail）を、今の画面の形の layouts へ移す。
 * 旧形式の調整は、その時の画面の形で作ったものとみなす。
 */
export const migrateLayouts = <T extends Pick<Project, 'format' | 'scenes'>>(project: T): T => {
  for (const s of project.scenes) {
    const map: Record<string, ElementAdjust> = { ...(s.layouts?.[project.format] ?? {}) };
    let moved = false;
    if (s.layout) {
      for (const [k, v] of Object.entries(s.layout)) map[k] = { ...v, ...map[k] };
      s.layout = undefined;
      moved = true;
    }
    for (const l of s.lines) {
      if (!l.tail) continue;
      const key = `line:${l.id}`;
      const cur = map[key];
      map[key] = { dx: cur?.dx ?? 0, dy: cur?.dy ?? 0, scale: cur?.scale ?? 1, rotate: cur?.rotate ?? 0, ...(cur ? { px: cur.px, py: cur.py, hidden: cur.hidden, align: cur.align, z: cur.z } : {}), tail: cur?.tail ?? l.tail };
      l.tail = undefined;
      moved = true;
    }
    if (moved) setSceneLayout(s, project.format, map);
  }
  return project;
};

export const isIdentity = (a: ElementAdjust) => Math.abs(a.dx) < 0.5 && Math.abs(a.dy) < 0.5 && Math.abs(a.scale - 1) < 0.005 && Math.abs(a.rotate) < 0.05;

/** ほぼ初期値ならキーを消す（null）。非表示は残す */
export const normalizeAdjust = (a: ElementAdjust): ElementAdjust | null => {
  const out: ElementAdjust = {
    dx: Math.round(a.dx * 10) / 10,
    dy: Math.round(a.dy * 10) / 10,
    scale: Math.round(Math.min(MAX_SCALE, Math.max(MIN_SCALE, a.scale)) * 1000) / 1000,
    rotate: Math.round((((a.rotate % 360) + 540) % 360 - 180) * 10) / 10,
    px: a.px == null ? undefined : Math.round(a.px * 10) / 10,
    py: a.py == null ? undefined : Math.round(a.py * 10) / 10,
    hidden: a.hidden || undefined,
    align: a.align,
    z: a.z,
    tail: a.tail && (a.tail.dx || a.tail.dy || a.tail.hidden) ? { dx: Math.round(a.tail.dx), dy: Math.round(a.tail.dy), hidden: a.tail.hidden || undefined } : undefined,
  };
  if (!out.hidden && !out.align && out.z == null && !out.tail && isIdentity(out)) return null;
  return out;
};

/** CSS の transform。恒等なら undefined */
export const adjustTransform = (a: ElementAdjust) =>
  isIdentity(a) ? undefined : `translate(${a.dx}px, ${a.dy}px) rotate(${a.rotate}deg) scale(${a.scale})`;

const NAMED: Record<string, string> = {
  logo: 'ロゴ',
  fx: '演出（集中線・きらきらなど）',
  confetti: '紙吹雪',
  subtitle: 'サブコピー',
  ticker: '流れる帯',
  miniLogo: '小さなロゴ',
  headline: '見出し',
  eyebrow: '1行目',
  footnote: '注記',
  decor: '記号',
  prop: '小道具',
  visual: '図解',
  title: 'タイトル',
  note: '補足',
  screen: '画面',
  button: 'ボタン',
  contact: '連絡先',
};

export const layoutLabel = (id: string, scene?: Scene) => {
  if (NAMED[id]) return NAMED[id];
  if (id.startsWith('char:')) {
    const c = scene?.characters[Number(id.slice(5))];
    return `キャラクター${c ? `（${c.id}）` : ''}`;
  }
  if (id.startsWith('line:')) {
    const l = scene?.lines.find((x) => x.id === id.slice(5));
    return `吹き出し${l ? `「${l.text.replace(/\n/g, '').slice(0, 10)}」` : ''}`;
  }
  if (id.startsWith('caption:')) {
    const l = scene?.lines.find((x) => x.id === id.slice(8));
    return `字幕${l ? `「${l.text.replace(/\n/g, '').slice(0, 10)}」` : ''}`;
  }
  if (id.startsWith('note:')) return `注意書き${Number(id.slice(5)) + 1}`;
  return id;
};

/** シーンに含まれる調整可能な要素（要素リストの表示用。画面に出ていない時間帯の要素も復元できるように） */
export const sceneElementIds = (scene: Scene): string[] => {
  const ids: string[] = [];
  if (scene.type === 'logo') ids.push('ticker', 'logo', 'subtitle', 'fx', 'confetti');
  if (scene.type === 'talk') ids.push('miniLogo', 'headline', 'decor', 'prop');
  if (scene.type === 'feature') ids.push('fx', 'eyebrow', 'headline', 'footnote', 'visual');
  if (scene.type === 'showcase') ids.push('title', 'note', 'screen');
  if (scene.type === 'cta') ids.push('logo', 'button', 'contact', ...scene.notes.map((_, i) => `note:${i}`), 'fx');
  scene.characters.forEach((_, i) => ids.push(`char:${i}`));
  for (const l of scene.lines) ids.push(l.style === 'caption' ? `caption:${l.id}` : `line:${l.id}`);
  return ids;
};

/** その要素が今のシーン内容で実際に存在するか（存在しない要素は一覧に出さない） */
export const elementExists = (scene: Scene, id: string): boolean => {
  if (id === 'subtitle') return scene.type === 'logo' && Boolean(scene.subtitle);
  if (id === 'ticker') return scene.type === 'logo' && scene.ticker;
  if (id === 'miniLogo') return scene.type === 'talk' && scene.showLogo;
  if (id === 'headline' && scene.type === 'talk') return Boolean(scene.headline);
  if (id === 'decor') return scene.type === 'talk' && scene.decor !== 'none';
  if (id === 'prop') return scene.type === 'talk' && Boolean(scene.prop);
  if (id === 'footnote') return scene.type === 'feature' && Boolean(scene.footnote);
  if (id === 'visual') return scene.type === 'feature' && scene.visual.kind !== 'none';
  if (id === 'note') return scene.type === 'showcase' && Boolean(scene.note);
  if (id === 'contact') return scene.type === 'cta' && Boolean(scene.contact);
  return true;
};

export const applyTextTarget = (scene: Scene, target: TextTarget, value: string) => {
  if (target.type === 'brandName') return;
  if (target.type === 'field') {
    (scene as Record<string, unknown>)[target.field] = value;
    return;
  }
  if (target.type === 'line') {
    const line = scene.lines.find((l) => l.id === target.lineId);
    if (line) {
      line.text = value;
      // 読み上げ用の別表記があると、書き換えた文字と声がずれる。文字を直したら別表記は外す
      line.speak = undefined;
    }
    return;
  }
  if (target.type === 'notes' && scene.type === 'cta' && scene.notes[target.index] !== undefined) {
    scene.notes[target.index] = value;
    return;
  }
  if (target.type === 'propLabel' && scene.type === 'talk' && scene.prop) scene.prop.label = value;
};

/* ---------------- レイヤー（重なり順） ---------------- */

const SIZE_ORDER = { s: 0, m: 1, l: 2, xl: 3 } as const;

/** キャラは小さい順に奥から描く（SceneCharacters と同じ並び）。char:<元の番号> の並び */
const characterOrder = (scene: Scene) =>
  scene.characters
    .map((p, i) => ({ p, i }))
    .sort((a, b) => SIZE_ORDER[a.p.size] - SIZE_ORDER[b.p.size])
    .map(({ i }) => `char:${i}`);

/**
 * シーンの部品を描く順（奥→手前）。scenes/*.tsx の並びと合わせる。
 * subtitles=true（全セリフを字幕でも出す）の時は、すべてのセリフの字幕も含める
 */
export const sceneDrawOrder = (scene: Scene, opts: { subtitles?: boolean } = {}): string[] => {
  const chars = characterOrder(scene);
  const bubbles = scene.lines.filter((l) => l.style === 'bubble' || l.style === 'bubble-accent').map((l) => `line:${l.id}`);
  const captions = scene.lines.filter((l) => l.style === 'caption' || (opts.subtitles && l.text.trim())).map((l) => `caption:${l.id}`);
  const tail = [...bubbles, ...captions];
  switch (scene.type) {
    case 'logo':
      return ['ticker', 'fx', 'logo', 'subtitle', ...chars, 'confetti', ...tail];
    case 'talk':
      return ['miniLogo', 'headline', ...chars, 'decor', 'prop', ...tail];
    case 'feature':
      return ['fx', 'eyebrow', 'headline', 'footnote', 'visual', ...chars, ...tail];
    case 'showcase':
      return ['title', 'note', 'screen', ...chars, ...tail];
    case 'cta':
      return ['fx', 'logo', 'button', 'contact', ...scene.notes.map((_, i) => `note:${i}`), ...chars, ...tail];
  }
};

/** 調整していない時の z（Editable に渡している値と同じ。キャラ=大きさ順、小道具=10、吹き出し=20、字幕=30、ほか=0） */
const defaultZ = (id: string, scene: Scene) => {
  if (id.startsWith('char:')) return characterOrder(scene).indexOf(id);
  if (id === 'prop') return 10;
  if (id.startsWith('line:')) return 20;
  if (id.startsWith('caption:')) return 30;
  return 0;
};

/**
 * 今の重なり順（奥→手前）。レイヤーで並べ替えた要素（z あり）は、並べ替えていない要素より手前に、z の順で並ぶ。
 * Editable の zIndex（z あり: 1000+z、なし: 既定の z）と同じ規則
 */
export const layerOrder = (scene: Scene, format: FormatId, opts: { subtitles?: boolean } = {}): string[] => {
  const ids = sceneDrawOrder(scene, opts).filter((id) => elementExists(scene, id));
  const layout = sceneLayout(scene, format);
  const dom = new Map(ids.map((id, i) => [id, i]));
  const eff = (id: string) => (layout[id]?.z != null ? 1000 + layout[id].z! : defaultZ(id, scene));
  return [...ids].sort((a, b) => eff(a) - eff(b) || dom.get(a)! - dom.get(b)!);
};

/** 重なり順を決める（奥→手前の並び）。並びのすべての要素に z を付ける（その画面の形だけ） */
export const setLayerOrder = (scene: Scene, format: FormatId, backToFront: string[]) => {
  const map = { ...sceneLayout(scene, format) };
  backToFront.forEach((id, z) => {
    const next = normalizeAdjust({ ...readAdjust(scene, id, format), z });
    if (next) map[id] = next;
    else delete map[id];
  });
  setSceneLayout(scene, format, map);
};

/** 1つの要素を前後に動かす。to: 'front'=最前面 / 'back'=最背面 / 数値=手前へいくつ（負なら奥へ） */
export const moveLayer = (scene: Scene, format: FormatId, id: string, to: 'front' | 'back' | number, opts: { subtitles?: boolean } = {}) => {
  const order = layerOrder(scene, format, opts);
  const from = order.indexOf(id);
  if (from < 0) return;
  order.splice(from, 1);
  const dest = to === 'front' ? order.length : to === 'back' ? 0 : Math.max(0, Math.min(order.length, from + to));
  order.splice(dest, 0, id);
  setLayerOrder(scene, format, order);
};
