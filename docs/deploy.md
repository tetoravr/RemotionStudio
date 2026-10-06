# 社内向けに Web 公開する

エディターを社内のメンバーがブラウザから使えるようにする手順です。**会社の Google アカウントでログインした人だけ**が使えます。

公開の方法は3通りあります。どれでも、Google ログインの準備（手順 1）は同じです。Render を使う時は [C. Render で動かす](#c-render-で動かす) へ。

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
AUTH_ALLOWED_DOMAINS=sushitopmarketing.com
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

## C. Render で動かす

[Render](https://render.com/) が GitHub のこのリポジトリから Docker イメージを作って動かし、SUSHI CREATOR のポータルの **`https://sushi-creator.sushitop.io/video-creator/`** で使えるようにします。

```
ブラウザ → sushi-creator.sushitop.io/video-creator/*（ポータルの静的サイト）
          └ リライト → video-creator.onrender.com/video-creator/*（このアプリの Web Service）
```

- ポータル（静的サイト）だけでは動きません。台本・音声・書き出しに、このアプリのサーバーが要るためです。ポータルにビルドしたもの（`dist/`）を置いても、API が無いので「サーバーに接続できません（HTTP 404）」になります。
- **ビルドしたもの（`dist/` など）を GitHub に上げる必要はありません。** Render が `Dockerfile` のとおりにビルド（`npm ci` → `npm run build` → 書き出し用の Chromium の用意）します。`main` に push するたびに、自動でビルドとデプロイが行われます。
- **API キーなどの秘密の値は GitHub に上げません。** Render の画面（サービスの「Environment」）に入力します。`.env` は git にも Docker イメージにも入りません（`.gitignore`・`.dockerignore`）。
- 設定はリポジトリの [`render.yaml`](../render.yaml)（Blueprint）にまとめてあります。`BASE_PATH=/video-creator` で、画面・API・ファイルをすべて `/video-creator/` の下に置きます（ローカルの `npm run dev` は今までどおりルートで動きます）。

### 手順

1. **Google ログインの準備**（上の手順 1）。承認済みのリダイレクト URI は `https://sushi-creator.sushitop.io/video-creator/auth/callback`
2. Render の「New」→「**Blueprint**」→ GitHub の `tetoravr/RemotionStudio` を選ぶ
3. 秘密の値を入力する画面が出るので、入力して「Apply」

   | キー | 値 |
   |---|---|
   | `OPENAI_API_KEY` | OpenAI の API キー |
   | `ELEVENLABS_API_KEY` | ElevenLabs の API キー |
   | `GOOGLE_CLIENT_ID` | 手順 1 のクライアント ID |
   | `GOOGLE_CLIENT_SECRET` | 手順 1 のシークレット |

   - `SESSION_SECRET` は Render が自動で作ります。`AUTH_ALLOWED_DOMAINS` は `sushitopmarketing.com` です（変える時は Environment で）。
   - `BASE_PATH`・`PUBLIC_URL` は `render.yaml` に書いてあります。ホーム画面の左上の「‹ SUSHI CREATOR」（ポータルに戻るリンク）も `render.yaml` の `PORTAL_URL`・`PORTAL_NAME` で決まります（無ければリンクは出ません）。
4. デプロイが終わったら、Web Service の URL（`https://video-creator.onrender.com` など。名前が使われていると `video-creator-xxxx` になります）を控える
5. **ポータルの静的サイト**（`sushi-creator`）の「Redirects/Rewrites」に、上から次の順で追加して保存する

   | Source | Destination | Action |
   |---|---|---|
   | `/video-creator` | `/video-creator/` | Redirect |
   | `/video-creator/*` | `https://video-creator.onrender.com/video-creator/*` | Rewrite |

   - Destination のホストは手順 4 で控えた URL にします。
   - ポータルのリポジトリに `video-creator/` フォルダが残っていると、ファイルがある URL ではリライトが効きません。ポータル側には置かないでください。
6. `https://sushi-creator.sushitop.io/video-creator/` を開き、会社の Google アカウントでログインできれば完了です。

### 知っておくこと

- **プラン**: 書き出し（ヘッドレス Chromium）にメモリが要るので、`render.yaml` は **Standard（2GB）** にしています。無料プランではディスクが使えず、メモリも足りません。書き出しを速くしたい時は Pro（4GB・2CPU）に上げてください。
- **保存先**: プロジェクト（台本・音声・画像・書き出した動画）と `voices/` は、デプロイし直しても消えないディスク（`/var/data`、10GB）に置きます。ディスクは後から増やせますが、減らせません。Render がディスクを毎日スナップショットします。
- **台数**: ディスクを付けたサービスは1台で動きます（このアプリも1台前提です）。デプロイの切り替え時に数十秒止まります。
- **秘密の値を変える時**: Render の画面の「Environment」で変えます（`render.yaml` に書いた `sync: false` の値は、Blueprint を最初に作る時にしか聞かれません）。値を変えると自動で再起動します。
- **製品の画面（`SUSHI UI/`）**: 台本AIが選ぶ製品の画面は `/var/data/ui` に置きます。Render の「Shell」から入れられます（無くても動きます。動画ごとの画面は、エディターでこれまでどおり追加できます）。

## D. 社内 Notion を資料として使う

「AIで作る」の最初の画面（URL・資料から読み込む）で、社内 Notion のページを資料として読み込めます。Notion のページの URL を貼るか、「Notion から選ぶ」で探して選びます。読み込んだ内容から、AI が商品名・ターゲット・課題・特徴・実績などを下書きします。

- **読めるのは、Video Creator の連携に共有したページ（とその中の見出し・箇条書き・表）だけ**です。子ページの中までは読みません。Notion の内容を書き換えることはありません。
- 読み込んだ内容は、ほかの資料と同じく下書きを作るために OpenAI に送られます。**商談の議事録など、社外秘のページは共有しないでください**（サービス概要・会社案内・公開できる事例などのページだけを共有するのがおすすめです）。

### 手順

1. [Notion のインテグレーション](https://www.notion.so/profile/integrations) で「新しいインテグレーション」を作る（Notion のワークスペースの管理者が行います）
   - 種類: **内部**（Internal）
   - 名前: `Video Creator`
   - 機能（Capabilities）: **コンテンツを読み取る**だけにチェック（更新・挿入・コメント・ユーザー情報は不要）
2. 表示された「内部インテグレーションシークレット」（`ntn_…` または `secret_…`）を控える
3. 資料にしたいページを開き、右上の「…」→「接続」（Connections）→ `Video Creator` を追加する
   - 親ページに追加すると、その下のページもまとめて読めるようになります
4. サーバーに `NOTION_TOKEN=<控えたシークレット>` を設定して再起動する
   - Render では、サービスの「Environment」に `NOTION_TOKEN` を追加します（`render.yaml` に書いてありますが、Blueprint を作ったあとに足した値なので、画面で入力が必要です）
   - ローカルでは `.env` に書きます

設定すると、「AIで作る」の最初の画面の見出しが「Webページ・社内 Notion」になり、「Notion から選ぶ」が出ます。

---

## 注意

- OpenAI の利用料は、ログインしたメンバー全員の利用分がこの `.env` のキーに請求されます。OpenAI の管理画面で利用上限を設定しておくことをおすすめします。
- 書き出しは1本ずつ順番に処理します。同時に多くの人が書き出すと待ち時間が長くなります。
- ログインは14日間続きます。メンバーが退職した時は、Google Workspace 側でアカウントを止めれば、次のログインから入れなくなります（すぐに締め出したい時は `SESSION_SECRET` を変えると全員がログアウトされます）。
