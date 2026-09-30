import 'dotenv/config';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

export const config = {
  port: Number(process.env.PORT || 3210),
  /** 既定はローカルのみ。LAN に公開する場合は HOST=0.0.0.0 */
  host: process.env.HOST || '127.0.0.1',
  projectsDir: path.resolve(ROOT, process.env.PROJECTS_DIR || 'projects'),
  publicDir: path.resolve(ROOT, 'public'),
  /** 参照音声の控え。Irodori サーバー側の voices が消えても、ここから自動で再登録する */
  voicesDir: path.resolve(ROOT, process.env.VOICES_DIR || 'voices'),
  /** 製品のUIスクリーンショット置き場。台本AIが中身を見て、合う画面を動画に使う */
  uiDir: path.resolve(ROOT, process.env.UI_LIBRARY_DIR || 'SUSHI UI'),
  openaiKey: process.env.OPENAI_API_KEY || '',
  models: {
    text: process.env.OPENAI_TEXT_MODEL || 'gpt-5.5',
    tts: process.env.OPENAI_TTS_MODEL || 'gpt-4o-mini-tts',
    image: process.env.OPENAI_IMAGE_MODEL || 'gpt-image-2',
    /** 図解イラスト（課題の説明など）。文字なしのフラットな図解に強いモデル */
    illustration: process.env.OPENAI_ILLUSTRATION_MODEL || 'gpt-image-2.5-sunburst',
  },
  /** 音声合成。provider=auto は IRODORI_TTS_URL があれば Irodori-TTS、なければ OpenAI */
  tts: {
    provider: (process.env.TTS_PROVIDER || 'auto') as 'auto' | 'openai' | 'irodori',
    irodoriUrl: (process.env.IRODORI_TTS_URL || '').replace(/\/+$/, ''),
    irodoriModel: process.env.IRODORI_TTS_MODEL || 'irodori-tts',
    irodoriKey: process.env.IRODORI_TTS_API_KEY || '',
    irodoriSteps: process.env.IRODORI_NUM_STEPS ? Number(process.env.IRODORI_NUM_STEPS) : undefined,
    /** 1セリフの生成待ち時間の上限（CPU だと数十秒かかる） */
    irodoriTimeoutMs: Number(process.env.IRODORI_TIMEOUT_SEC || 600) * 1000,
  },
  imageQuality: (process.env.OPENAI_IMAGE_QUALITY || 'medium') as 'low' | 'medium' | 'high',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
};

export const hasOpenAI = () => Boolean(config.openaiKey);
