import React from 'react';

export type Segment = { text: string; highlight: boolean };

/** "[[強調]]テキスト" を分割 */
export const parseRich = (text: string): Segment[] => {
  const out: Segment[] = [];
  const re = /\[\[(.+?)\]\]/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ text: text.slice(last, m.index), highlight: false });
    out.push({ text: m[1], highlight: true });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ text: text.slice(last), highlight: false });
  return out;
};

/**
 * 文字数ベースで表示幅を推定（全角=1em。英数字は太字想定で大文字0.68em・小文字0.57em）。
 * wide=true は Dela Gothic など横幅の広いロゴ書体用。
 */
export const estimateEm = (line: string, wide = false) => {
  let w = 0;
  for (const ch of line.replace(/\[\[|\]\]/g, '')) {
    const code = ch.codePointAt(0) ?? 0;
    if (ch === ' ') w += 0.3;
    else if (/[A-Z0-9@#%&]/.test(ch)) w += wide ? 0.82 : 0.68;
    else if (/[a-z]/.test(ch)) w += wide ? 0.66 : 0.57;
    else if (code < 0x100 || (code >= 0xff61 && code <= 0xff9f)) w += 0.42;
    else w += 1;
  }
  return w;
};

/** 最長行が maxWidth に収まるフォントサイズ */
export const fitFontSize = (text: string, maxWidth: number, base: number, min = base * 0.35, wide = false) => {
  const lines = text.split('\n');
  const em = Math.max(1, ...lines.map((l) => estimateEm(l, wide)));
  return Math.max(min, Math.min(base, (maxWidth / em) * 0.97));
};

/**
 * 強調・改行付きテキスト。reveal(0〜1) を渡すとタイプライター表示。
 */
export const RichText: React.FC<{
  text: string;
  highlightColor?: string;
  color?: string;
  reveal?: number;
  style?: React.CSSProperties;
  highlightStyle?: React.CSSProperties;
}> = ({ text, highlightColor, color, reveal = 1, style, highlightStyle }) => {
  const segs = parseRich(text);
  const total = segs.reduce((a, s) => a + s.text.length, 0);
  let budget = Math.round(total * reveal);
  return (
    <span style={{ whiteSpace: 'inherit', color, ...style }}>
      {segs.map((s, i) => {
        const shown = s.text.slice(0, Math.max(0, budget));
        const hidden = s.text.slice(Math.max(0, budget));
        budget -= s.text.length;
        const st: React.CSSProperties = s.highlight ? { color: highlightColor, ...highlightStyle } : {};
        return (
          <span key={i} style={st}>
            {shown}
            {hidden ? <span style={{ opacity: 0 }}>{hidden}</span> : null}
          </span>
        );
      })}
    </span>
  );
};
