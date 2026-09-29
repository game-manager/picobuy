# PicoBuy

**欲しいを、もっと手軽に。** Amazonで見つけた商品の購入依頼と進捗を管理するWebアプリです。商品名、URL、価格、数量は利用者自身が入力します。Amazon公式・提携サービスではなく、商品ページのスクレイピングも行いません。

## 構成

- 画面: React + TypeScript + Vite、[Firebase Hosting](https://firebase.google.com/docs/hosting/)
- ログイン: Firebase AuthenticationのGoogleログイン
- 共有データ: Cloud Firestore。注文、ステータス、請求書を端末間で共有
- 権限と検証: [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions)。本人の注文だけを表示し、管理者のみ進捗・請求書を変更できます。10%の手数料と合計もルール側で検証します。
- デプロイ: GitHub Actionsでビルドとテスト、Firebase Hostingへ配信

無料のSparkプランで運用するため、課金アカウントが必要なCloud Functionsは使用しません。オンライン決済には対応していません。入金確認とAmazonでの購入は担当者がサービス外で行います。Firebaseの[無料枠と上限](https://firebase.google.com/pricing)を超えて継続提供する構成ではありません。FirebaseはGoogleが提供するサービスですが、Google Cloud Consoleで別途OAuthクライアントを作成する必要はありません。

**公開先:** [https://picobuy-touchbridge.web.app](https://picobuy-touchbridge.web.app)。事業者情報と公開スイッチの設定が終わるまでは、注文受付を閉じています。従来のGitHub Pagesサイトはデモとして残します。

## 開発

Node.js 22以降とJava 21以降（ルールテスト用）を用意してください。

```bash
npm install
cp .env.example .env.local
npm run dev
npm run build
npm test
```

WindowsのPowerShellでは `cp` の代わりに `Copy-Item .env.example .env.local` でも構いません。`.env.local` の値はFirebase Consoleの **プロジェクトの設定 → マイアプリ → PicoBuy** で確認できます。本番ビルド用の公開設定は `.env.production` にあります。Firebase Web APIキーなどのWeb SDK設定値はブラウザに配信する識別子であり、秘密鍵ではありません。Firebaseのサービスアカウント鍵やトークンを `VITE_` 変数・ソース・チャットに入れないでください。

## Firebaseプロジェクトの設定

このリポジトリは `touchbridge-nozomu-2026` 内のPicoBuy用WebアプリとHostingサイト `picobuy-touchbridge` を使用します。既存のTouchBridge用Hostingサイト・Realtime Databaseは変更しません。Firestoreの `(default)` データベースはPicoBuy用に新規作成済みです。

1. Firebase CLIにログインします。

   ```bash
   npm install -g firebase-tools
   firebase login
   ```

2. `firebase.json` のGoogleログイン設定、`firestore.rules`、`firestore.indexes.json` を確認します。Googleログインとルールは反映済みです。管理画面の表示だけで権限を判断せず、Firestoreルールを必ず配信してください。

   ```bash
   firebase deploy --only auth,firestore --project touchbridge-nozomu-2026
   ```

3. [PicoBuyサイト](https://picobuy-touchbridge.web.app)でGoogleログインします。Firebase Consoleの **Authentication → Users** で自分のUIDを調べます。
4. Firebase Consoleの **Firestore Database → データ** でコレクション `admins`、ドキュメントIDをそのUIDとして作り、フィールド `active` を **boolean / true** にします。ブラウザから管理者権限を追加するAPIはありません。再読み込み後に `#/admin` を開いてください。
5. 同じ画面で `settings` コレクションの `issuer` ドキュメントを作ります。次の5フィールドはすべて **string** で、実際の事業者・請求情報を入力してください。

   | フィールド | 内容 |
   | --- | --- |
   | `issuerName` | 事業者名 |
   | `issuerAddress` | 所在地 |
   | `issuerContact` | 問い合わせ先 |
   | `issuerTaxDetails` | 税に関する実際の記載 |
   | `paymentInstructions` | 実際の支払い案内 |

6. 商品価格の確認、支払い方法、連絡先、個人情報の扱い、データのバックアップ方法を整えてください。`settings/launch` は **boolean / false** で作成済みです。事業者情報を登録した後、管理者が **true** にして限定的なテスト注文を作り、履歴、進捗、請求書、別端末での表示を確認してください。公開準備が終わるまでは **false** に戻します。設定変更後、サイトを再読み込みしてください。

請求書は管理者が発行すると内容をFirestoreに固定します。注文を削除する画面はありません。既存のAppwrite版やブラウザLocalStorageの注文は自動移行しません。

## 配信

```bash
npm run build
firebase deploy --only hosting:picobuy --project touchbridge-nozomu-2026
```

GitHub Repositoryは [game-manager/picobuy](https://github.com/game-manager/picobuy) です。Firebase版を `main` に取り込んだ後は、GitHub Actionsでビルド・ルールテスト・Hosting配信を行います。必要なGitHubシークレットはFirebase CLIの `firebase init hosting:github` で作成した実際のサービスアカウント鍵を使用します。秘密鍵をリポジトリへコミットしないでください。

Firebase Hostingはルート配信で、画面内のURLは `#/request` や `#/admin` のハッシュルーティングです。Firestoreへの直接アクセスはルールで制御します。無料枠の利用状況はFirebase Consoleで定期的に確認してください。
