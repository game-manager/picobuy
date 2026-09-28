import { Account, Client, Query, TablesDB, Users } from 'node-appwrite'

const statuses = ['依頼受付', '支払い待ち', '支払い済み', '注文済み', '発送待ち', '発送済み', '到着', '受け渡し完了']
const databaseId = 'picobuy'
const ordersTable = 'orders'
const invoicesTable = 'invoices'

const reply = (res, body, code = 200) => res.json(body, code)
const failure = (res, message, code) => reply(res, { error: message }, code)
const requiredConfig = () => [
  'APPWRITE_ENDPOINT', 'APPWRITE_PROJECT_ID', 'ISSUER_NAME', 'ISSUER_ADDRESS',
  'ISSUER_CONTACT', 'ISSUER_TAX_DETAILS', 'PAYMENT_INSTRUCTIONS',
].every(name => typeof process.env[name] === 'string' && process.env[name].trim())

function isAmazonUrl(value) {
  try {
    const url = new URL(value)
    const domains = ['amazon.co.jp', 'amazon.com', 'amazon.co.uk', 'amazon.de', 'amazon.fr', 'amazon.it', 'amazon.es', 'amazon.ca', 'amazon.com.au', 'amazon.com.br', 'amazon.in', 'amazon.sg', 'amazon.nl', 'amazon.se', 'amazon.pl', 'amazon.ae', 'amazon.sa', 'amazon.com.mx']
    return url.protocol === 'https:' && domains.some(domain => url.hostname === domain || url.hostname.endsWith(`.${domain}`)) && /\/(?:dp|gp\/product|gp\/aw\/d)\/[A-Z0-9]{10}(?:\/|$)/i.test(url.pathname)
  } catch { return false }
}

function validDraft(draft) {
  if (!draft || typeof draft !== 'object') return null
  const { productName, amazonUrl, price, quantity, paymentDue, notes } = draft
  if (typeof productName !== 'string' || !productName.trim() || productName.length > 200) return null
  if (typeof amazonUrl !== 'string' || amazonUrl.length > 2000 || !isAmazonUrl(amazonUrl)) return null
  if (!Number.isSafeInteger(price) || price < 1 || price > 100000000) return null
  if (!Number.isSafeInteger(quantity) || quantity < 1 || quantity > 99) return null
  if (typeof paymentDue !== 'string' || !Number.isFinite(Date.parse(paymentDue)) || Date.parse(paymentDue) <= Date.now()) return null
  if (typeof notes !== 'string' || notes.length > 2000) return null
  return { productName: productName.trim(), amazonUrl, price, quantity, paymentDue: new Date(paymentDue).toISOString(), notes: notes.trim() }
}

function orderDto(row) {
  return {
    id: row.$id, customerEmail: row.customerEmail, productName: row.productName,
    amazonUrl: row.amazonUrl, price: row.price, quantity: row.quantity,
    fee: row.fee, total: row.total, paymentDue: row.paymentDue,
    status: row.status, notes: row.notes, createdAt: row.$createdAt,
    updatedAt: row.$updatedAt, statusEvents: JSON.parse(row.statusEvents || '[]'),
  }
}

function clients(key, jwt) {
  const endpoint = process.env.APPWRITE_ENDPOINT
  const project = process.env.APPWRITE_PROJECT_ID
  const adminClient = new Client().setEndpoint(endpoint).setProject(project).setKey(key)
  const userClient = new Client().setEndpoint(endpoint).setProject(project).setJWT(jwt)
  return { tables: new TablesDB(adminClient), users: new Users(adminClient), account: new Account(userClient) }
}

async function rowFor(tables, user, id) {
  if (typeof id !== 'string' || !/^PB-[0-9]{8}-[A-F0-9]{8}$/.test(id)) return null
  let row
  try { row = await tables.getRow({ databaseId, tableId: ordersTable, rowId: id }) } catch (cause) { if (cause.code === 404) return null; throw cause }
  return row.userId === user.$id || user.labels?.includes('admin') ? row : null
}

async function list(tables, user) {
  const queries = [Query.orderDesc('$createdAt'), Query.limit(100)]
  if (!user.labels?.includes('admin')) queries.unshift(Query.equal('userId', user.$id))
  const result = await tables.listRows({ databaseId, tableId: ordersTable, queries })
  return { orders: result.rows.map(orderDto) }
}

async function create(tables, user, draftInput, key) {
  const draft = validDraft(draftInput)
  if (!draft || typeof key !== 'string' || !/^[a-f0-9-]{36}$/i.test(key)) return { error: '注文内容を確認してください。', code: 400 }
  const existing = await tables.listRows({ databaseId, tableId: ordersTable, queries: [Query.equal('idempotencyKey', key), Query.limit(1)] })
  if (existing.rows.length) return existing.rows[0].userId === user.$id ? { order: orderDto(existing.rows[0]) } : { error: '注文を保存できませんでした。', code: 409 }
  const now = new Date().toISOString()
  const id = `PB-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const fee = Math.round(draft.price * draft.quantity * 0.1)
  const data = {
    userId: user.$id, customerEmail: user.email, idempotencyKey: key, ...draft,
    fee, total: draft.price * draft.quantity + fee, status: statuses[0],
    statusEvents: JSON.stringify([{ status: statuses[0], createdAt: now }]),
  }
  try {
    const row = await tables.createRow({ databaseId, tableId: ordersTable, rowId: id, data, permissions: [] })
    return { order: orderDto(row) }
  } catch (cause) {
    if (cause.code === 409) {
      const retry = await tables.listRows({ databaseId, tableId: ordersTable, queries: [Query.equal('idempotencyKey', key), Query.limit(1)] })
      if (retry.rows[0]?.userId === user.$id) return { order: orderDto(retry.rows[0]) }
    }
    throw cause
  }
}

async function changeStatus(tables, user, id, status) {
  if (!user.labels?.includes('admin')) return { error: '管理者権限が必要です。', code: 403 }
  if (!statuses.includes(status)) return { error: '無効なステータスです。', code: 400 }
  const row = await rowFor(tables, user, id)
  if (!row) return { error: '注文が見つかりません。', code: 404 }
  if (row.status === status) return { order: orderDto(row) }
  const events = JSON.parse(row.statusEvents || '[]')
  events.push({ status, createdAt: new Date().toISOString() })
  const updated = await tables.updateRow({ databaseId, tableId: ordersTable, rowId: id, data: { status, statusEvents: JSON.stringify(events) } })
  return { order: orderDto(updated) }
}

async function getInvoice(tables, user, id) {
  if (!await rowFor(tables, user, id)) return { error: '注文が見つかりません。', code: 404 }
  try {
    const row = await tables.getRow({ databaseId, tableId: invoicesTable, rowId: id })
    return { invoice: JSON.parse(row.snapshot) }
  } catch (cause) {
    if (cause.code === 404) return { error: '請求書はまだ発行されていません。', code: 404 }
    throw cause
  }
}

async function issueInvoice(tables, user, id) {
  if (!user.labels?.includes('admin')) return { error: '管理者権限が必要です。', code: 403 }
  const order = await rowFor(tables, user, id)
  if (!order) return { error: '注文が見つかりません。', code: 404 }
  const existing = await getInvoice(tables, user, id)
  if (existing.invoice) return existing
  const now = new Date().toISOString()
  const invoice = {
    id: `INV-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`,
    orderId: id, issuerName: process.env.ISSUER_NAME, issuerAddress: process.env.ISSUER_ADDRESS,
    issuerContact: process.env.ISSUER_CONTACT, issuerTaxDetails: process.env.ISSUER_TAX_DETAILS,
    paymentInstructions: process.env.PAYMENT_INSTRUCTIONS, customerEmail: order.customerEmail,
    productName: order.productName, price: order.price, quantity: order.quantity,
    fee: order.fee, total: order.total, paymentDue: order.paymentDue,
    notes: order.notes, issuedAt: now,
  }
  try {
    await tables.createRow({ databaseId, tableId: invoicesTable, rowId: id, data: { orderId: id, snapshot: JSON.stringify(invoice) }, permissions: [] })
    return { invoice }
  } catch (cause) {
    if (cause.code === 409) return getInvoice(tables, user, id)
    throw cause
  }
}

export default async ({ req, res, error }) => {
  try {
    const input = req.bodyJson && typeof req.bodyJson === 'object' ? req.bodyJson : {}
    if (input.action === 'health') {
      if (!requiredConfig() || !req.headers['x-appwrite-key']) return reply(res, { ready: false })
      try {
        const client = new Client().setEndpoint(process.env.APPWRITE_ENDPOINT).setProject(process.env.APPWRITE_PROJECT_ID).setKey(req.headers['x-appwrite-key'])
        const tables = new TablesDB(client)
        await Promise.all([
          tables.getTable({ databaseId, tableId: ordersTable }),
          tables.getTable({ databaseId, tableId: invoicesTable }),
        ])
        return reply(res, { ready: true })
      } catch { return reply(res, { ready: false }) }
    }
    if (!requiredConfig()) return failure(res, 'サービスの設定が完了していません。', 503)
    const key = req.headers['x-appwrite-key']
    const jwt = req.headers['x-appwrite-user-jwt']
    if (!key || !jwt) return failure(res, 'ログインが必要です。', 401)
    const { tables, account } = clients(key, jwt)
    const user = await account.get()
    let result
    switch (input.action) {
      case 'listOrders': result = await list(tables, user); break
      case 'getOrder': {
        const row = await rowFor(tables, user, input.id)
        result = row ? { order: orderDto(row) } : { error: '注文が見つかりません。', code: 404 }
        break
      }
      case 'createOrder': result = await create(tables, user, input.draft, input.idempotencyKey); break
      case 'setStatus': result = await changeStatus(tables, user, input.id, input.status); break
      case 'getInvoice': result = await getInvoice(tables, user, input.id); break
      case 'issueInvoice': result = await issueInvoice(tables, user, input.id); break
      default: result = { error: '操作が見つかりません。', code: 404 }
    }
    return result.error ? failure(res, result.error, result.code) : reply(res, result)
  } catch (cause) {
    error(cause instanceof Error ? cause.message : 'Unknown error')
    return failure(res, 'サーバーエラーが発生しました。', 500)
  }
}

export const internals = { isAmazonUrl, validDraft, orderDto, rowFor, create, changeStatus, getInvoice, issueInvoice }
