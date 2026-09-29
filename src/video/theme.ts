import { createContext, useContext } from 'react';
import type { Brand, FormatId, Project } from './schema';
import { FORMATS } from './schema';

export const FONT_STACKS: Record<Brand['font'], { heading: string; body: string; logo: string }> = {
  noto: {
    heading: '"Noto Sans JP", "Hiragino Sans", sans-serif',
    body: '"Noto Sans JP", "Hiragino Sans", sans-serif',
    logo: '"Dela Gothic One", "Noto Sans JP", sans-serif',
  },
  rounded: {
    heading: '"M PLUS Rounded 1c", "Noto Sans JP", sans-serif',
    body: '"M PLUS Rounded 1c", "Noto Sans JP", sans-serif',
    logo: '"M PLUS Rounded 1c", "Noto Sans JP", sans-serif',
  },
  dela: {
    heading: '"Dela Gothic One", "Noto Sans JP", sans-serif',
    body: '"Noto Sans JP", "Hiragino Sans", sans-serif',
    logo: '"Dela Gothic One", "Noto Sans JP", sans-serif',
  },
};

export type Layout = {
  format: FormatId;
  width: number;
  height: number;
  /** 基準単位: 短辺1080px基準の 1px */
  u: number;
  portrait: boolean;
  /** 見出しテキスト領域 */
  text: Box;
  /** 図解領域 */
  visual: Box;
  /** キャラクターの足元のY座標 */
  groundY: number;
  /** キャラクター位置 -> X座標 */
  slotX: Record<'far-left' | 'left' | 'center' | 'right' | 'far-right', number>;
  /** キャラクターサイズ -> 高さ(px) */
  charHeight: Record<'s' | 'm' | 'l' | 'xl', number>;
  safe: number;
};

export type Box = { x: number; y: number; w: number; h: number };

export const getLayout = (format: FormatId): Layout => {
  const { width, height } = FORMATS[format];
  const u = Math.min(width, height) / 1080;
  const safe = 64 * u;
  if (format === 'vertical') {
    return {
      format,
      width,
      height,
      u,
      portrait: true,
      safe,
      text: { x: safe, y: 170 * u, w: width - safe * 2, h: 520 * u },
      visual: { x: safe, y: 720 * u, w: width - safe * 2, h: 560 * u },
      groundY: height + 10 * u,
      slotX: { 'far-left': width * 0.16, left: width * 0.3, center: width * 0.5, right: width * 0.7, 'far-right': width * 0.84 },
      charHeight: { s: 360 * u, m: 560 * u, l: 780 * u, xl: 1050 * u },
    };
  }
  if (format === 'square') {
    return {
      format,
      width,
      height,
      u,
      portrait: false,
      safe,
      text: { x: safe, y: 70 * u, w: width - safe * 2, h: 300 * u },
      visual: { x: width * 0.22, y: 360 * u, w: width * 0.56, h: 380 * u },
      groundY: height + 10 * u,
      slotX: { 'far-left': width * 0.12, left: width * 0.2, center: width * 0.5, right: width * 0.8, 'far-right': width * 0.88 },
      charHeight: { s: 240 * u, m: 340 * u, l: 460 * u, xl: 600 * u },
    };
  }
  // horizontal
  return {
    format,
    width,
    height,
    u,
    portrait: false,
    safe,
    text: { x: width * 0.2, y: 70 * u, w: width * 0.6, h: 330 * u },
    visual: { x: width * 0.28, y: 420 * u, w: width * 0.44, h: 420 * u },
    groundY: height + 10 * u,
    slotX: { 'far-left': width * 0.08, left: width * 0.14, center: width * 0.5, right: width * 0.86, 'far-right': width * 0.92 },
    charHeight: { s: 380 * u, m: 560 * u, l: 720 * u, xl: 880 * u },
  };
};

export type Theme = {
  colors: Brand['colors'];
  fonts: { heading: string; body: string; logo: string };
  layout: Layout;
  brand: Brand;
  project: Project;
  resolveAsset: (path: string | undefined) => string | undefined;
};

export const ThemeContext = createContext<Theme | null>(null);

export const useTheme = (): Theme => {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('ThemeContext missing');
  return t;
};

export const ThemeProvider = ThemeContext.Provider;

/** #rrggbb を明るく/暗く */
export const shade = (hex: string, amount: number): string => {
  const { r, g, b } = hexToRgb(hex);
  const f = (c: number) =>
    Math.round(amount >= 0 ? c + (255 - c) * amount : c * (1 + amount))
      .toString(16)
      .padStart(2, '0');
  return `#${f(r)}${f(g)}${f(b)}`;
};

export const alpha = (hex: string, a: number): string => {
  const { r, g, b } = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
};

export const hexToRgb = (hex: string) => {
  let h = hex.replace('#', '').trim();
  if (h.length === 3) h = h.split('').map((c) => c + c).join('');
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n)) return { r: 31, g: 92, b: 255 };
  return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255 };
};

/** 相対輝度に応じて読みやすい文字色 */
export const readableOn = (hex: string): string => {
  const { r, g, b } = hexToRgb(hex);
  const lum = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
  return lum > 0.62 ? '#15172b' : '#ffffff';
};
