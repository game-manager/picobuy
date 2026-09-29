# PicoBuy

**欲しいを、もっと手軽に。** Amazonで見つけた商品の購入依頼と進捗を管理するWebアプリです。商品名、URL、価格、数量は利用者自身が入力します。Amazon公式・提携サービスではなく、商品ページのスクレイピングも行いません。

## 構成

- 画面: React + TypeScript + Vite、[Firebase Hosting](https://firebase.google.com/docs/hosting/)
- ログイン: Firebase AuthenticationのGoogleログイン
- 共有データ: Cloud Firestore。注文、最終見積と承諾、現金の受領・返金記録、ステータス、請求書を端末間で共有
- 権限と検証: [Firestore Security Rules](https://firebase.google.com/docs/firestore/security/rules-conditions)。本人の注文だけを表示し、見積金額・10%手数料・送料と合計をルール側で検証します。
- デプロイ: GitHub Actionsでビルドとテスト、Firebase Hostingへ配信

無料のSparkプランで運用するため、課金アカウントが必要なCloud Functionsは使用しません。オンライン決済には対応していません。現金の受け渡し・返金とAmazonでの購入は担当者がサービス外で行い、PicoBuyにはその結果を記録します。Firebaseの[無料枠と上限](https://firebase.google.com/pricing)を超えて継続提供する構成ではありません。FirebaseはGoogleが提供するサービスですが、Google Cloud Consoleで別途OAuthクライアントを作成する必要はありません。

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

   Firebase CLIでログイン済みなら、ターミナルで `npm run setup:issuer` を実行して対話形式で入力することもできます。長文の税の記載や支払い案内はUTF-8のテキストファイルに保存し、質問欄に `@ファイルパス` と入力してください。このコマンドは既存の `settings/issuer` を上書きしません。入力値はチャットやGitに保存されません。

   | フィールド | 内容 |
   | --- | --- |
   | `issuerName` | 事業者名 |
   | `issuerAddress` | 所在地 |
   | `issuerContact` | 問い合わせ先 |
   | `issuerTaxDetails` | 税に関する実際の記載 |
   | `paymentInstructions` | 実際の支払い案内 |

6. 商品価格の確認、支払い方法、連絡先、個人情報の扱い、データのバックアップ方法を整えてください。`settings/launch` は **boolean / false** で作成済みです。限定的なテスト注文で、管理者の最終見積、利用者の承諾、現金受領記録、ステータス、請求書、別端末での表示を確認してください。公開準備が終わるまでは **false** に戻します。設定変更後、サイトを再読み込みしてください。

## 注文の運用

1. 利用者が商品情報と支払い予定日時を入力して依頼します。画面の金額は送料別の概算です。
2. 管理者が商品単価と送料を確認して最終見積を提示します。価格変更時は利用者に直接連絡してください。自動メール通知はありません。
3. 利用者が注文詳細で最終見積を承諾します。見積の提示・承諾履歴は保存されます。
4. 利用者が現金を直接渡した後、管理者が受領を記録し「支払い済み」に進めます。記録は実際の現金授受の証明を自動的に検証するものではありません。
5. Amazonでの購入後に「注文済み」に進め、承諾済みの最終見積を使って請求書を発行します。請求書は発行後に変更できません。
6. 購入前に価格や送料が変わったら、管理者が新しい見積を提示し、利用者が再承諾します。差額の現金受領・返金は実施後に記録します。購入できない場合は理由を記録してキャンセルし、必要な返金を記録します。

請求書は、記録上の差引受領額が承諾済みの最終金額と一致した後に発行できます。発行後は見積と現金記録を変更できません。購入後のキャンセル・返金は現在の画面では扱えないため、購入前に価格と在庫を確認してください。注文、見積、現金の受領・返金記録を削除する画面はありません。既存のAppwrite版やブラウザLocalStorageの注文は自動移行しません。

## 配信

```bash
npm run build
firebase deploy --only hosting:picobuy --project touchbridge-nozomu-2026
```

GitHub Repositoryは [game-manager/picobuy](https://github.com/game-manager/picobuy) です。Firebase版を `main` に取り込んだ後は、GitHub Actionsでビルド・ルールテスト・Hosting配信を行います。必要なGitHubシークレットはFirebase CLIの `firebase init hosting:github` で作成した実際のサービスアカウント鍵を使用します。秘密鍵をリポジトリへコミットしないでください。

Firebase Hostingはルート配信で、画面内のURLは `#/request` や `#/admin` のハッシュルーティングです。Firestoreへの直接アクセスはルールで制御します。無料枠の利用状況はFirebase Consoleで定期的に確認してください。
