# 社内向けに Web 公開する

エディターを社内のメンバーがブラウザから使えるようにする手順です。**会社の Google アカウントでログインした人だけ**が使えます。

公開の方法は2通りあります。どちらでも、アプリ側の設定（手順 1・2）は同じです。

| | A. この PC から公開する | B. クラウドのサーバーで動かす |
|---|---|---|
| 向いている時 | まず試したい／GPU のある PC がある | 常時使いたい／PC を止めたい |
| 音声（Irodori） | この PC の GPU をそのまま使える | GPU サーバーが別に必要（無ければ OpenAI TTS） |
| 使える時間 | PC が起動している間だけ | 常時 |
| 費用 | Cloudflare は無料枠で可 | サーバー代（書き出しは CPU を多く使う。4コア/8GB 以上推奨） |

---

## 1. Google ログインの準備（Google Cloud）

1. [Google Cloud コンソール](https://console.cloud.google.com/) でプロジェクトを選ぶ（または作る）
2. 「API とサービス」→「OAuth 同意画面」: ユーザーの種類は **内部**（Google Workspace の組織内だけに限定されます）
3. 「API とサービス」→「認証情報」→「認証情報を作成」→「OAuth クライアント ID」
   - アプリケーションの種類: **ウェブ アプリケーション**
   - 承認済みのリダイレクト URI: `https://<公開するドメイン>/auth/callback`（例: `https://studio.example.com/auth/callback`）
4. 表示されたクライアント ID とシークレットを控える

## 2. `.env` の設定

```dotenv
# 公開URL（最後の / は不要）
PUBLIC_URL=https://studio.example.com
# Google ログイン
GOOGLE_CLIENT_ID=xxxxxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=xxxxxxxx
# 使ってよいドメイン（カンマ区切り）。ドメイン外の人を個別に許可する時は AUTH_ALLOWED_EMAILS
AUTH_ALLOWED_DOMAINS=tetoravr.com
# セッションの署名用（32文字以上のランダムな文字列。下のコマンドで作れます）
SESSION_SECRET=
```

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"
```

- ログインの設定が揃っていない状態で外部に公開しようとすると（`HOST=0.0.0.0` など）、**サーバーは起動しません**（誤って誰でも使える状態で公開しないため）。
- ログインを設定すると、画面・API・書き出した動画など、すべてにログインが必要になります。プロジェクト一覧は全員で共有され、最後に編集した人が表示されます。
- 公開中は、URL 読み込みで社内のサーバーやこのサーバー自身（プライベートIP）にはアクセスしません。

---

## A. この PC から公開する（Cloudflare Tunnel）

ルーターのポート開放は不要です。外からの通信は Cloudflare を経由してこの PC に届きます。

1. [Cloudflare](https://dash.cloudflare.com/) に公開用のドメインを追加しておく
2. 「Zero Trust」→「Networks」→「Tunnels」→「Create a tunnel」（Cloudflared）→ トークンを控える
3. 「Public Hostname」を追加: `studio.example.com` → Service `http://localhost:3210`
4. この PC でアプリを本番モードで起動する（エディターをビルドして、1つのサーバーで配信します）

   ```bash
   npm start
   ```

5. 別のターミナルでトンネルを起動する（[cloudflared のインストール](https://developers.cloudflare.com/cloudflare-one/connections/connect-networks/downloads/)）

   ```bash
   cloudflared tunnel run --token <控えたトークン>
   ```

`https://studio.example.com` を開き、会社の Google アカウントでログインできれば完了です。アプリは `127.0.0.1` で待ち受けたままなので、LAN から直接つながることはありません。

Docker で動かす場合は `.env` に `CLOUDFLARE_TUNNEL_TOKEN=` を書き、`docker compose --profile tunnel up -d --build`（トンネルの Service は `http://studio:3210`）。Irodori をこの PC で動かして使う時は `TTS_PROVIDER=irodori` と `IRODORI_TTS_URL=http://host.docker.internal:8088`。

## B. クラウドのサーバーで動かす（Docker）

1. Docker が使える Linux サーバー（4コア/8GB 以上推奨）を用意する
2. このリポジトリを置き、`.env` を作る（手順 2 ＋ `OPENAI_API_KEY`・`ELEVENLABS_API_KEY`）
3. 起動する

   ```bash
   docker compose up -d --build
   ```

4. HTTPS のリバースプロキシ（Caddy・nginx・ロードバランサ、または上の Cloudflare Tunnel）から `127.0.0.1:3210` へ転送する

- **音声**: ナレーションは ElevenLabs（`ELEVENLABS_API_KEY`）で作るので、サーバーに GPU は不要です。Irodori-TTS を使う場合は GPU サーバーで [Irodori-TTS-Server](https://github.com/Aratako/Irodori-TTS-Server) を動かし、`TTS_PROVIDER=irodori` と `IRODORI_TTS_URL` でつなぎます。
- **保存先**: `projects/`（台本・音声・画像・書き出した動画）、`voices/`（参照音声・ElevenLabs に登録した標準の声の対応表）、`SUSHI UI/`（製品の画面）はボリュームに残ります。定期的にバックアップしてください。
- **台数**: 処理の進み具合をメモリで持っているので、サーバーは1台で動かしてください。

---

## 注意

- OpenAI の利用料は、ログインしたメンバー全員の利用分がこの `.env` のキーに請求されます。OpenAI の管理画面で利用上限を設定しておくことをおすすめします。
- 書き出しは1本ずつ順番に処理します。同時に多くの人が書き出すと待ち時間が長くなります。
- ログインは14日間続きます。メンバーが退職した時は、Google Workspace 側でアカウントを止めれば、次のログインから入れなくなります（すぐに締め出したい時は `SESSION_SECRET` を変えると全員がログアウトされます）。
