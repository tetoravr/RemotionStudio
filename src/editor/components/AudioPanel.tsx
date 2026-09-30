import { Music } from 'lucide-react';
import React, { useContext } from 'react';
import type { Project } from '../../video/schema';
import { api, ttsFor } from '../api';
import { MetaContext } from '../App';
import { Ic } from '../icons';
import type { RunJob, Update } from '../pages/Editor';
import { Cell, Disclosure, FilePick, Num, Section, Seg, Slider, Toggle } from './Fields';
import { NarrationList } from './NarrationList';

export const AudioPanel: React.FC<{ project: Project; update: Update; runJob: RunJob; onSelectScene?: (i: number) => void }> = ({ project, update, runJob, onSelectScene }) => {
  const a = project.audio;
  const meta = useContext(MetaContext)!;
  const tts = ttsFor(meta, a.ttsProvider);
  const ir = meta.tts.irodori;
  const bgmMode = a.bgm === 'none' ? 'none' : a.bgm ? 'custom' : 'default';
  const uploadBgm = async (f: File) => {
    const { path } = await api.upload(project.id, f);
    update((p) => void (p.audio.bgm = path));
  };
  return (
    <div>
      <Section title="ナレーション">
        <div className="group">
          <Cell label="セリフを声で読み上げる">
            <Toggle checked={a.narration} onChange={(v) => update((p) => void (p.audio.narration = v))} />
          </Cell>
          <Cell
            label="音声エンジン"
            sub={
              tts.provider === 'irodori'
                ? ir.online
                  ? `Irodori-TTS${ir.device === 'cpu' ? ' ・ GPUなし（1セリフ30〜60秒）' : ''}`
                  : 'Irodori-TTS ・ npm run irodori で起動してください'
                : 'OpenAI TTS'
            }
          >
            <span className={`badge ${tts.ready ? 'ok' : 'danger'}`}>
              <span className={`dot ${tts.ready ? 'ok' : 'danger'}`} />
              {tts.ready ? '接続中' : '未接続'}
            </span>
          </Cell>
          <Cell label="音量" stack>
            <Slider value={a.narrationVolume} min={0} max={1} disabled={!a.narration} onChange={(v) => update((p) => void (p.audio.narrationVolume = v))} />
          </Cell>
          <Cell label="字幕を常に表示" sub="音を出さずに見る人のために、すべてのセリフを字幕でも出します">
            <Toggle checked={project.subtitles} onChange={(v) => update((p) => void (p.subtitles = v))} />
          </Cell>
        </div>
      </Section>

      {a.narration ? (
        <Section title="セリフの音声">
          <NarrationList project={project} runJob={runJob} onSelectScene={onSelectScene} />
        </Section>
      ) : null}

      <Section title="BGM" footer="セリフの間は自動で音量が下がります">
        <div className="group">
          <Cell>
            <Seg
              block
              value={bgmMode}
              onChange={(v) => {
                if (v === 'default') update((p) => void (p.audio.bgm = undefined));
                if (v === 'none') update((p) => void (p.audio.bgm = 'none'));
              }}
              options={[
                { value: 'default', label: '組み込み' },
                { value: 'none', label: 'なし' },
                ...(bgmMode === 'custom' ? [{ value: 'custom' as const, label: 'ファイル' }] : []),
              ]}
            />
          </Cell>
          <Cell label={bgmMode === 'custom' ? a.bgm!.split('/').pop() : '手持ちの曲を使う'} sub={bgmMode === 'default' ? '組み込み: 150BPMのポップな曲' : undefined}>
            <FilePick accept="audio/*" onFile={uploadBgm}>
              <Ic n={Music} size={13} mr={0} />
              {bgmMode === 'custom' ? '変更…' : '選ぶ…'}
            </FilePick>
          </Cell>
          <Cell label="音量" stack>
            <Slider value={a.bgmVolume} min={0} max={1} disabled={bgmMode === 'none'} onChange={(v) => update((p) => void (p.audio.bgmVolume = v))} />
          </Cell>
        </div>
      </Section>

      <Section title="効果音">
        <div className="group">
          <Cell label="自動で効果音を付ける" sub="ポップ・ワイプ・インパクトなど">
            <Toggle checked={a.sfx} onChange={(v) => update((p) => void (p.audio.sfx = v))} />
          </Cell>
          <Cell label="音量" stack>
            <Slider value={a.sfxVolume} min={0} max={1} disabled={!a.sfx} onChange={(v) => update((p) => void (p.audio.sfxVolume = v))} />
          </Cell>
        </div>
      </Section>

      <Section title="詳細">
        <div className="group">
          <Disclosure summary="テンポとフレームレート">
            <div className="kv">
              <span>BPM</span>
              <div className="hstack">
                <Num value={a.bpm} min={0} max={240} onChange={(v) => update((p) => void (p.audio.bpm = v))} style={{ width: 90 }} />
                <span className="caption">シーンの切り替えを曲のビートに合わせます（0で無効）</span>
              </div>
            </div>
            <div className="kv">
              <span>fps</span>
              <div className="hstack">
                <Num value={project.fps} min={24} max={60} onChange={(v) => update((p) => void (p.fps = Math.round(v)))} style={{ width: 90 }} />
                <span className="caption">1秒あたりのコマ数</span>
              </div>
            </div>
          </Disclosure>
        </div>
      </Section>
    </div>
  );
};
