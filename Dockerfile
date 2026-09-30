# Ad Studio（エディター＋APIサーバー＋書き出し）
# 音声合成の Irodori-TTS は GPU が必要なので別のサーバーで動かし、IRODORI_TTS_URL でつなぐ（無ければ OpenAI TTS）
FROM node:22-bookworm-slim

# 書き出し（Remotion のヘッドレス Chromium）に必要なライブラリと、日本語フォント（予備）
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates libnss3 libdbus-1-3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 libgbm1 libasound2 \
      libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libpango-1.0-0 libcairo2 \
      fonts-noto-cjk \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci
COPY . .
# エディターを本番用にビルドし、書き出し用の Chromium を先に入れておく
RUN npm run build && npx remotion browser ensure

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3210
EXPOSE 3210
# プロジェクト（台本・音声・画像・書き出し動画）と参照音声、製品のUI画面はボリュームに置く
VOLUME ["/app/projects", "/app/voices", "/app/SUSHI UI"]
HEALTHCHECK --interval=30s --timeout=5s CMD node -e "fetch('http://127.0.0.1:3210/healthz').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"
CMD ["npx", "tsx", "server/index.ts"]
