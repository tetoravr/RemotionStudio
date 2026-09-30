import type { ElementAdjust, Scene } from '../schema';

/** 画面上の文字を、どのデータに書き戻すか */
export type TextTarget =
  | { type: 'field'; field: 'logoText' | 'subtitle' | 'headline' | 'eyebrow' | 'footnote' | 'title' | 'note' | 'buttonText' | 'contact' }
  | { type: 'line'; lineId: string }
  | { type: 'notes'; index: number }
  | { type: 'propLabel' }
  | { type: 'brandName' };

export const MIN_SCALE = 0.1;
export const MAX_SCALE = 6;

export const readAdjust = (scene: { layout?: Record<string, ElementAdjust> }, id: string): ElementAdjust => {
  const a = scene.layout?.[id];
  return { dx: a?.dx ?? 0, dy: a?.dy ?? 0, scale: a?.scale ?? 1, rotate: a?.rotate ?? 0, px: a?.px, py: a?.py, hidden: a?.hidden, align: a?.align };
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
  };
  if (!out.hidden && !out.align && isIdentity(out)) return null;
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
