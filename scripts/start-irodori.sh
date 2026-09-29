#!/usr/bin/env bash
# Irodori-TTS（日本語向けの音声合成）をローカルにセットアップして起動する。
#   npm run irodori              # 初回はダウンロード＋インストール（数GB・10分ほど）。2回目以降はすぐ起動
#
# 環境変数（任意）:
#   IRODORI_BACKEND   cu128（NVIDIA GPU・既定） / cpu / rocm     ※GPUがない場合は cpu（1セリフ30〜60秒かかります）
#   IRODORI_HOME      インストール先（既定: <repo>/.irodori）
#   IRODORI_PORT      ポート（既定 8088）
#   IRODORI_CHECKPOINT_REPO  Hugging Face のチェックポイント（既定 Aratako/Irodori-TTS-v4.1-Small）
#
# 起動後、.env に  IRODORI_TTS_URL=http://127.0.0.1:8088  を書くと、ナレーションが Irodori-TTS になります。
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
HOME_DIR="${IRODORI_HOME:-$ROOT/.irodori}"
BACKEND="${IRODORI_BACKEND:-}"
PORT="${IRODORI_PORT:-8088}"
CKPT="${IRODORI_CHECKPOINT_REPO:-Aratako/Irodori-TTS-v4.1-Small}"
SERVER_DIR="$HOME_DIR/Irodori-TTS-Server"

if ! command -v uv >/dev/null 2>&1; then
  echo "uv が必要です: https://docs.astral.sh/uv/getting-started/installation/  (例: curl -LsSf https://astral.sh/uv/install.sh | sh)" >&2
  exit 1
fi
command -v git >/dev/null 2>&1 || { echo "git が必要です" >&2; exit 1; }

if [ -z "$BACKEND" ]; then
  if command -v nvidia-smi >/dev/null 2>&1 && nvidia-smi >/dev/null 2>&1; then BACKEND=cu128; else BACKEND=cpu; fi
fi
case "$BACKEND" in
  cu128) DEVICE=cuda; PRECISION=bf16 ;;
  rocm) DEVICE=cuda; PRECISION=bf16 ;;
  cpu) DEVICE=cpu; PRECISION=fp32 ;;
  *) echo "IRODORI_BACKEND は cu128 / rocm / cpu のいずれかです" >&2; exit 1 ;;
esac

mkdir -p "$HOME_DIR"
if [ ! -d "$SERVER_DIR/.git" ]; then
  echo "▶ Irodori-TTS-Server を取得します"
  git clone --depth 1 https://github.com/Aratako/Irodori-TTS-Server.git "$SERVER_DIR"
fi

cd "$SERVER_DIR"
if [ ! -f .env ]; then
  cp .env.example .env
fi
# .env の値を更新（存在しなければ追記）
setenv() {
  if grep -qE "^#? *$1=" .env; then sed -i.bak -E "s|^#? *$1=.*|$1=$2|" .env && rm -f .env.bak; else echo "$1=$2" >> .env; fi
}
setenv IRODORI_HOST 127.0.0.1
setenv IRODORI_PORT "$PORT"
setenv IRODORI_HF_CHECKPOINT "$CKPT"
setenv IRODORI_MODEL_DEVICE "$DEVICE"
setenv IRODORI_CODEC_DEVICE "$DEVICE"
setenv IRODORI_MODEL_PRECISION "$PRECISION"
setenv IRODORI_CODEC_PRECISION "$PRECISION"
setenv IRODORI_PRELOAD true

if [ ! -f ".synced-$BACKEND" ]; then
  echo "▶ 依存パッケージをインストールします（バックエンド: $BACKEND）"
  UV_LINK_MODE="${UV_LINK_MODE:-copy}" uv sync --extra "$BACKEND"
  rm -f .synced-*
  touch ".synced-$BACKEND"
fi

echo "▶ Irodori-TTS を起動します: http://127.0.0.1:$PORT  （チェックポイント: $CKPT / $BACKEND）"
echo "  初回はモデルのダウンロードと読み込みで数分かかります。'Application startup complete' が出たら準備完了です。"
echo "  声の参照音声を使う場合は $SERVER_DIR/voices/ に wav を置きます。"
exec uv run --no-sync python -m irodori_openai_tts --host 127.0.0.1 --port "$PORT"
