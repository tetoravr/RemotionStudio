import React, { useContext } from 'react';
import type { Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import type { RunJob, Update } from '../pages/Editor';
import { Field, FilePick, Num, Slider, Toggle } from './Fields';

export const AudioPanel: React.FC<{ project: Project; update: Update; runJob: RunJob }> = ({ project, update, runJob }) => {
  const a = project.audio;
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, a.ttsProvider);
  const ir = meta.tts.irodori;
  const bgmMode = a.bgm === 'none' ? 'none' : a.bgm ? 'custom' : 'default';
  return (
    <div>
      <div className="section">
        <div className="section-title">BGM</div>
        <div className="chips" style={{ marginBottom: 10 }}>
          <button className={`chip ${bgmMode === 'default' ? 'on' : ''}`} onClick={() => update((p) => void (p.audio.bgm = undefined))}>
            組み込み（150BPM ポップ）
          </button>
          <button className={`chip ${bgmMode === 'none' ? 'on' : ''}`} onClick={() => update((p) => void (p.audio.bgm = 'none'))}>
            なし
          </button>
          <FilePick
            accept="audio/*"
            className={`chip ${bgmMode === 'custom' ? 'on' : ''}`}
            onFile={async (f) => {
              const { path } = await api.upload(project.id, f);
              update((p) => void (p.audio.bgm = path));
            }}
          >
            {bgmMode === 'custom' ? `🎵 ${a.bgm!.split('/').pop()}` : 'ファイルをアップロード'}
          </FilePick>
        </div>
        <Field label="BGM音量（セリフ中は自動で下がります）">
          <Slider value={a.bgmVolume} min={0} max={1} onChange={(v) => update((p) => void (p.audio.bgmVolume = v))} />
        </Field>
        <Field label="BPM（シーンの切り替えをビートに合わせる / 0で無効）" hint="アップロードしたBGMを使う場合はその曲のBPMを入れてください">
          <Num value={a.bpm} min={0} max={240} onChange={(v) => update((p) => void (p.audio.bpm = v))} />
        </Field>
      </div>
      <div className="section">
        <div className="section-title">効果音</div>
        <Toggle checked={a.sfx} onChange={(v) => update((p) => void (p.audio.sfx = v))} label="自動で効果音を付ける（ポップ・ワイプ・インパクト等）" />
        <div style={{ height: 10 }} />
        <Field label="効果音の音量">
          <Slider value={a.sfxVolume} min={0} max={1} onChange={(v) => update((p) => void (p.audio.sfxVolume = v))} />
        </Field>
      </div>
      <div className="section">
        <div className="section-title">ナレーション・字幕</div>
        <Toggle checked={a.narration} onChange={(v) => update((p) => void (p.audio.narration = v))} label="セリフを音声で読み上げる" />
        <div style={{ height: 10 }} />
        <Field label="音声合成エンジン" hint="日本語の自然さは Irodori-TTS がおすすめ（ローカルで動かします。GPU推奨）。エンジンを変えると音声は作り直しになります">
          <div className="chips">
            {(
              [
                ['auto', `自動（現在: ${meta.tts.default === 'irodori' ? 'Irodori-TTS' : 'OpenAI TTS'}）`],
                ['irodori', 'Irodori-TTS'],
                ['openai', 'OpenAI TTS'],
              ] as const
            ).map(([v, label]) => (
              <button key={v} className={`chip ${a.ttsProvider === v ? 'on' : ''}`} onClick={() => update((p) => void (p.audio.ttsProvider = v))}>
                {label}
              </button>
            ))}
          </div>
        </Field>
        {tts.provider === 'irodori' ? (
          ir.online ? (
            <div className="notice" style={{ marginBottom: 10 }}>
              ✅ Irodori-TTS に接続中（{ir.url} ／ {ir.checkpoint?.split('/').pop() ?? 'モデル不明'} ／ {ir.device ?? '?'}）
              {ir.device === 'cpu' ? ' — GPUなしのため1セリフの生成に30〜60秒かかります' : ''}
            </div>
          ) : (
            <div className="error" style={{ marginBottom: 10 }}>
              Irodori-TTS サーバー（{ir.url}）に接続できません。ターミナルで <code>npm run irodori</code> を実行して起動してから、このページを開き直してください。
            </div>
          )
        ) : !meta.openai ? (
          <div className="error" style={{ marginBottom: 10 }}>OPENAI_API_KEY が未設定です。</div>
        ) : null}
        <Field label="ナレーション音量">
          <Slider value={a.narrationVolume} min={0} max={1} onChange={(v) => update((p) => void (p.audio.narrationVolume = v))} />
        </Field>
        <Toggle checked={project.subtitles} onChange={(v) => update((p) => void (p.subtitles = v))} label="全セリフを字幕でも表示（音なし再生対策）" />
        <div style={{ height: 12 }} />
        <button
          className="btn sm"
          onClick={() =>
            confirm('すべてのセリフの音声を作り直しますか？') &&
            runJob('ナレーションを作り直しています', `/api/projects/${project.id}/narration`, { force: true })
          }
        >
          すべての音声を作り直す
        </button>
      </div>
      <div className="section">
        <div className="section-title">動画</div>
        <Field label="フレームレート">
          <Num value={project.fps} min={24} max={60} onChange={(v) => update((p) => void (p.fps = Math.round(v)))} />
        </Field>
      </div>
    </div>
  );
};
