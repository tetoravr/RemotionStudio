import React, { useEffect, useRef, useState } from 'react';

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

/** 入力中はローカル状態、確定（blur/Enter）で onChange ではなく、入力ごとに軽く反映 */
export const Text: React.FC<{
  value: string | undefined;
  onChange: (v: string) => void;
  placeholder?: string;
  multiline?: boolean;
  rows?: number;
}> = ({ value, onChange, placeholder, multiline, rows = 2 }) => {
  const [local, setLocal] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setLocal(value ?? '');
  }, [value]);
  const common = {
    value: local,
    placeholder,
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
  return multiline ? <textarea className="textarea" rows={rows} {...common} /> : <input className="input" {...common} />;
};

export const Num: React.FC<{ value: number | undefined; onChange: (v: number) => void; step?: number; min?: number; max?: number }> = ({
  value,
  onChange,
  step = 1,
  min,
  max,
}) => (
  <input
    className="input"
    type="number"
    value={value ?? ''}
    step={step}
    min={min}
    max={max}
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
}: {
  value: T | undefined;
  onChange: (v: T) => void;
  options: readonly (T | { value: T; label: string })[];
}) {
  return (
    <select className="select" value={value ?? ''} onChange={(e) => onChange(e.target.value as T)}>
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

export const Toggle: React.FC<{ checked: boolean; onChange: (v: boolean) => void; label?: React.ReactNode }> = ({ checked, onChange, label }) => (
  <label className="toggle">
    <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
    <span className="track" />
    {label}
  </label>
);

export const Slider: React.FC<{ value: number; onChange: (v: number) => void; min: number; max: number; step?: number; format?: (v: number) => string }> = ({
  value,
  onChange,
  min,
  max,
  step = 0.01,
  format = (v) => `${Math.round(v * 100)}%`,
}) => (
  <div className="row center tight">
    <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} style={{ flex: 1 }} />
    <span className="faint" style={{ flex: '0 0 44px', textAlign: 'right' }}>
      {format(value)}
    </span>
  </div>
);

export function Seg<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: string }[] }) {
  return (
    <div className="seg">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)} type="button">
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const FilePick: React.FC<{ accept: string; onFile: (f: File) => void; children: React.ReactNode; className?: string }> = ({
  accept,
  onFile,
  children,
  className = 'btn sm',
}) => {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <>
      <button type="button" className={className} onClick={() => ref.current?.click()}>
        {children}
      </button>
      <input
        ref={ref}
        type="file"
        accept={accept}
        style={{ display: 'none' }}
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) onFile(f);
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
