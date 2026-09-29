import React from 'react';
import {
  BadgeCheck, Bell, Building2, CalendarDays, Camera, Car, Check, Clock, Cloud, Coffee, Coins, CreditCard,
  FileText, Gift, Globe, Handshake, Heart, Hourglass, House, JapaneseYen, KeyRound, Landmark, Laptop, Leaf,
  Lock, Mail, Megaphone, MessageCircle, Music, Package, PenLine, Percent, PiggyBank, Plane, QrCode, Receipt,
  Rocket, Search, Send, Settings, ShieldCheck, ShoppingCart, Smartphone, Smile, Sparkles, Star, Store, Target,
  Ticket, TrendingUp, TriangleAlert, Trophy, Truck, ThumbsUp, User, Users, Wallet, X, Zap,
  type LucideIcon,
} from 'lucide-react';
import type { IconName } from '../schema';

export const ICONS: Record<IconName, LucideIcon> = {
  phone: Smartphone,
  store: Store,
  card: CreditCard,
  check: Check,
  bolt: Zap,
  document: FileText,
  coin: Coins,
  yen: JapaneseYen,
  bank: Landmark,
  shield: ShieldCheck,
  clock: Clock,
  chart: TrendingUp,
  gift: Gift,
  bell: Bell,
  chat: MessageCircle,
  mail: Mail,
  calendar: CalendarDays,
  heart: Heart,
  star: Star,
  rocket: Rocket,
  cart: ShoppingCart,
  truck: Truck,
  lock: Lock,
  users: Users,
  user: User,
  sparkles: Sparkles,
  wallet: Wallet,
  globe: Globe,
  laptop: Laptop,
  cloud: Cloud,
  receipt: Receipt,
  handshake: Handshake,
  piggy: PiggyBank,
  search: Search,
  settings: Settings,
  send: Send,
  home: House,
  camera: Camera,
  ticket: Ticket,
  building: Building2,
  box: Package,
  qr: QrCode,
  leaf: Leaf,
  coffee: Coffee,
  music: Music,
  car: Car,
  plane: Plane,
  megaphone: Megaphone,
  target: Target,
  trophy: Trophy,
  thumbsup: ThumbsUp,
  smile: Smile,
  x: X,
  alert: TriangleAlert,
  hourglass: Hourglass,
  percent: Percent,
  pen: PenLine,
  key: KeyRound,
};

export const ICON_LABELS: Record<IconName, string> = {
  phone: 'スマホ', store: 'お店', card: 'カード', check: 'チェック', bolt: '稲妻', document: '書類', coin: 'コイン',
  yen: '円', bank: '銀行', shield: '安心', clock: '時計', chart: '成長', gift: 'ギフト', bell: '通知', chat: 'チャット',
  mail: 'メール', calendar: 'カレンダー', heart: 'ハート', star: 'スター', rocket: 'ロケット', cart: 'カート',
  truck: '配送', lock: 'セキュリティ', users: 'チーム', user: '人', sparkles: 'キラキラ', wallet: '財布', globe: '世界',
  laptop: 'PC', cloud: 'クラウド', receipt: 'レシート', handshake: '握手', piggy: '貯金', search: '検索',
  settings: '設定', send: '送信', home: '家', camera: 'カメラ', ticket: 'チケット', building: '会社', box: '荷物',
  qr: 'QRコード', leaf: 'エコ', coffee: 'カフェ', music: '音楽', car: '車', plane: '飛行機', megaphone: '告知',
  target: 'ターゲット', trophy: 'トロフィー', thumbsup: 'いいね', smile: '笑顔', x: 'バツ', alert: '警告',
  hourglass: '砂時計', percent: '％', pen: 'ペン', key: '鍵',
};

export const BadgeCheckIcon = BadgeCheck;

/** 太線アイコン（広告の図解向け） */
export const Icon: React.FC<{
  name: IconName;
  size: number;
  color: string;
  strokeWidth?: number;
  fill?: string;
  style?: React.CSSProperties;
}> = ({ name, size, color, strokeWidth = 2.4, fill = 'none', style }) => {
  const C = ICONS[name] ?? Star;
  return <C size={size} color={color} strokeWidth={strokeWidth} fill={fill} style={style} absoluteStrokeWidth={false} />;
};
