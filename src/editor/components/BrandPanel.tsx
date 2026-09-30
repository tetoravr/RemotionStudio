import { ImagePlus } from 'lucide-react';
import React from 'react';
import type { Project } from '../../video/schema';
import { api } from '../api';
import { Ic } from '../icons';
import type { Update } from '../pages/Editor';
import { Cell, Disclosure, FilePick, Section, Text } from './Fields';

const PRESETS: { name: string; colors: Project['brand']['colors'] }[] = [
  { name: 'ブルー', colors: { primary: '#1f5cff', dark: '#0d1b5e', accent: '#ffd93b', light: '#eaf0ff', text: '#15172b' } },
  { name: 'オレンジ', colors: { primary: '#ff6900', dark: '#231f20', accent: '#ffd43b', light: '#fff5ee', text: '#231f20' } },
  { name: 'グリーン', colors: { primary: '#12b76a', dark: '#073b2c', accent: '#ffd43b', light: '#e6f8ee', text: '#10231b' } },
  { name: 'ピンク', colors: { primary: '#ff4f8b', dark: '#4a0d2a', accent: '#ffe066', light: '#fff0f5', text: '#2b0f1c' } },
  { name: 'パープル', colors: { primary: '#7c4dff', dark: '#1f0f5c', accent: '#35e0c2', light: '#f1ecff', text: '#1a1233' } },
  { name: 'レッド', colors: { primary: '#e60033', dark: '#3a0010', accent: '#ffd400', light: '#fff0f2', text: '#260008' } },
];

const COLOR_LABELS: [keyof Project['brand']['colors'], string][] = [
  ['primary', 'メイン'],
  ['accent', '差し色'],
  ['dark', 'フチ'],
  ['light', '背景'],
  ['text', '文字'],
];

const FONTS: { value: Project['brand']['font']; name: string; family: string; weight: number }[] = [
  { value: 'noto', name: 'ゴシック', family: '"Noto Sans JP", sans-serif', weight: 900 },
  { value: 'rounded', name: '丸ゴシック', family: '"M PLUS Rounded 1c", sans-serif', weight: 800 },
  { value: 'dela', name: '極太ポップ', family: '"Dela Gothic One", sans-serif', weight: 400 },
];

const same = (a: Project['brand']['colors'], b: Project['brand']['colors']) =>
  (Object.keys(a) as (keyof typeof a)[]).every((k) => a[k].toLowerCase() === b[k].toLowerCase());

export const BrandPanel: React.FC<{ project: Project; update: Update }> = ({ project, update }) => {
  const b = project.brand;
  const preset = PRESETS.find((p) => same(p.colors, b.colors));
  return (
    <div>
      <Section title="ブランド" footer="[[ ]] で囲んだ文字はブランドカラーになります">
        <div className="group">
          <Cell label="商品・ブランド名" stack>
            <Text bare value={b.name} onChange={(v) => update((p) => void (p.brand.name = v))} />
          </Cell>
          <Cell label="タグライン" stack>
            <Text bare multiline rows={1} value={b.tagline} onChange={(v) => update((p) => void (p.brand.tagline = v))} placeholder="なし" />
          </Cell>
          <Cell label="ロゴ画像" sub={b.logo ? 'ロゴとエンドカードで文字の代わりに表示' : '未設定のときは文字のロゴになります（透過PNG推奨）'}>
            {b.logo ? <img src={`/files/${project.id}/${b.logo}`} alt="" className="thumb-img" style={{ height: 36, background: '#fff', padding: 3 }} /> : null}
            <FilePick
              accept="image/*"
              onFile={async (f) => {
                const { path } = await api.upload(project.id, f);
                update((p) => void (p.brand.logo = path));
              }}
            >
              <Ic n={ImagePlus} size={13} mr={0} />
              {b.logo ? '変更…' : '選ぶ…'}
            </FilePick>
            {b.logo ? (
              <button className="btn sm plain danger" onClick={() => update((p) => void (p.brand.logo = undefined))}>
                外す
              </button>
            ) : null}
          </Cell>
        </div>
      </Section>

      <Section title="カラー">
        <div className="group">
          <Cell>
            <div className="swatches">
              {PRESETS.map((pr) => (
                <button
                  key={pr.name}
                  type="button"
                  className={`swatch ${preset === pr ? 'on' : ''}`}
                  title={pr.name}
                  style={{ background: pr.colors.primary }}
                  onClick={() => update((p) => void (p.brand.colors = { ...pr.colors }))}
                >
                  <span className="half" style={{ background: pr.colors.accent }} />
                </button>
              ))}
            </div>
            <span className="spacer" />
            <span className="caption">{preset?.name ?? 'カスタム'}</span>
          </Cell>
          <Disclosure summary="色を細かく調整">
            <div className="color-wells">
              {COLOR_LABELS.map(([k, l]) => (
                <label className="color-well" key={k}>
                  <input type="color" value={b.colors[k]} onChange={(e) => update((p) => void (p.brand.colors[k] = e.target.value))} />
                  {l}
                </label>
              ))}
            </div>
          </Disclosure>
        </div>
      </Section>

      <Section title="フォント">
        <div className="font-options">
          {FONTS.map((f) => (
            <button key={f.value} type="button" className={`font-option ${b.font === f.value ? 'on' : ''}`} onClick={() => update((p) => void (p.brand.font = f.value))}>
              <span className="sample" style={{ fontFamily: f.family, fontWeight: f.weight }}>
                Aaあ
              </span>
              <span className="fname">{f.name}</span>
            </button>
          ))}
        </div>
      </Section>
    </div>
  );
};
