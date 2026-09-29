import type { CastMember, FormatId, ProjectInput, Scene, SceneType } from './schema';

const rid = () => Math.random().toString(36).slice(2, 8);

export const DEFAULT_CAST: CastMember[] = [
  {
    id: 'hero',
    name: '主人公',
    persona: '明るく元気な案内役',
    kind: 'builtin',
    builtin: { shape: 'bunny', bodyColor: '#ffffff', emblem: '' },
    images: {},
    voice: { voice: 'coral', instructions: '明るく元気な、アニメの女の子の声。テンポよく、語尾をはずませて楽しそうに話す。', speed: 1.2 },
  },
  {
    id: 'buddy',
    name: '相方',
    persona: 'とぼけたマスコット。視聴者の本音を代弁する',
    kind: 'builtin',
    builtin: { shape: 'mochi', bodyColor: '#ffffff', emblem: '' },
    images: {},
    voice: { voice: 'fable', instructions: '小さくてかわいいマスコットキャラクターの声。少し高めで、とぼけた感じ。テンポよく。', speed: 1.15 },
  },
];

export const SCENE_TYPE_LABELS: Record<SceneType, string> = {
  logo: 'ロゴ（集中線＋爆発）',
  talk: '会話（吹き出し）',
  feature: '特徴（見出し＋図解）',
  showcase: '画面紹介（スマホ）',
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
        mockup: {
          appName: brandName,
          heading: 'ホーム',
          items: [
            { label: '項目1', value: '100' },
            { label: '項目2', value: '200' },
          ],
          total: { label: '合計', value: '300' },
          button: 'はじめる',
        },
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
    newScene('showcase', b),
    newScene('cta', b),
  ];
  return {
    id: opts.id,
    title: opts.title,
    format: opts.format ?? 'vertical',
    fps: 30,
    brand: { name: b, tagline: '', colors: { primary: '#1f5cff', dark: '#0d1b5e', accent: '#ffd93b', light: '#eaf0ff', text: '#15172b' }, font: 'noto' },
    cast: DEFAULT_CAST,
    scenes,
  };
};
