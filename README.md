# PicoBuy

**欲しいを、もっと手軽に。** Amazonで見つけた商品の購入依頼を受け付け、進捗を管理するWebアプリです。Amazon公式または提携サービスではありません。商品情報は利用者が入力し、スクレイピングは行いません。

## 構成

- React + TypeScript + Vite の画面とCloudflare Worker APIを同じオリジンから配信
- Cloudflare D1に利用者、注文、進捗履歴、セッションを保存
- メール認証コードでログイン。認証コードは10分有効、試行回数と送信回数を制限
- HttpOnly・Secure・SameSite=Lax Cookieでログイン状態を維持
- 管理者権限はD1の利用者レコードに保存。注文の閲覧・変更はAPIで権限を確認
- 商品代金に対して10%の手数料を**サーバー側で再計算**
- 管理者が内容を確認した後、事業者情報を含む変更不可の請求書を発行
- GitHub Repositoryでソース管理。GitHub Actionsでビルド、D1マイグレーション、Workerデプロイ

**オンライン決済は実装していません。** 支払いの確認と商品購入は運営側の実務として行い、管理者がステータスを更新します。注文データはLocalStorageに保存しません。旧デモ版のLocalStorageデータは本番の注文として自動移行しません。

## 現在の公開状態

このブランチは本番化の実装です。D1とWorkerの初回配置は完了し、[WorkerのURL](https://picobuy-production.himawa.workers.dev/)では設定不足の間「現在ご利用いただけません」と表示します。メール送信元ドメイン、Resend、Turnstile、管理者メールおよび事業者情報の設定が完了するまで**一般利用を開始しないでください**。既存のGitHub Pagesデモは、別途停止または転送するまで残ります。

## ローカルで確認

Node.js 22以降が必要です。

```bash
npm install
npm run build
npm run dev
```

`npm run dev` はD1のローカルマイグレーションを適用して `http://127.0.0.1:8787/` を起動します。実際のメール認証は送信元と秘密情報を設定するまで利用できません。秘密情報をソースやGitHubにコミットしないでください。`npm run build` は画面・Worker双方のTypeScriptチェックと本番ビルドを実行します。

## 本番初期設定

1. Cloudflareアカウントで `npx wrangler login` し、`npx wrangler whoami` で対象アカウントを確認します。この作業環境では認証済みです。
2. 認証メール用の送信元ドメインを用意し、[Resendで確認](https://resend.com/docs/dashboard/domains/introduction)します。Resend APIキーと `MAIL_FROM`（例: `PicoBuy <login@your-domain.example>`）を用意します。
3. [Cloudflare Turnstile](https://developers.cloudflare.com/turnstile/get-started/)に公開URLを登録し、サイトキーと秘密キーを用意します。
4. D1 `picobuy-production` の作成・マイグレーションとWorkerの初回デプロイは完了しています。D1のIDは `wrangler.jsonc` に設定済みです。

5. Cloudflare Workerの**Secrets**に `AUTH_SECRET`（32文字以上のランダム値）、`RESEND_API_KEY`、`TURNSTILE_SECRET_KEY` を設定します。`MAIL_FROM` と `TURNSTILE_SITE_KEY` もWorker環境変数として設定します。請求書の発行者情報として `ISSUER_NAME`、`ISSUER_ADDRESS`、`ISSUER_CONTACT`、`ISSUER_TAX_DETAILS`、`PAYMENT_INSTRUCTIONS` を設定します。`wrangler.jsonc` の `keep_vars` がダッシュボードで設定した環境変数を保持します。秘密を `wrangler.jsonc`、`.env`、GitHub Repositoryへ書き込まないでください。設定後に再デプロイします。
6. 管理者にしたいメールアドレスで通常のメール認証を完了させ、D1内の該当利用者の `role` を `admin` に変更します。管理者を画面から自己登録する機能はありません。
7. GitHub Repositoryの **Settings → Secrets and variables → Actions** に `CLOUDFLARE_API_TOKEN` と `CLOUDFLARE_ACCOUNT_ID` を登録します。必要な権限はWorkerとD1のデプロイに限定します。`main` へのpush後、`.github/workflows/deploy.yml` が自動デプロイします。
8. 公開URLでメール認証、利用者による注文、別の管理者セッションでの閲覧・ステータス更新、再読み込み後の保持を確認してから利用を開始します。

## APIとデータ

`/api/auth/request-code`、`/api/auth/verify-code`、`/api/auth/me`、`/api/auth/logout`、`/api/orders`、`/api/orders/:id/invoice` を使用します。APIは同一オリジンからの更新だけを受け付けます。注文番号、商品情報、価格、数量、手数料、合計、支払い予定日時、ステータス、備考、作成・更新日時、利用者、ステータス変更履歴をD1へ保存します。注文番号と金額はサーバーで生成します。請求書は管理者が発行し、発行時の金額・事業者情報をD1に保存して固定します。

ステータス: 依頼受付 → 支払い待ち → 支払い済み → 注文済み → 発送待ち → 発送済み → 到着 → 受け渡し完了。

## 運用上の確認事項

- 注文時の価格・商品情報は利用者入力です。担当者がAmazonの商品ページで確認してください。
- 支払い確認は外部で行い、確認後にのみ「支払い済み」に更新してください。
- 見積書・請求書の正式発行には、事業者の正式名称、所在地、連絡先、税区分、支払い案内などが必要です。これらを確認せずに公開しないでください。
- メール送信、D1のバックアップ・復元、事業者表示、個人情報の取り扱い、問い合わせ窓口を運用開始前に確認してください。
