import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { createInterface } from 'node:readline/promises'
import { stdin, stdout } from 'node:process'

const require = createRequire(import.meta.url)
const firebaseToolsRoot = dirname(require.resolve('firebase-tools/package.json'))
const store = require(join(firebaseToolsRoot, 'lib/configstore.js')).configstore
const auth = require(join(firebaseToolsRoot, 'lib/auth.js'))
const projectId = 'touchbridge-nozomu-2026'
const url = `https://firestore.googleapis.com/v1/projects/${projectId}/databases/(default)/documents/settings`
const fields = [
  ['issuerName', '事業者名'],
  ['issuerAddress', '所在地'],
  ['issuerContact', '問い合わせ先'],
  ['issuerTaxDetails', '税に関する実際の記載'],
  ['paymentInstructions', '支払い案内'],
]

async function main() {
  const refreshToken = store.get('tokens')?.refresh_token
  if (!refreshToken) throw new Error('Firebase CLIにログインしてください: npx firebase login')
  const access = await auth.getAccessToken(refreshToken, [])
  const headers = { Authorization: `Bearer ${access.access_token}` }
  const existing = await fetch(`${url}/issuer`, { headers })
  if (existing.ok) throw new Error('settings/issuer は既に存在します。上書きせず終了しました。')
  if (existing.status !== 404) throw new Error(`Firestoreの確認に失敗しました（HTTP ${existing.status}）。`)

  const prompt = createInterface({ input: stdin, output: stdout })
  let values
  try {
    console.log(`登録先: ${projectId} / settings/issuer`)
    console.log('ここで入力した値はチャットにもGitにも保存しません。')
    values = {}
    for (const [key, label] of fields) {
      const input = (await prompt.question(`${label} (${key})${key === 'issuerTaxDetails' || key === 'paymentInstructions' ? ' ※長文は @ファイルパス' : ''}: `)).trim()
      const value = input.startsWith('@') ? (await readFile(input.slice(1), 'utf8')).trim() : input
      if (!value || value.length > 10000) throw new Error(`${label}は1〜10000文字で入力してください。`)
      values[key] = { stringValue: value }
    }
    const answer = (await prompt.question('実際の情報であることを確認し、登録しますか？ (yes/no): ')).trim().toLowerCase()
    if (answer !== 'yes') {
      console.log('登録せずに終了しました。')
      return
    }
  } finally {
    prompt.close()
  }

  const response = await fetch(`${url}?documentId=issuer`, {
    method: 'POST',
    headers: { ...headers, 'Content-Type': 'application/json' },
    body: JSON.stringify({ fields: values }),
  })
  if (!response.ok) throw new Error(`登録に失敗しました（HTTP ${response.status}）。Firebase Consoleで権限と接続先を確認してください。`)
  console.log('settings/issuer を登録しました。注文受付は引き続き閉じたままです。')
}

main().catch((error) => {
  console.error(error.message)
  process.exitCode = 1
})
