import React, { useMemo } from 'react';
import { Audio, interpolate, Sequence, staticFile, useVideoConfig } from 'remotion';
import { collectSfx } from './events';
import { useTheme } from './theme';
import type { Timeline } from './timeline';

export const DEFAULT_BGM = 'audio/bgm-pop.mp3';

export const AudioTrack: React.FC<{ timeline: Timeline; mutedLines?: string[] }> = ({ timeline, mutedLines }) => {
  const { project, resolveAsset } = useTheme();
  const { fps, durationInFrames } = useVideoConfig();
  const a = project.audio;

  const voiceRanges = useMemo(() => {
    const r: [number, number][] = [];
    if (!a.narration) return r;
    for (const st of timeline.scenes) for (const lt of st.lines) if (lt.line.audio) r.push([st.start + lt.start, st.start + lt.end]);
    return r;
  }, [timeline, a.narration]);

  const sfx = useMemo(() => (a.sfx ? collectSfx(timeline, project) : []), [timeline, project, a.sfx]);

  const bgmSrc = a.bgm === 'none' ? null : a.bgm ? resolveAsset(a.bgm) : staticFile(DEFAULT_BGM);

  return (
    <>
      {bgmSrc ? (
        <Audio
          src={bgmSrc}
          loop
          volume={(f) => {
            const fade = interpolate(f, [0, 4, durationInFrames - fps * 1.2, durationInFrames - 1], [0, 1, 1, 0], {
              extrapolateLeft: 'clamp',
              extrapolateRight: 'clamp',
            });
            // セリフ中はBGMを下げる（ダッキング）
            let duck = 1;
            for (const [s, e] of voiceRanges) {
              const d = interpolate(f, [s - 4, s, e, e + 6], [1, 0.5, 0.5, 1], { extrapolateLeft: 'clamp', extrapolateRight: 'clamp' });
              duck = Math.min(duck, d);
            }
            return a.bgmVolume * fade * duck;
          }}
        />
      ) : null}
      {a.narration
        ? timeline.scenes.flatMap((st) =>
            st.lines
              .filter((lt) => lt.line.audio && !mutedLines?.includes(lt.line.id))
              .map((lt) => (
                // 音声が変わったら作り直す（同じ要素の src だけを差し替えると、前の音声が鳴り続けることがある）
                <Sequence key={`${st.scene.id}-${lt.line.id}-${lt.line.audio!.src}`} from={st.start + lt.start} durationInFrames={Math.max(1, lt.end - lt.start + 6)} layout="none">
                  <Audio src={resolveAsset(lt.line.audio!.src)!} volume={a.narrationVolume} acceptableTimeShiftInSeconds={1} />
                </Sequence>
              )),
          )
        : null}
      {sfx.map((e, i) => (
        <Sequence key={`sfx-${i}`} from={e.frame} durationInFrames={Math.round(fps * 1.6)} layout="none">
          <Audio src={staticFile(`audio/sfx/${e.kind}.wav`)} volume={a.sfxVolume * (e.volume ?? 1)} />
        </Sequence>
      ))}
    </>
  );
};
