import { Megaphone, MessageCircle, MonitorSmartphone, Star, Zap, type LucideIcon } from 'lucide-react';
import type { Scene, SceneType } from '../video/schema';

/** シーンの種類ごとの名前・アイコン・説明（エディターの表示用） */
export const SCENE_META: Record<SceneType, { name: string; icon: LucideIcon; desc: string }> = {
  logo: { name: 'ロゴ', icon: Zap, desc: '集中線の中にロゴが飛び込む' },
  talk: { name: '会話', icon: MessageCircle, desc: 'キャラクターが吹き出しで話す' },
  feature: { name: '特徴', icon: Star, desc: '大きな見出しと図解で見せる' },
  showcase: { name: '画面紹介', icon: MonitorSmartphone, desc: '実際の画面のスクリーンショット' },
  cta: { name: 'エンドカード', icon: Megaphone, desc: 'ボタンと連絡先で締める' },
};

export const SCENE_ORDER: SceneType[] = ['logo', 'talk', 'feature', 'showcase', 'cta'];

const plain = (s: string) => s.replace(/\[\[|\]\]/g, '').replace(/\n/g, ' ').trim();

/** シーン一覧に出す1行の要約 */
export const sceneSummary = (s: Scene, brand: string) => {
  switch (s.type) {
    case 'logo':
      return plain(s.logoText || brand);
    case 'feature':
      return plain(`${s.eyebrow} ${s.headline}`);
    case 'showcase':
      return plain(s.title);
    case 'cta':
      return plain(s.buttonText);
    default:
      return plain(s.headline || s.lines[0]?.text || '');
  }
};

/** 秒を 0:03 の形に */
export const clock = (sec: number) => {
  const s = Math.max(0, Math.floor(sec));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};
