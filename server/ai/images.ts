import fs from 'node:fs/promises';
import path from 'node:path';
import { toFile } from 'openai';
import type { Pose } from '../../src/video/schema';
import { config } from '../env';
import { getOpenAI } from './client';
import { compositeMouth } from './mouth';

export type CharacterKind = 'human' | 'creature';

export const STYLE_PRESETS = {
  anime: 'the same clean Japanese anime style as the reference (soft cel shading, thin dark outlines)',
  chibi: 'Japanese chibi anime style (2.5 heads tall), thick clean outlines, flat cel shading, cute',
  mascot: 'simple rounded mascot character like a Japanese yuru-chara, thick clean outlines, flat colors, very cute',
  flat: 'modern flat vector illustration style, clean geometric shapes, minimal shading',
  '3d': 'cute 3D toy-like clay render, soft studio lighting, smooth material',
} as const;
export type StylePreset = keyof typeof STYLE_PRESETS;

/** 表情・ポーズごとの指示。closed = 口を閉じた状態で描く（口を開けた版は別途、口だけ差し替える） */
const HUMAN_POSES: Record<Pose, string> = {
  default: 'standing naturally with a gentle smile, mouth CLOSED, one hand relaxed at her side, the other hand holding the smartphone at chest height',
  happy: 'delighted, eyes happily closed in a big smile (like "^ ^"), mouth CLOSED in a wide smile, both hands raised slightly in joy, holding the smartphone in one hand',
  surprised: 'surprised, wide open eyes, raised eyebrows, mouth CLOSED but tiny and tense, one hand raised near her chest in surprise',
  sad: 'troubled and disappointed, eyebrows slanted down, eyes slightly downcast, a small frown with mouth CLOSED, shoulders slightly lowered, smartphone held low',
  think: 'thinking, head slightly tilted, eyes looking up to the side, mouth CLOSED in a small pout, one hand on her chin',
  point: 'confidently presenting, smiling with mouth CLOSED, one arm extended to the side with the index finger pointing, the other hand holding the smartphone',
  wave: 'cheerful greeting, smiling with mouth CLOSED, one hand raised high waving at the viewer, the other hand holding the smartphone',
  wink: 'playful, winking with one eye, smiling with mouth CLOSED, making a peace sign near her face with one hand',
};

const CREATURE_POSES: Record<Pose, string> = {
  default: 'sitting still on the ground, calm expression, exactly like the reference, mouth CLOSED (no mouth visible)',
  happy: 'delighted, both eyes happily curved like "^ ^", cheeks slightly blushing, body slightly stretched upward, mouth CLOSED (no mouth visible)',
  surprised: 'surprised, eyes wide open and round, body slightly bounced up, mouth CLOSED (no mouth visible)',
  sad: 'sad and troubled, eyes droopy with a tiny tear, body slightly squished and lowered, mouth CLOSED (no mouth visible)',
  think: 'thinking, eyes glancing up to the side, body tilted slightly, a small question-mark sweat mark is NOT allowed, mouth CLOSED (no mouth visible)',
  point: 'excited, leaning forward slightly toward the viewer with sparkling eyes, mouth CLOSED (no mouth visible)',
  wave: 'cheerful, tilting sideways happily, eyes curved happily, mouth CLOSED (no mouth visible)',
  wink: 'playful, one eye winking, the other eye open, mouth CLOSED (no mouth visible)',
};

const MOUTH_OPEN: Record<Pose, string> = {
  default: 'speaking cheerfully, mouth open in a natural round shape (like saying "a"), showing a little upper teeth and tongue',
  happy: 'laughing and talking, mouth open in a big happy smile, showing upper teeth and tongue',
  surprised: 'mouth open in a round "o" shape from surprise',
  sad: 'mouth clearly open in a small worried shape (like saying "eh..."), with a little of the upper teeth visible; the opening must be clearly visible',
  think: 'mouth slightly open in a small "n"/"u" shape, as if saying "hmm"',
  point: 'talking confidently, mouth open in a wide friendly shape, showing upper teeth',
  wave: 'greeting cheerfully, mouth open in a big smile, showing upper teeth and tongue',
  wink: 'talking playfully, mouth open in a cheeky smile, showing upper teeth',
};

const CREATURE_MOUTH_HINT =
  'The character has no mouth normally, so you MUST draw one: a clearly visible small, cute open mouth (a dark-red rounded shape with a pink tongue inside), placed on the white face centered BETWEEN the two eyes and slightly BELOW them, about as wide as the gap between the two eyes, in the same glossy 3D rendering style. The mouth must be clearly visible.';

const retry = async <T,>(fn: () => Promise<T>, tries = 3): Promise<T> => {
  let last: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      return await fn();
    } catch (e) {
      last = e;
      await new Promise((r) => setTimeout(r, 2000 * (i + 1)));
    }
  }
  throw last;
};

const mime = (file: string) => {
  const ext = path.extname(file).slice(1).toLowerCase();
  return ext === 'png' ? 'image/png' : ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : 'image/webp';
};

const b64 = (s: string | undefined) => {
  if (!s) throw new Error('画像が返りませんでした');
  return Buffer.from(s, 'base64');
};

export type PoseImageRequest = {
  kind: CharacterKind;
  pose: Pose;
  /** 見た目の基準にする画像（デザインシート・承認済みの全身画像など） */
  references: string[];
  description: string;
  style: StylePreset;
  size: '1024x1536' | '1024x1024';
  quality?: 'low' | 'medium' | 'high';
};

/** 基準画像を元に、指定ポーズ・表情の全身画像（透過・口閉じ）を1枚生成 */
export const generatePoseImage = async (req: PoseImageRequest): Promise<Buffer> => {
  const client = getOpenAI();
  const table = req.kind === 'human' ? HUMAN_POSES : CREATURE_POSES;
  const framing = `Output ONE full-body illustration, ${req.kind === 'human' ? 'from head to shoes with a small margin, facing the viewer' : 'the whole character with a small margin, feet/base touching the bottom area'}, centered, on a fully transparent background. No ground shadow, no text, no logos, no watermark, no other characters.`;
  const poseText = `Pose and expression: ${table[req.pose]}.`;

  // 基準画像が無い（説明文だけの新規キャラ）場合は、テキストから最初の1枚を生成する
  if (req.references.length === 0) {
    const prompt = [
      'Original character design for a Japanese product advertisement video.',
      `${req.description}.`,
      `Style: ${STYLE_PRESETS[req.style]}.`,
      framing,
      poseText,
    ].join(' ');
    const r = await retry(() =>
      client.images.generate({
        model: config.models.image,
        prompt,
        size: req.size,
        background: 'transparent',
        output_format: 'webp',
        quality: req.quality ?? 'high',
      }),
    );
    return b64(r.data?.[0]?.b64_json);
  }

  const files = await Promise.all(req.references.map(async (f) => toFile(await fs.readFile(f), path.basename(f), { type: mime(f) })));
  const prompt = [
    'Draw exactly the same character as in the reference image(s): identical face, hairstyle/shape, colors, outfit/accessories, proportions and rendering style.',
    req.description ? `Character notes: ${req.description}.` : '',
    req.references.length > 1
      ? 'The LAST reference image is the approved full-body render: match its framing, scale, character size and position in the canvas exactly.'
      : '',
    `Style: ${STYLE_PRESETS[req.style]}.`,
    framing,
    poseText,
  ]
    .filter(Boolean)
    .join(' ');
  const r = await retry(() =>
    client.images.edit({
      model: config.models.image,
      image: files.length === 1 ? files[0] : files,
      prompt,
      size: req.size,
      background: 'transparent',
      output_format: 'webp',
      quality: req.quality ?? 'high',
    }),
  );
  return b64(r.data?.[0]?.b64_json);
};

/** 閉じ口画像から、口だけを開けた画像を作る（口以外は閉じ口画像と完全に同一） */
export const generateOpenMouth = async (closedFile: string, kind: CharacterKind, pose: Pose, size: PoseImageRequest['size']): Promise<Buffer> => {
  const client = getOpenAI();
  const file = await toFile(await fs.readFile(closedFile), path.basename(closedFile), { type: mime(closedFile) });
  const prompt = [
    'Edit the provided image: keep EVERYTHING exactly identical (same character, same pose, same clothes, same framing, same position, same transparent background)',
    `and change ONLY the mouth: ${MOUTH_OPEN[pose]}.`,
    kind === 'creature' ? CREATURE_MOUTH_HINT : '',
    'Do not change the eyes, eyebrows, hair, body, hands or anything else.',
  ]
    .filter(Boolean)
    .join(' ');
  const r = await retry(async () => {
    const res = await client.images.edit({
      model: config.models.image,
      image: file,
      prompt,
      size,
      background: 'transparent',
      output_format: 'webp',
      quality: 'medium',
    });
    const raw = b64(res.data?.[0]?.b64_json);
    return (await compositeMouth(closedFile, raw, kind)).image;
  });
  return r;
};
