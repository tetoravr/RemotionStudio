import type { Line, Project, Scene, SceneType } from './schema';

export type LineTiming = {
  line: Line;
  /** シーン先頭からのフレーム */
  start: number;
  end: number;
  /** 次のセリフ開始 or シーン終了まで（吹き出しの表示終了） */
  visibleUntil: number;
};

export type SceneTiming = {
  scene: Scene;
  index: number;
  /** 動画先頭からのフレーム */
  start: number;
  duration: number;
  lines: LineTiming[];
};

export type Timeline = {
  fps: number;
  scenes: SceneTiming[];
  total: number;
};

const LEAD_IN: Record<SceneType, number> = { logo: 0.25, talk: 0.2, feature: 0.3, showcase: 0.3, cta: 0.4 };
const MIN_DURATION: Record<SceneType, number> = { logo: 1.8, talk: 1.5, feature: 2.2, showcase: 2.4, cta: 3.0 };
const TAIL_SEC = 0.18;
const LINE_GAP_SEC = 0.08;
const END_HOLD_SEC = 1.0;

export const stripMarkup = (text: string) => text.replace(/\[\[|\]\]/g, '');

/** 音声が無いときの読み上げ時間の推定（日本語 ≒ 7〜8文字/秒） */
export const estimateSpeechSec = (text: string, speed = 1.1): number => {
  const clean = stripMarkup(text).replace(/[\s、。！？!?…・「」『』（）()ー〜~]/g, '');
  const punct = (text.match(/[、。！？!?…]/g) ?? []).length;
  return Math.max(0.6, (clean.length * 0.125 + punct * 0.08) / speed);
};

export const lineDurationSec = (line: Line, project: Project): number => {
  if (project.audio.narration && line.audio && line.audio.durationSec > 0) return line.audio.durationSec;
  const speaker = project.cast.find((c) => c.id === line.speaker);
  return estimateSpeechSec(line.speak || line.text, speaker?.voice.speed ?? 1.1);
};

export const computeTimeline = (project: Project): Timeline => {
  const { fps } = project;
  const bpm = project.audio.bpm;
  // 8分音符単位でカットを合わせる
  const beatSec = bpm > 0 ? 60 / bpm / 2 : 0;

  const scenes: SceneTiming[] = [];
  let cursorSec = 0;
  let cursorFrame = 0;

  project.scenes.forEach((scene, index) => {
    const lead = LEAD_IN[scene.type];
    let t = lead;
    const raw: { line: Line; startSec: number; endSec: number }[] = [];
    for (const line of scene.lines) {
      const d = lineDurationSec(line, project);
      raw.push({ line, startSec: t, endSec: t + d });
      t += d + LINE_GAP_SEC + (line.pauseAfterSec ?? 0);
    }
    const isLast = index === project.scenes.length - 1;
    const speechEnd = t - LINE_GAP_SEC;
    let durSec = Math.max(speechEnd + TAIL_SEC, scene.minDurationSec ?? MIN_DURATION[scene.type]);
    if (isLast) durSec += END_HOLD_SEC;

    // シーン境界を最寄りのビートに吸着（BGMとカットを同期させる）。セリフは切らない
    let endSec = cursorSec + durSec;
    if (beatSec > 0) {
      let snapped = Math.round(endSec / beatSec) * beatSec;
      while (snapped < cursorSec + speechEnd + 0.12) snapped += beatSec;
      endSec = snapped;
    }
    if (endSec - cursorSec < 0.8) endSec = cursorSec + Math.max(0.8, durSec);

    const endFrame = Math.round(endSec * fps);
    const duration = Math.max(1, endFrame - cursorFrame);

    const lines: LineTiming[] = raw.map((r, i) => {
      const start = Math.round(r.startSec * fps);
      const end = Math.max(start + 1, Math.round(r.endSec * fps));
      return { line: r.line, start, end, visibleUntil: duration };
    });
    // 吹き出しは次の「同じ位置に出る」セリフが出るまで表示
    lines.forEach((lt, i) => {
      const next = lines.slice(i + 1).find((n) => n.line.style !== 'none');
      lt.visibleUntil = next ? next.start + 6 : duration;
    });

    scenes.push({ scene, index, start: cursorFrame, duration, lines });
    cursorFrame = endFrame;
    cursorSec = endSec;
  });

  return { fps, scenes, total: Math.max(1, cursorFrame) };
};

/** キャラクターがこのフレームで喋っているか */
export const speakingLine = (lines: LineTiming[], speaker: string, frame: number) =>
  lines.find((l) => l.line.speaker === speaker && frame >= l.start && frame < l.end);

/** 話者の現在のポーズ（セリフ指定 > シーン指定） */
export const currentPose = (lines: LineTiming[], speaker: string, frame: number, fallback: string) => {
  let pose = fallback;
  for (const l of lines) {
    if (l.line.speaker === speaker && l.line.pose && frame >= l.start) pose = l.line.pose;
  }
  return pose;
};
