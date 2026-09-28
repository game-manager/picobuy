# PicoBuy

**欲しいを、もっと手軽に。** Amazonで見つけた商品の購入依頼を受け付け、進捗を管理するWebアプリです。Amazon公式または提携サービスではありません。商品情報は利用者が入力し、スクレイピングは行いません。

## 無料構成

- React + TypeScript + Vite。ソースはGitHub、画面はAppwrite Sitesの無料プランで配信します。
- Appwrite AuthとGoogleアカウントでログインします。認証メールの送信設定や独自ドメインは不要です。Googleアカウントがない利用者はログインできません。
- OAuth2トークンでログインを完了します。独自ドメインがないためブラウザによってセッションはLocalStorageに保存されます。共有端末での利用を避け、将来独自ドメインを設定できる場合は同一サイトのCookieへ移行してください。
- Appwrite TablesDBに注文と請求書を保存します。管理者権限と金額計算はAppwrite Functionのサーバー側で判定します。
- 利用者には自分の注文だけを返し、管理者にはすべての注文を返します。テーブルにはクライアントの直接アクセス権を付与しません。
- 商品代金の10%を手数料としてサーバー側で計算します。請求書は管理者が内容を確認して発行し、発行時点の情報を固定します。
- オンライン決済はありません。入金とAmazonでの購入は担当者がサービス外で確認・実行します。

GitHub Pagesは[商用取引を主目的とするサイトの無料ホスティングに利用できません](https://docs.github.com/en/pages/getting-started-with-github-pages/github-pages-limits)。従来のPages版はデモであり、実際の注文は受け付けません。

**無料プランの制約:** Appwriteの無料枠には月間利用上限があり、[開発操作が7日間ないプロジェクトは停止します](https://appwrite.io/changelog/entry/2026-02-20-1)。利用者のアクセスだけで常時稼働を保証できません。無料枠には日次バックアップや稼働保証がありません。注文の運用開始前にデータの定期エクスポート、個人情報の扱い、事業者表示、問い合わせ窓口を決めてください。上限に達した場合に継続提供を保証する構成ではありません。

## ローカル確認

Node.js 22以降を用意します。

```bash
npm install
copy .env.example .env.local
npm run dev
npm run build
npm test
```

`.env.local` には自分のAppwriteプロジェクトの公開情報を入力します。`VITE_` で始まる値はブラウザに配信されます。APIキーや秘密情報を設定しないでください。設定がない画面は「現在ご利用いただけません」と表示します。

## Appwrite CLI

公式CLIでプロジェクト、TablesDB、Functions、Sitesを管理できます。WindowsでもNode.jsがあれば以下を実行できます。

```powershell
npm install -g appwrite-cli
appwrite login
appwrite init project
appwrite whoami
appwrite tablesdb list
appwrite functions list
appwrite sites list
```

このリポジトリの `appwrite.config.json` は作成済みのPicoBuyプロジェクトの公開IDとエンドポイントを指します。`appwrite login` はブラウザで本人確認します。CLIのログイン情報やAPIキーはGitHubへ登録しないでください。Google OAuthクライアントの作成はGoogle Cloudで行い、そのIDとシークレットはAppwrite ConsoleのAuth設定に入力します。

## Appwrite Cloudの初期設定

1. [Appwrite Cloud](https://cloud.appwrite.io/)で無料アカウントとプロジェクト `PicoBuy` を作成します。プロジェクトのAPIエンドポイントとProject IDを控えます。このリポジトリに記録したPicoBuyプロジェクトは作成済みです。
2. Appwrite CLIでログインし、プロジェクトを接続します。作成済みのPicoBuyプロジェクトではテーブルを再作成する必要はありません。別プロジェクトに複製する場合だけ、設定ファイルのプロジェクトIDを切り替えて `appwrite push tables` を実行します。

   ```powershell
   appwrite login
   appwrite init project
   appwrite tablesdb list
   ```

3. CLIを使わない別プロジェクトへの初期化では、`databases.read` と `databases.write` だけを許可した一時APIキーをローカル環境変数に設定し、`api-fn/setup.mjs` を実行できます。値は自分のものに置き換え、キーはチャット・GitHub・サイトの環境変数へ貼らないでください。

   ```powershell
   $env:APPWRITE_ENDPOINT = 'https://REGION.cloud.appwrite.io/v1'
   $env:APPWRITE_PROJECT_ID = 'PROJECT_ID'
   $env:APPWRITE_API_KEY = '作成したAPIキー'
   node api-fn/setup.mjs
   Remove-Item Env:APPWRITE_API_KEY
   ```

4. 作成済みの **Functions** `picobuy-api` にGitHub Repositoryの `api-fn` ディレクトリを接続します。エントリーポイントは `index.mjs`、インストールは `npm ci`、実行権限は `Any`、一時APIキーのスコープは `databases.read` と `databases.write` です。関数は毎回AppwriteのJWTを検証し、未ログインの注文操作を拒否します。
5. 関数の環境変数に `APPWRITE_ENDPOINT`、`APPWRITE_PROJECT_ID`、`ISSUER_NAME`、`ISSUER_ADDRESS`、`ISSUER_CONTACT`、`ISSUER_TAX_DETAILS`、`PAYMENT_INSTRUCTIONS` を登録します。後半5項目には実際の事業者・請求書情報を入力してください。架空の事業者情報では注文受付を開始しないでください。
6. 作成済みの **Sites** `picobuy-web` に同じGitHub Repositoryを接続します。ビルドコマンドは `npm run build`、出力先は `dist`、本番ブランチは準備が完了した後に `main` とします。ビルド環境変数 `VITE_APPWRITE_ENDPOINT`、`VITE_APPWRITE_PROJECT_ID`、`VITE_APPWRITE_FUNCTION_ID=picobuy-api` は設定済みです。
7. Sitesで発行されたホスト名をAppwriteプロジェクトのWebプラットフォームに追加します。独自ドメインは不要です。
8. Appwrite Consoleの **Auth → Settings → OAuth2 Providers → Google** を開きます。Google側でOAuthクライアントを作成し、Appwrite画面に表示されるリダイレクトURLをGoogleの「承認済みのリダイレクトURI」に登録します。GoogleのクライアントIDとシークレットはAppwriteの設定画面にだけ入力し、リポジトリやチャットに貼らないでください。[Appwrite OAuth設定手順](https://appwrite.io/docs/products/auth/oauth2)を参照してください。
9. Google以外のサインイン方式（メール、電話、匿名、招待）をAuth設定で無効にします。JWTはFunction内での本人確認に使用するため有効のままにします。自分のGoogleアカウントでログインを確認し、管理者にする利用者にAppwrite Consoleから `admin` ラベルを付けます。利用者自身が管理者ラベルを付ける画面やAPIはありません。
10. 管理者とは別の利用者でもログインし、注文作成、履歴、進捗更新、請求書発行、再読み込み後の保持を確認してから一般利用を開始します。

Appwrite Sitesは接続したGitHubブランチへのpushで自動ビルド・配信します。GitHub Actionsの `ci.yml` はビルドとテストだけを行います。秘密情報はRepositoryに保存しません。

## データと権限

- `orders` テーブル: 注文番号、利用者ID・メール、商品名、Amazon URL、単価、数量、手数料、合計、支払い予定日時、ステータス、備考、進捗履歴、作成・更新日時。
- `invoices` テーブル: 発行時の金額、宛先、発行者情報、支払い案内を固定したスナップショット。
- テーブルのクライアント権限は空です。注文作成・閲覧・更新と請求書発行はFunctionを通し、Functionが利用者ID・`admin` ラベルを検証します。
- 注文の再送には冪等キーを使い、同じ依頼が二重登録されないようにします。
- ステータス: 依頼受付 → 支払い待ち → 支払い済み → 注文済み → 発送待ち → 発送済み → 到着 → 受け渡し完了。

## 運用時の確認

- 利用者が入力した商品名・価格は、担当者がAmazonの商品ページで確認します。
- 入金を確認するまで「支払い済み」に変更しません。
- 見積書は利用者入力価格に基づく概算です。請求書には実在する事業者情報と適切な税の記載を設定します。
- 旧デモ版のLocalStorageデータは本番注文へ自動移行しません。
