import { errorDialog } from './Dialogs';
import { ChevronRight, type LucideIcon } from 'lucide-react';
import React, { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Ic } from '../icons';

export const Field: React.FC<{ label?: React.ReactNode; hint?: React.ReactNode; children: React.ReactNode; style?: React.CSSProperties }> = ({
  label,
  hint,
  children,
  style,
}) => (
  <div className="field" style={style}>
    {label ? <label>{label}</label> : null}
    {children}
    {hint ? <div className="hint">{hint}</div> : null}
  </div>
);

/** 入力中はローカル状態、入力ごとに軽く反映。bare=枠なし（グループの行の中で使う） */
export const Text: React.FC<{
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
  bare?: boolean;
  className?: string;
  autoFocus?: boolean;
}> = ({ value, onChange, placeholder, multiline, rows = 2, bare, className = '', autoFocus }) => {
  const [local, setLocal] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value ?? '');
  }, [value]);
  const common = {
    value: local,
    placeholder,
    autoFocus,
    onFocus: () => (focused.current = true),
    onBlur: () => {
      focused.current = false;
      if (local !== (value ?? '')) onChange(local);
    },
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
      setLocal(e.target.value);
      onChange(e.target.value);
    },
  };
  const cls = `${bare ? 'bare ' : ''}${className}`;
  return multiline ? <textarea className={`textarea ${cls}`} rows={rows} {...common} /> : <input className={`input ${cls}`} {...common} />;
};

export const Num: React.FC<{ value: number | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number; style?: React.CSSProperties; placeholder?: string }> = ({
  value,
  onChange,
  step = 1,
  min,
  max,
  style,
  placeholder,
}) => (
  <input
    className="input"
    type="number"
    value={value ?? ''}
    step={step}
    min={min}
    max={max}
    placeholder={placeholder}
    style={style}
    onChange={(e) => {
      const n = Number(e.target.value);
      if (!Number.isNaN(n)) onChange(n);
    }}
  />
);

export function Select<T extends string>({
  value,
  onChange,
  options,
  style,
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: readonly (T | { value: T; label: string })[];
  style?: React.CSSProperties;
}) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value as T)} style={style}>
      {options.map((o) => {
        const v = typeof o === 'string' ? o : o.value;
        const l = typeof o === 'string' ? o : o.label;
        return (
          <option key={v} value={v}>
            {l}
          </option>
        );
      })}
    </select>
  );
}

/** iOS 風のスイッチ */
export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode; disabled?: boolean }> = ({ checked, onChange, label, disabled }) => (
  <label className="switch" style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
    {label}
    <input type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    <span className="track" />
  </label>
);

export const Slider: React.FC<{
  value: number;
  onChange: (v: number) => void;
  min: number;
  max: number;
  step?: number;
  format?: (v: number) => string;
  disabled?: boolean;
}> = ({ value, onChange, min, max, step = 0.01, format = (v) => `${Math.round(v * 100)}%`, disabled }) => {
  const pct = ((Math.min(max, Math.max(min, value)) - min) / (max - min)) * 100;
  return (
    <div className="slider" style={disabled ? { opacity: 0.4, pointerEvents: 'none' } : undefined}>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        style={{ '--pct': `${pct}%` } as React.CSSProperties}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      <span className="value">{format(value)}</span>
    </div>
  );
};

export function Seg<T extends string>({
  value,
  onChange,
  options,
  block,
  size,
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode; icon?: LucideIcon; title?: string }[];
  block?: boolean;
  size?: 'lg';
}) {
  return (
    <div className={`seg ${block ? 'block' : ''} ${size ?? ''}`} role="radiogroup">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          className={o.value === value ? 'on' : ''}
          title={o.title}
          onClick={() => onChange(o.value)}
        >
          {o.icon ? <Ic n={o.icon} size={13} mr={0} /> : null}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const FilePick: React.FC<{
  accept: string;
  onFile: (f: File) => void | Promise<unknown>;
  children: React.ReactNode;
  className?: string;
  multiple?: boolean;
  title?: string;
  disabled?: boolean;
}> = ({ accept, onFile, children, className = 'btn sm', multiple, title, disabled }) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} title={title} disabled={disabled} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        multiple={multiple}
        style={{ display: 'none' }}
        onChange={(e) => {
          const files = Array.from(e.target.files ?? []);
          // アップロードの失敗（大きすぎるファイル・通信エラーなど）を黙って捨てない
          for (const f of files) Promise.resolve(onFile(f)).catch((err) => errorDialog('ファイルを読み込めませんでした', err));
          e.target.value = '';
        }}
      />
    </>
  );
};

export const Progress: React.FC<{ value: number }> = ({ value }) => (
  <div className="progress">
    <div style={{ width: `${Math.round(Math.max(0.02, value) * 100)}%` }} />
  </div>
);

/* ---------- まとまり（システム設定風） ---------- */

export const Section: React.FC<{ title?: React.ReactNode; right?: React.ReactNode; children: React.ReactNode; footer?: React.ReactNode }> = ({ title, right, children, footer }) => (
  <>
    {title ? (
      <div className="section-title">
        {title}
        {right ? (
          <>
            <span className="spacer" />
            {right}
          </>
        ) : null}
      </div>
    ) : null}
    {children}
    {footer ? <div className="hint" style={{ margin: '7px 4px 0' }}>{footer}</div> : null}
  </>
);

/** グループの中の1行。stack=ラベルを上に置く（文章の入力など） */
export const Cell: React.FC<{
  label?: React.ReactNode;
  sub?: React.ReactNode;
  stack?: boolean;
  children?: React.ReactNode;
  onClick?: () => void;
  className?: string;
  style?: React.CSSProperties;
}> = ({ label, sub, stack, children, onClick, className = '', style }) => (
  <div className={`cell ${stack ? 'stack' : ''} ${onClick ? 'clickable' : ''} ${className}`} onClick={onClick} style={style}>
    {label !== undefined ? (
      <div className="cell-label">
        {label}
        {sub ? <span className="sub">{sub}</span> : null}
      </div>
    ) : null}
    {children}
  </div>
);

/** 開閉できる詳細。plain=グループの外で使う控えめな見た目 */
export const Disclosure: React.FC<{
  summary: React.ReactNode;
  children: React.ReactNode;
  defaultOpen?: boolean;
  plain?: boolean;
  right?: React.ReactNode;
}> = ({ summary, children, defaultOpen, plain, right }) => {
  const [open, setOpen] = useState(Boolean(defaultOpen));
  return (
    <details className={`disclosure ${plain ? 'plain' : ''}`} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary>
        <span className="chev" style={{ display: 'inline-flex' }}>
          <Ic n={ChevronRight} size={13} mr={0} />
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>{summary}</span>
        {right}
      </summary>
      {open ? <div className="disclosure-body">{children}</div> : null}
    </details>
  );
};

/* ---------- ポップオーバー（メニュー） ---------- */

/**
 * ボタンの近くに出すメニュー。親の overflow に切られないよう body に描く。
 * 外側クリック・Esc・スクロールで閉じる。
 */
export const Popover: React.FC<{
  button: (p: { open: boolean; toggle: () => void }) => React.ReactNode;
  children: (close: () => void) => React.ReactNode;
  align?: 'left' | 'right';
  width?: number;
  glass?: boolean;
}> = ({ button, children, align = 'left', width, glass }) => {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) return;
    const place = () => {
      const a = anchor.current?.getBoundingClientRect();
      const m = menu.current;
      if (!a || !m) return;
      const mw = m.offsetWidth;
      const mh = m.offsetHeight;
      let left = align === 'right' ? a.right - mw : a.left;
      left = Math.max(8, Math.min(window.innerWidth - mw - 8, left));
      let top = a.bottom + 6;
      if (top + mh > window.innerHeight - 8) top = Math.max(8, a.top - mh - 6);
      setPos({ left, top });
    };
    place();
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menu.current?.contains(t) || anchor.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    const onScroll = (e: Event) => {
      if (menu.current?.contains(e.target as Node)) return;
      setOpen(false);
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
      window.removeEventListener('resize', close);
    };
  }, [open, align, close]);

  return (
    <span className="popover-anchor" ref={anchor} onClick={(e) => e.stopPropagation()}>
      {button({ open, toggle: () => setOpen((v) => !v) })}
      {open
        ? createPortal(
            <div
              ref={menu}
              className={`menu ${glass ? 'glass' : ''}`}
              style={{ position: 'fixed', left: pos?.left ?? -9999, top: pos?.top ?? -9999, width, zIndex: 1200 }}
              onClick={(e) => e.stopPropagation()}
            >
              {children(close)}
            </div>,
            document.body,
          )
        : null}
    </span>
  );
};

export const MenuItem: React.FC<{
  icon?: LucideIcon;
  onClick: () => void;
  children: React.ReactNode;
  sub?: React.ReactNode;
  danger?: boolean;
  disabled?: boolean;
}> = ({ icon, onClick, children, sub, danger, disabled }) => (
  <button type="button" className={`menu-item ${danger ? 'danger' : ''}`} onClick={onClick} disabled={disabled}>
    {icon ? <Ic n={icon} size={15} mr={0} /> : null}
    {sub ? (
      <span className="menu-body">
        <span>{children}</span>
        <span className="menu-sub">{sub}</span>
      </span>
    ) : (
      <span>{children}</span>
    )}
  </button>
);

/* ---------- シート（モーダル） ---------- */

export const Sheet: React.FC<{ onClose?: () => void; wide?: boolean; children: React.ReactNode; style?: React.CSSProperties }> = ({ onClose, wide, children, style }) => {
  useEffect(() => {
    if (!onClose) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return createPortal(
    <div className="sheet-backdrop" onClick={onClose}>
      <div className={`sheet ${wide ? 'wide' : ''}`} style={style} onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true">
        {children}
      </div>
    </div>,
    document.body,
  );
};
