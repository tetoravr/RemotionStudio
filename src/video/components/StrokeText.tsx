import React from 'react';
import { RichText } from './RichText';

/**
 * 太いフチ取り文字（日本の広告テロップ風）。
 * 背面にストローク層、前面に塗り層を重ねて、フチが文字を侵食しないようにする。
 */
export const StrokeText: React.FC<{
  text: string;
  fontSize: number;
  color: string;
  highlightColor?: string;
  strokeColor?: string;
  strokeWidth?: number;
  fontFamily: string;
  fontWeight?: number;
  lineHeight?: number;
  letterSpacing?: string;
  align?: 'left' | 'center' | 'right';
  reveal?: number;
  shadow?: string;
  italic?: boolean;
  style?: React.CSSProperties;
}> = ({
  text,
  fontSize,
  color,
  highlightColor,
  strokeColor,
  strokeWidth = 0,
  fontFamily,
  fontWeight = 900,
  lineHeight = 1.18,
  letterSpacing = '0.02em',
  align = 'center',
  reveal = 1,
  shadow,
  italic,
  style,
}) => {
  const base: React.CSSProperties = {
    fontFamily,
    fontWeight,
    fontSize,
    lineHeight,
    letterSpacing,
    textAlign: align,
    display: 'block',
    whiteSpace: 'pre-wrap',
    fontFeatureSettings: '"palt" 1',
    transform: italic ? 'skewX(-9deg)' : undefined,
  };
  return (
    <div style={{ position: 'relative', ...style }}>
      {strokeColor && strokeWidth > 0 ? (
        <div
          aria-hidden
          style={{
            ...base,
            position: 'absolute',
            inset: 0,
            WebkitTextStroke: `${strokeWidth * 2}px ${strokeColor}`,
            color: strokeColor,
            filter: shadow ? `drop-shadow(${shadow})` : undefined,
          }}
        >
          <RichText text={text} color={strokeColor} highlightColor={strokeColor} reveal={reveal} />
        </div>
      ) : null}
      <div
        style={{
          ...base,
          position: 'relative',
          filter: shadow && !(strokeColor && strokeWidth > 0) ? `drop-shadow(${shadow})` : undefined,
        }}
      >
        <RichText text={text} color={color} highlightColor={highlightColor ?? color} reveal={reveal} />
      </div>
    </div>
  );
};
