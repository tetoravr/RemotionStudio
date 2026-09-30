import type { LucideIcon } from 'lucide-react';
import React from 'react';

/** 文字の横に置く小さなアイコン（絵文字の代わり）。mr=0 でアイコンだけのボタン用 */
export const Ic: React.FC<{ n: LucideIcon; size?: number; mr?: number }> = ({ n: Icon, size = 14, mr = 5 }) => (
  <Icon size={size} strokeWidth={2.2} style={{ verticalAlign: '-2px', marginRight: mr, flex: 'none' }} aria-hidden />
);
