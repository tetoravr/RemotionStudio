import 'dotenv/config';
import path from 'node:path';

export const ROOT = path.resolve(import.meta.dirname, '..');

/** 公開するパス（例: /video-creator）。ポータルのサブパスでリライト経由で配信する時に使う。空ならルート */
const basePath = (process.env.BASE_PATH || '').trim().replace(/^\/*/, '/').replace(/\/+$/, '');

export const config = {
  port: Number(process.env.PORT || 3210),
  basePath,
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
  /** 音声合成。provider=auto は ElevenLabs（TTS_PROVIDER=irodori / openai で切り替え） */
  tts: {
    provider: (process.env.TTS_PROVIDER || 'auto') as 'auto' | 'elevenlabs' | 'openai' | 'irodori',
    irodoriUrl: (process.env.IRODORI_TTS_URL || '').replace(/\/+$/, ''),
    irodoriModel: process.env.IRODORI_TTS_MODEL || 'irodori-tts',
    irodoriKey: process.env.IRODORI_TTS_API_KEY || '',
    irodoriSteps: process.env.IRODORI_NUM_STEPS ? Number(process.env.IRODORI_NUM_STEPS) : undefined,
    /** 1セリフの生成待ち時間の上限（CPU だと数十秒かかる） */
    irodoriTimeoutMs: Number(process.env.IRODORI_TIMEOUT_SEC || 600) * 1000,
  },
  /** ElevenLabs（ナレーションの既定のエンジン） */
  eleven: {
    apiKey: process.env.ELEVENLABS_API_KEY || process.env.XI_API_KEY || '',
    /** API の接続先（EU などのデータ所在地を使う時だけ変える） */
    baseUrl: (process.env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/+$/, ''),
    /** 読み上げのモデル。既定は eleven_v4（Text to Dialogue API で1セリフずつ）。使えない時は自動で eleven_v3 */
    model: process.env.ELEVENLABS_MODEL || 'eleven_v4',
    /** 読み上げの確認に使う文字起こしのモデル */
    sttModel: process.env.ELEVENLABS_STT_MODEL || 'scribe_v2',
    /** 作った音声を文字起こしして台本と照合し、読み違い・途切れがあれば作り直す（0 で無効） */
    verify: process.env.ELEVENLABS_VERIFY !== '0',
    /** 声のデザイン（声のイメージから声を作る）のモデル */
    designModel: process.env.ELEVENLABS_DESIGN_MODEL || 'eleven_ttv_v3',
    /** 読み上げの言語（ISO 639-1）。空にすると自動判定 */
    language: process.env.ELEVENLABS_LANGUAGE ?? 'ja',
    /** 同時に作るセリフの数（プランの同時実行数の上限より小さく） */
    concurrency: Number(process.env.ELEVENLABS_CONCURRENCY || 3),
  },
  imageQuality: (process.env.OPENAI_IMAGE_QUALITY || 'medium') as 'low' | 'medium' | 'high',
  browserExecutable: process.env.REMOTION_BROWSER_EXECUTABLE || null,
};

export const hasOpenAI = () => Boolean(config.openaiKey);
