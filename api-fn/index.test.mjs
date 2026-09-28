import test from 'node:test'
import assert from 'node:assert/strict'
import { internals } from './index.mjs'

const owner = { $id: 'owner', email: 'owner@example.com', labels: [] }
const stranger = { $id: 'stranger', email: 'stranger@example.com', labels: [] }
const admin = { $id: 'admin', email: 'admin@example.com', labels: ['admin'] }
const draft = {
  productName: '試験用の商品', amazonUrl: 'https://www.amazon.co.jp/dp/B012345678',
  price: 10000, quantity: 2, paymentDue: new Date(Date.now() + 86400000).toISOString(), notes: '',
}

function fakeTables() {
  const orders = new Map()
  const invoices = new Map()
  return {
    orders, invoices,
    async listRows({ tableId, queries }) {
      if (tableId !== 'orders') return { rows: [...invoices.values()] }
      const match = queries.find(query => query.includes('idempotencyKey'))
      return { rows: match ? [...orders.values()].filter(row => queryValue(match) === row.idempotencyKey) : [...orders.values()] }
    },
    async createRow({ tableId, rowId, data }) {
      const map = tableId === 'orders' ? orders : invoices
      if (map.has(rowId)) throw Object.assign(new Error('duplicate'), { code: 409 })
      const row = { $id: rowId, $createdAt: new Date().toISOString(), $updatedAt: new Date().toISOString(), ...data }
      map.set(rowId, row)
      return row
    },
    async getRow({ tableId, rowId }) {
      const row = (tableId === 'orders' ? orders : invoices).get(rowId)
      if (!row) throw Object.assign(new Error('missing'), { code: 404 })
      return row
    },
    async updateRow({ tableId, rowId, data }) {
      const map = tableId === 'orders' ? orders : invoices
      const row = { ...map.get(rowId), ...data, $updatedAt: new Date().toISOString() }
      map.set(rowId, row)
      return row
    },
  }
}

function queryValue(query) { return JSON.parse(query).values[0] }

test('注文の金額はサーバー側で計算し、再送しても1件だけ作成する', async () => {
  const tables = fakeTables()
  const key = '72f18384-84be-4987-91b8-f8ae3c2f9a57'
  const first = await internals.create(tables, owner, { ...draft, fee: 0, total: 1, status: '支払い済み' }, key)
  assert.equal(first.order.fee, 2000)
  assert.equal(first.order.total, 22000)
  assert.equal(first.order.status, '依頼受付')
  const second = await internals.create(tables, owner, draft, key)
  assert.equal(second.order.id, first.order.id)
  assert.equal(tables.orders.size, 1)
})

test('依頼者以外は注文を見られず、管理者だけ進捗を変更できる', async () => {
  const tables = fakeTables()
  const { order } = await internals.create(tables, owner, draft, '72f18384-84be-4987-91b8-f8ae3c2f9a58')
  assert.equal(await internals.rowFor(tables, stranger, order.id), null)
  assert.equal((await internals.changeStatus(tables, stranger, order.id, '発送済み')).code, 403)
  assert.equal((await internals.changeStatus(tables, admin, order.id, '発送済み')).order.status, '発送済み')
})

test('請求書の発行は管理者だけで、再発行しても内容が変わらない', async () => {
  const tables = fakeTables()
  const { order } = await internals.create(tables, owner, draft, '72f18384-84be-4987-91b8-f8ae3c2f9a59')
  assert.equal((await internals.getInvoice(tables, stranger, order.id)).code, 404)
  assert.equal((await internals.issueInvoice(tables, owner, order.id)).code, 403)
  process.env.ISSUER_NAME = 'テスト専用の発行者'
  process.env.ISSUER_ADDRESS = 'テスト用住所'
  process.env.ISSUER_CONTACT = 'test@example.com'
  process.env.ISSUER_TAX_DETAILS = 'テスト用'
  process.env.PAYMENT_INSTRUCTIONS = 'テスト用'
  const first = await internals.issueInvoice(tables, admin, order.id)
  process.env.ISSUER_NAME = '変更された発行者'
  const second = await internals.issueInvoice(tables, admin, order.id)
  assert.deepEqual(second.invoice, first.invoice)
  assert.equal(first.invoice.issuerName, 'テスト専用の発行者')
  assert.equal((await internals.getInvoice(tables, owner, order.id)).invoice.orderId, order.id)
})
