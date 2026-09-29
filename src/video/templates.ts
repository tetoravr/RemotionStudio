import { libraryCastMember } from './library';
import type { CastMember, FormatId, ProjectInput, Scene, SceneType } from './schema';

const rid = () => Math.random().toString(36).slice(2, 8);

/** 標準のキャスト: 人間は速水さき、人外はおすしちゃん */
export const DEFAULT_CAST: CastMember[] = [libraryCastMember('hayami-saki', 'saki'), libraryCastMember('osushi-chan', 'osushi')];

export const SCENE_TYPE_LABELS: Record<SceneType, string> = {
  logo: 'ロゴ（集中線＋爆発）',
  talk: '会話（吹き出し）',
  feature: '特徴（見出し＋図解）',
  showcase: '画面紹介（実スクリーンショット）',
  cta: 'エンドカード（CTA）',
};

/** 新規シーンの初期値 */
export const newScene = (type: SceneType, brandName = 'ブランド名'): Scene => {
  const id = `s-${rid()}`;
  const l = (speaker: string, text: string, style: 'bubble' | 'bubble-accent' | 'none' | 'caption' = 'bubble') => ({
    id: `l-${rid()}`,
    speaker,
    text,
    style,
  });
  switch (type) {
    case 'logo':
      return {
        id,
        type,
        transition: 'flash',
        ticker: true,
        subtitle: 'ここにタグライン',
        lines: [l('hero', `${brandName}！`, 'none')],
        characters: [
          { id: 'buddy', position: 'far-left', size: 'm', enter: 'jump', pose: 'happy', enterDelaySec: 0, flip: false },
          { id: 'hero', position: 'right', size: 'l', enter: 'jump', pose: 'happy', enterDelaySec: 0.15, flip: false },
        ],
      };
    case 'talk':
      return {
        id,
        type,
        transition: 'wipe',
        showLogo: false,
        decor: 'none',
        lines: [l('hero', '〇〇、困ってない？', 'bubble-accent'), { ...l('buddy', '困ってた〜……'), pose: 'sad' }],
        characters: [
          { id: 'buddy', position: 'far-left', size: 's', enter: 'pop', pose: 'default', enterDelaySec: 0, flip: false },
          { id: 'hero', position: 'right', size: 'xl', enter: 'slide', pose: 'default', enterDelaySec: 0, flip: false },
        ],
      };
    case 'feature':
      return {
        id,
        type,
        transition: 'wipe',
        eyebrow: '[[キーワード]]なしで',
        headline: '〇〇！',
        visual: { kind: 'icons', items: [{ icon: 'check', label: 'ポイント' }] },
        lines: [l('hero', 'キーワードなしで', 'none'), l('hero', '〇〇！', 'none'), { ...l('buddy', 'マジで！？'), pose: 'surprised' }],
        characters: [{ id: 'buddy', position: 'center', size: 's', enter: 'pop', pose: 'default', enterDelaySec: 0, flip: false }],
      };
    case 'showcase':
      return {
        id,
        type,
        transition: 'wipe',
        title: '使い方も\n[[かんたん]]。',
        note: '※画面はイメージです',
        screenshotFrame: 'phone',
        lines: [{ ...l('hero', '使い方もかんたん。', 'none'), pose: 'point' }],
        characters: [{ id: 'hero', position: 'far-right', size: 'l', enter: 'slide', pose: 'point', enterDelaySec: 0, flip: false }],
      };
    case 'cta':
    default:
      return {
        id,
        type: 'cta',
        transition: 'wipe',
        buttonText: '詳しくはこちら',
        contact: 'example.com',
        notes: [],
        lines: [{ ...l('hero', `${brandName}！`, 'none'), pose: 'wave' }],
        characters: [
          { id: 'hero', position: 'left', size: 'l', enter: 'pop', pose: 'wave', enterDelaySec: 0, flip: false },
          { id: 'buddy', position: 'far-right', size: 'm', enter: 'pop', pose: 'happy', enterDelaySec: 0.2, flip: false },
        ],
      };
  }
};

/** テンプレート内の hero / buddy を、プロジェクトのキャスト（1人目 / 2人目）に置き換える */
export const remapCast = (scene: Scene, castIds: string[]): Scene => {
  const map = (tid: string) => (tid === 'buddy' ? (castIds[1] ?? castIds[0]) : tid === 'hero' ? castIds[0] : tid) ?? 'narrator';
  const seen = new Set<string>();
  return {
    ...scene,
    lines: scene.lines.map((l) => ({ ...l, speaker: l.speaker === 'narrator' ? l.speaker : map(l.speaker) })),
    characters: scene.characters.map((c) => ({ ...c, id: map(c.id) })).filter((c) => !seen.has(c.id) && seen.add(c.id)),
  } as Scene;
};

/** AIを使わずに始めるときの雛形（王道構成） */
export const blankProject = (opts: { id: string; title: string; brandName: string; format?: FormatId }): ProjectInput => {
  const b = opts.brandName;
  const scenes: Scene[] = [
    { ...(newScene('logo', b) as Extract<Scene, { type: 'logo' }>), transition: 'cut', subtitle: undefined },
    {
      ...(newScene('talk', b) as Extract<Scene, { type: 'talk' }>),
      transition: 'cut',
      showLogo: true,
      decor: 'question',
      lines: [{ id: `l-${rid()}`, speaker: 'buddy', text: '……って、なに？', style: 'bubble', pose: 'think' }],
      characters: [
        { id: 'buddy', position: 'center', size: 'm', enter: 'pop', pose: 'think', enterDelaySec: 0, flip: false },
        { id: 'hero', position: 'far-right', size: 'm', enter: 'slide', pose: 'surprised', enterDelaySec: 0.6, flip: false },
      ],
    },
    newScene('talk', b),
    newScene('logo', b),
    newScene('feature', b),
    { ...newScene('feature', b), transition: 'slide' } as Scene,
    { ...newScene('feature', b), transition: 'zoom', background: 'burst-dark' } as Scene,
    newScene('cta', b),
  ];
  return {
    id: opts.id,
    title: opts.title,
    format: opts.format ?? 'vertical',
    fps: 30,
    brand: { name: b, tagline: '', colors: { primary: '#1f5cff', dark: '#0d1b5e', accent: '#ffd93b', light: '#eaf0ff', text: '#15172b' }, font: 'noto' },
    cast: DEFAULT_CAST.map((c) => structuredClone(c)),
    scenes: scenes.map((sc) => remapCast(sc, DEFAULT_CAST.map((c) => c.id))),
  };
};
