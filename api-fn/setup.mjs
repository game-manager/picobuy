import { Client, TablesDB } from 'node-appwrite'

const { APPWRITE_ENDPOINT, APPWRITE_PROJECT_ID, APPWRITE_API_KEY } = process.env
if (!APPWRITE_ENDPOINT || !APPWRITE_PROJECT_ID || !APPWRITE_API_KEY) {
  throw new Error('APPWRITE_ENDPOINT、APPWRITE_PROJECT_ID、APPWRITE_API_KEY を環境変数に設定してください。')
}

const tables = new TablesDB(new Client().setEndpoint(APPWRITE_ENDPOINT).setProject(APPWRITE_PROJECT_ID).setKey(APPWRITE_API_KEY))
const databaseId = 'picobuy'
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))

async function ensure(action) {
  try { return await action() } catch (cause) { if (cause.code !== 409) throw cause }
}

async function available(get) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try {
      const item = await get()
      if (item.status === 'available') return
      if (item.status === 'failed' || item.status === 'stuck') throw new Error('Appwriteのスキーマ作成に失敗しました。')
    } catch (cause) { if (cause.code !== 404) throw cause }
    await sleep(1000)
  }
  throw new Error('Appwriteのスキーマ作成が時間内に完了しませんでした。')
}

async function column(tableId, key, create) {
  await ensure(create)
  await available(() => tables.getColumn({ databaseId, tableId, key }))
  process.stdout.write(`  ${tableId}.${key}\n`)
}

await ensure(() => tables.create({ databaseId, name: 'PicoBuy' }))
await ensure(() => tables.createTable({ databaseId, tableId: 'orders', name: 'Orders', permissions: [], rowSecurity: false }))
await ensure(() => tables.createTable({ databaseId, tableId: 'invoices', name: 'Invoices', permissions: [], rowSecurity: false }))
for (const tableId of ['orders', 'invoices']) {
  for (let attempt = 0; attempt < 30; attempt++) {
    try { await tables.getTable({ databaseId, tableId }); break }
    catch (cause) { if (cause.code !== 404 || attempt === 29) throw cause; await sleep(1000) }
  }
}

const varchar = (tableId, key, size) => column(tableId, key, () => tables.createVarcharColumn({ databaseId, tableId, key, size, required: true }))
const text = (tableId, key) => column(tableId, key, () => tables.createTextColumn({ databaseId, tableId, key, required: true }))
const integer = (tableId, key) => column(tableId, key, () => tables.createIntegerColumn({ databaseId, tableId, key, required: true }))
const bigInt = (tableId, key) => column(tableId, key, () => tables.createBigIntColumn({ databaseId, tableId, key, required: true }))

for (const [key, size] of [
  ['userId', 36], ['customerEmail', 254], ['idempotencyKey', 36],
  ['productName', 200], ['amazonUrl', 2000], ['paymentDue', 40], ['status', 30],
]) await varchar('orders', key, size)
for (const key of ['price', 'fee', 'total']) await bigInt('orders', key)
await integer('orders', 'quantity')
await text('orders', 'notes')
await text('orders', 'statusEvents')
await varchar('invoices', 'orderId', 36)
await text('invoices', 'snapshot')

for (const [key, type, columns] of [
  ['orders_user', 'key', ['userId']],
  ['orders_idempotency', 'unique', ['idempotencyKey']],
]) {
  await ensure(() => tables.createIndex({ databaseId, tableId: 'orders', key, type, columns }))
  await available(() => tables.getIndex({ databaseId, tableId: 'orders', key }))
  process.stdout.write(`  index ${key}\n`)
}

process.stdout.write('PicoBuyのデータベース設定が完了しました。\n')
