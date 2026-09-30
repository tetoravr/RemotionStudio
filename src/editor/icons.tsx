import type { LucideIcon } from 'lucide-react';
import React from 'react';

/** 文字の横に置く小さなアイコン。mr=0 でアイコンだけのボタン用 */
export const Ic: React.FC<{ n: LucideIcon; size?: number; mr?: number; stroke?: number }> = ({ n: Icon, size = 14, mr = 5, stroke = 1.9 }) => (
  <Icon size={size} strokeWidth={stroke} style={{ verticalAlign: '-2px', marginRight: mr, flex: 'none' }} aria-hidden />
);
