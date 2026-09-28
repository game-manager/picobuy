# PicoBuy

**欲しいを、もっと手軽に。** Amazonで見つけた商品の購入依頼を体験できる、React + TypeScript + Vite製の静的デモアプリです。Amazon公式またはAmazonと提携しているサービスではありません。商品情報は利用者が手入力し、商品ページのスクレイピングは行いません。

## できること

- 商品名、Amazon商品URL、価格、数量、支払い予定日時、備考の入力
- 商品代金に対する10%の手数料と合計金額の自動計算
- 注文内容確認、確定、履歴、詳細、8段階の進捗タイムライン
- `/#/admin` の管理デモで注文一覧、詳細、ステータス変更、見積書・請求書の表示と印刷
- LocalStorageへの注文保存（ページを再読み込みしても保持）

## 重要な制限

**このアプリはUI・注文フロー検証用の初期版・デモ版です。** 注文データは利用中のブラウザのLocalStorageにだけ保存されます。同じブラウザ・同じオリジンでのみ閲覧でき、別端末の利用者や管理者とは共有されません。ブラウザデータを削除すると注文も消えます。実際の購入、請求、決済、通知は行いません。見積書・請求書もデモ表示です。

`/#/admin` は誰でも開けるデモ画面で、認証機能はありません。**本番環境ではサーバー側認証、アクセス制御、データベースが必要です。** JavaScript内に管理者パスワードや秘密鍵を置かないでください。実際の顧客情報や支払い情報を入力しないでください。

## ローカルで動かす

Node.js 22以降を用意します。

1. このフォルダで `npm install` を実行します。
2. `npm run dev` を実行し、表示されたURL（通常は `http://localhost:5173/`）を開きます。
3. `npm run build` で本番用の `dist/` を生成します。必要に応じて `npm run preview` で確認できます。

## GitHub Pagesへの公開

4. GitHubでRepositoryを作成します。例: `picobuy`。公開リポジトリにする場合は、実データや秘密情報をコミットしないでください。
5. このフォルダで以下を実行し、`main` ブランチへpushします。

   ```bash
   git init
   git branch -M main
   git remote add origin https://github.com/YOUR_NAME/picobuy.git
   git add .
   git commit -m "Build PicoBuy static demo"
   git push -u origin main
   ```

6. Repositoryの **Settings → Pages → Build and deployment → Source** を **GitHub Actions** に設定します。
7. `main` へのpush後、`.github/workflows/deploy.yml` が `npm ci`、`npm run build`、GitHub Pagesへのデプロイを自動実行します。Repositoryの **Actions** で成功を確認し、**Settings → Pages** に表示される公開URLを開きます。

## Pagesのサブディレクトリ対応

Viteの `base` は `./` に設定しています。JavaScript・CSS・画像はリポジトリ名を含む公開パスから相対的に読み込まれます。画面遷移はハッシュルーティング（`/#/request`、`/#/history`、`/#/admin` など）なので、GitHub Pagesで再読み込みしても404になりません。`/admin` 相当のURLは `/#/admin` です。

## データと計算

注文には注文番号、商品名、Amazon商品URL、商品価格、数量、手数料、合計金額、支払い予定日時、注文ステータス、備考、作成日時、更新日時を保存します。手数料は `商品価格 × 数量 × 10%` を1円単位で四捨五入して計算します。注文時点の計算結果を保存します。

ステータス: 依頼受付 → 支払い待ち → 支払い済み → 注文済み → 発送待ち → 発送済み → 到着 → 受け渡し完了。

## 技術構成

React、TypeScript、Vite、Lucide React。ホスティングはGitHub Pages、デプロイはGitHub Actionsです。Firebase関連の実装や設定はありません。
