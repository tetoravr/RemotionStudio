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
  /** 自動で決めた場合の長さ（秒・ビート吸着前） */
  autoSec: number;
  /** これより短くはできない長さ（秒）。最後のセリフを言い終わるまで */
  minSec: number;
  /** 長さを手で決めているか（scene.lengthSec） */
  fixed: boolean;
};

export type Timeline = {
  fps: number;
  scenes: SceneTiming[];
  total: number;
};

const LEAD_IN: Record<SceneType, number> = { logo: 0.25, talk: 0.2, feature: 0.3, showcase: 0.3, cta: 0.4 };
const MIN_DURATION: Record<SceneType, number> = { logo: 2.4, talk: 2.2, feature: 3.2, showcase: 3.6, cta: 4.2 };
/** 最後のセリフのあと、吹き出しや見出しを読める余韻 */
const TAIL_SEC = 0.6;

/**
 * トランジションで画面が隠れる時間（フレーム）。
 * in: 次のシーンの先頭が隠れる（この間はセリフも演出も始めない）
 * out: 前のシーンの末尾が隠れる（ワイプは切り替えの前から帯が画面を覆う）
 */
export const TRANSITION_COVER: Record<Scene['transition'], { in: number; out: number }> = {
  cut: { in: 0, out: 0 },
  flash: { in: 5, out: 0 },
  wipe: { in: 9, out: 11 },
  slide: { in: 6, out: 0 },
  zoom: { in: 6, out: 0 },
};

/** 音声ファイルの先頭にある無音（trimAndNormalize が残す 80ms）。声が実際に出始めるまでのずれ */
export const speechOnset = (fps: number) => Math.round(0.08 * fps);
const LINE_GAP_SEC = 0.15;
const END_HOLD_SEC = 1.5;

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


/**
 * 画面の文字を読むのにかかる時間（秒）。広告は「読めて、理解できる」ことが最優先なので、
 * 目に入って認識する 0.6 秒 ＋ 1秒あたり6文字 で見積もる（声より少し遅め）。
 */
/** 声で読み上げられる文字（吹き出し・字幕）は、耳でも追えるので少し速く読める */
export const readSpokenSec = (text: string | undefined) => {
  if (!text) return 0;
  const n = stripMarkup(text).replace(/[\s]/g, '').length;
  return n ? 0.5 + n / 8 : 0;
};

export const readSec = (text: string | undefined) => {
  if (!text) return 0;
  const n = stripMarkup(text).replace(/[\s]/g, '').length;
  return n ? 0.6 + n / 6 : 0;
};

const normText = (s: string) => stripMarkup(s).replace(/[\s、。！？!?…「」『』〜ー~・,.]/g, '');
const isBubble = (l: Line) => l.style === 'bubble' || l.style === 'bubble-accent' || l.style === 'caption';

/**
 * シーンの主役の文字（見出し・ロゴ・タイトルなど）が出てから、読み切るまでに必要な終了時刻（シーン先頭からの秒）。
 * 声に合わせて出る文字は、その声の開始から数える。
 */
const readingEnd = (scene: Scene, raw: { line: Line; startSec: number; endSec: number }[], lead: number, brand: string) => {
  const at = (text: string | undefined, fallback: number) => {
    const n = text ? normText(text) : '';
    const hit = n ? raw.find((r) => {
      const m = normText(r.line.text);
      return m && (m.includes(n) || n.includes(m));
    }) : undefined;
    return hit ? hit.startSec : fallback;
  };
  const ends: number[] = [];
  // 吹き出し・字幕は、最後のものを読み切るまで
  for (const r of raw) if (isBubble(r.line)) ends.push(Math.max(r.endSec + 0.5, r.startSec + readSpokenSec(r.line.text)));
  switch (scene.type) {
    case 'logo': {
      const logoAt = at(scene.logoText || brand, lead);
      ends.push(logoAt + 1.3); // ブランド名は叩きつけてから最低1.3秒見せる
      if (scene.subtitle) ends.push(logoAt + 0.4 + readSec(scene.subtitle));
      break;
    }
    case 'talk':
      if (scene.headline) ends.push(lead + readSec(scene.headline));
      if (scene.prop?.image) ends.push(lead + 3.2 + readSec(scene.prop.label) * 0.5); // 図解は内容を見て理解する時間を取る
      else if (scene.prop) ends.push(lead + 0.8 + readSec(scene.prop.label) + 0.6);
      break;
    case 'feature': {
      const hl = at(scene.headline, lead + 1);
      // 見出しの叩きつけと図解の「決め」を見届けてから切り替える
      ends.push(hl + Math.max(1.4, readSec(scene.headline)));
      ends.push(lead + readSec(scene.eyebrow) + readSec(scene.headline));
      break;
    }
    case 'showcase':
      // 画面がスライドインして止まり、内容に目が行くまで
      ends.push(lead + 0.6 + Math.max(2.4, readSec(scene.title)));
      break;
    case 'cta':
      // ロゴ → ボタン → 連絡先 と順に出る。ボタン（行動の呼びかけ）を読み切れるまで
      ends.push(lead + 1.2 + readSec(scene.buttonText));
      break;
  }
  return Math.max(0, ...ends);
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
    const coverIn = index === 0 ? 0 : TRANSITION_COVER[scene.transition].in;
    const next = project.scenes[index + 1];
    const coverOut = next ? TRANSITION_COVER[next.transition].out : 0;
    // 入りのトランジションが抜けてから喋り始める
    const lead = Math.max(LEAD_IN[scene.type], (coverIn + 2) / fps - 0.08);
    let t = lead;
    const raw: { line: Line; startSec: number; endSec: number }[] = [];
    let lastBubble: { startSec: number; text: string } | null = null;
    for (const line of scene.lines) {
      const d = lineDurationSec(line, project);
      // 次の吹き出しで前の吹き出しが消えるので、前の吹き出しを読み切ってから次を出す
      if (lastBubble && isBubble(line)) t = Math.max(t, lastBubble.startSec + readSpokenSec(lastBubble.text));
      raw.push({ line, startSec: t, endSec: t + d });
      if (isBubble(line)) lastBubble = { startSec: t, text: line.text };
      t += d + LINE_GAP_SEC + (line.pauseAfterSec ?? 0);
    }
    const isLast = index === project.scenes.length - 1;
    const speechEnd = t - LINE_GAP_SEC;
    // 最後のセリフを読み終えて、次のワイプの帯がかかる前に余韻を残す
    const needEnd = Math.max(speechEnd + TAIL_SEC, readingEnd(scene, raw, lead, project.brand.name)) + coverOut / fps;
    let autoSec = Math.max(needEnd, scene.minDurationSec ?? MIN_DURATION[scene.type]);
    if (isLast) autoSec += END_HOLD_SEC;
    // 手で長さを決めた時も、最後のセリフの途中では切らない（次のワイプの帯がかかる分も残す）
    const hasSpeech = raw.length > 0;
    const minSec = Math.max(0.8, (hasSpeech ? speechEnd + 0.15 : 0) + coverOut / fps);
    const fixed = scene.lengthSec != null;
    const durSec = fixed ? Math.max(minSec, scene.lengthSec!) : autoSec;
    const mustEnd = fixed ? minSec : needEnd;

    // シーン境界を最寄りのビートに吸着（BGMとカットを同期させる）。セリフは切らない
    let endSec = cursorSec + durSec;
    if (beatSec > 0) {
      let snapped = Math.round(endSec / beatSec) * beatSec;
      while (snapped < cursorSec + mustEnd - 0.05) snapped += beatSec;
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

    scenes.push({ scene, index, start: cursorFrame, duration, lines, autoSec, minSec, fixed });
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
