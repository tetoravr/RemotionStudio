import React from 'react';
import type { Project } from '../../video/schema';
import { api } from '../api';
import type { Update } from '../pages/Editor';
import { Field, FilePick, Seg, Text } from './Fields';

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
  ['dark', '濃色・フチ'],
  ['accent', '差し色'],
  ['light', '淡い背景'],
  ['text', '文字'],
];

export const BrandPanel: React.FC<{ project: Project; update: Update }> = ({ project, update }) => {
  const b = project.brand;
  return (
    <div>
      <div className="section">
        <div className="section-title">ブランド</div>
        <Field label="商品・ブランド名">
          <Text value={b.name} onChange={(v) => update((p) => void (p.brand.name = v))} />
        </Field>
        <Field label="タグライン" hint="[[ ]] で強調">
          <Text value={b.tagline} onChange={(v) => update((p) => void (p.brand.tagline = v))} multiline />
        </Field>
        <Field label="ロゴ画像（任意）" hint="透過PNG推奨。設定するとロゴシーンとエンドカードで文字の代わりに表示されます">
          <div className="row center">
            {b.logo ? <img src={`/files/${project.id}/${b.logo}`} alt="" style={{ height: 44, flex: 'none', background: '#fff', borderRadius: 6, padding: 4 }} /> : <span className="faint">未設定（文字ロゴ）</span>}
            <FilePick accept="image/*" onFile={async (f) => {
              const { path } = await api.upload(project.id, f);
              update((p) => void (p.brand.logo = path));
            }}>
              アップロード
            </FilePick>
            {b.logo ? (
              <button className="btn sm ghost" onClick={() => update((p) => void (p.brand.logo = undefined))}>
                外す
              </button>
            ) : null}
          </div>
        </Field>
      </div>
      <div className="section">
        <div className="section-title">配色</div>
        <div className="color-row" style={{ marginBottom: 12 }}>
          {COLOR_LABELS.map(([k, l]) => (
            <div className="c" key={k}>
              <input type="color" value={b.colors[k]} onChange={(e) => update((p) => void (p.brand.colors[k] = e.target.value))} />
              {l}
            </div>
          ))}
        </div>
        <div className="chips">
          {PRESETS.map((pr) => (
            <button key={pr.name} className="chip" onClick={() => update((p) => void (p.brand.colors = { ...pr.colors }))}>
              <span style={{ display: 'inline-block', width: 10, height: 10, borderRadius: 3, background: pr.colors.primary, marginRight: 6 }} />
              {pr.name}
            </button>
          ))}
        </div>
      </div>
      <div className="section">
        <div className="section-title">フォント</div>
        <Seg
          value={b.font}
          onChange={(v) => update((p) => void (p.brand.font = v))}
          options={[
            { value: 'noto', label: 'ゴシック（標準）' },
            { value: 'rounded', label: '丸ゴシック' },
            { value: 'dela', label: '極太ポップ' },
          ]}
        />
      </div>
    </div>
  );
};
