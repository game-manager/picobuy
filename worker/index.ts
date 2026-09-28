import { isAmazonUrl, statuses, type Draft, type Status } from '../src/data'

interface Env {
  DB: D1Database
  ASSETS: Fetcher
  AUTH_SECRET?: string
  RESEND_API_KEY?: string
  MAIL_FROM?: string
  TURNSTILE_SITE_KEY?: string
  TURNSTILE_SECRET_KEY?: string
  ISSUER_NAME?: string
  ISSUER_ADDRESS?: string
  ISSUER_CONTACT?: string
  ISSUER_TAX_DETAILS?: string
  PAYMENT_INSTRUCTIONS?: string
  ENVIRONMENT: string
}

type UserRow = { id: string; email: string; role: 'customer' | 'admin' }
type OrderRow = {
  id: string; user_id: string; customer_email?: string; product_name: string; amazon_url: string
  price: number; quantity: number; fee: number; total: number; payment_due: string
  status: Status; notes: string; created_at: string; updated_at: string
}
type InvoiceRow = {
  id: string; order_id: string; issuer_name: string; issuer_address: string; issuer_contact: string
  issuer_tax_details: string; payment_instructions: string; customer_email: string; product_name: string
  price: number; quantity: number; fee: number; total: number; payment_due: string; notes: string; issued_at: string
}

const cookieName = '__Host-picobuy_session'
const encoder = new TextEncoder()
const hour = 60 * 60
const sessionSeconds = 7 * 24 * hour

function json(body: unknown, status = 200, headers: Record<string, string> = {}) {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...headers } })
}
function error(message: string, status: number) { return json({ error: message }, status) }
function securityHeaders(response: Response) {
  const result = new Response(response.body, response)
  result.headers.set('x-content-type-options', 'nosniff')
  result.headers.set('referrer-policy', 'strict-origin-when-cross-origin')
  result.headers.set('x-frame-options', 'DENY')
  result.headers.set('permissions-policy', 'camera=(), microphone=(), geolocation=()')
  result.headers.set('content-security-policy', "default-src 'self'; script-src 'self' https://challenges.cloudflare.com; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self' https://challenges.cloudflare.com; frame-src https://challenges.cloudflare.com; font-src 'self'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'")
  return result
}
async function bodyJson(request: Request): Promise<Record<string, unknown> | null> {
  if (!request.headers.get('content-type')?.startsWith('application/json')) return null
  if (Number(request.headers.get('content-length') || 0) > 16384) return null
  try { const raw = await request.text(); if (raw.length > 16384) return null; const value: unknown = JSON.parse(raw); return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null } catch { return null }
}
function validEmail(value: unknown): value is string { return typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value) }
function hex(bytes: ArrayBuffer | Uint8Array) { return Array.from(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), byte => byte.toString(16).padStart(2, '0')).join('') }
async function sha256(value: string) { return hex(await crypto.subtle.digest('SHA-256', encoder.encode(value))) }
async function hmac(secret: string, value: string) { const key = await crypto.subtle.importKey('raw', encoder.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']); return hex(await crypto.subtle.sign('HMAC', key, encoder.encode(value))) }
function fixedEqual(a: string, b: string) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i); return diff === 0 }
function randomToken(bytes = 32) { return hex(crypto.getRandomValues(new Uint8Array(bytes))) }
function sessionCookie(value: string, maxAge: number) { return `${cookieName}=${value}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAge}` }
function readCookie(request: Request) { const entry = request.headers.get('cookie')?.split(';').map(item => item.trim()).find(item => item.startsWith(`${cookieName}=`)); return entry?.slice(cookieName.length + 1) || '' }
function isSameOrigin(request: Request) { return request.headers.get('origin') === new URL(request.url).origin }

async function getUser(request: Request, env: Env): Promise<UserRow | null> {
  const token = readCookie(request)
  if (!/^[a-f0-9]{64}$/.test(token)) return null
  const tokenHash = await sha256(token)
  return await env.DB.prepare('SELECT users.id, users.email, users.role FROM sessions JOIN users ON users.id = sessions.user_id WHERE sessions.token_hash = ? AND sessions.expires_at > ?').bind(tokenHash, Math.floor(Date.now() / 1000)).first<UserRow>()
}

async function verifyTurnstile(token: unknown, request: Request, env: Env) {
  if (!env.TURNSTILE_SECRET_KEY || typeof token !== 'string' || !token) return false
  const form = new FormData()
  form.set('secret', env.TURNSTILE_SECRET_KEY)
  form.set('response', token)
  const ip = request.headers.get('CF-Connecting-IP')
  if (ip) form.set('remoteip', ip)
  const result = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: form })
  if (!result.ok) return false
  const parsed = await result.json() as { success?: boolean; hostname?: string }
  return parsed.success === true && parsed.hostname === new URL(request.url).hostname
}

async function sendCode(env: Env, email: string, code: string) {
  if (!env.RESEND_API_KEY || !env.MAIL_FROM) return false
  const result = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${env.RESEND_API_KEY}`, 'content-type': 'application/json' },
    body: JSON.stringify({ from: env.MAIL_FROM, to: [email], subject: 'PicoBuy ログイン認証コード', text: `PicoBuyの認証コードは ${code} です。10分以内に入力してください。心当たりがない場合は、このメールを無視してください。` }),
  })
  return result.ok
}

async function requestCode(request: Request, env: Env) {
  if (!env.AUTH_SECRET || !env.RESEND_API_KEY || !env.MAIL_FROM || !env.TURNSTILE_SECRET_KEY) return error('認証サービスの設定が完了していません。', 503)
  const body = await bodyJson(request)
  if (!body || !validEmail(body.email)) return error('有効なメールアドレスを入力してください。', 400)
  if (!await verifyTurnstile(body.turnstileToken, request, env)) return error('セキュリティ確認に失敗しました。', 400)
  const email = body.email.trim().toLowerCase()
  const now = Math.floor(Date.now() / 1000)
  const ipHash = await hmac(env.AUTH_SECRET, request.headers.get('CF-Connecting-IP') || 'unknown')
  const previous = await env.DB.prepare('SELECT sent_at FROM login_codes WHERE email = ?').bind(email).first<{ sent_at: number }>()
  if (previous && previous.sent_at > now - 60) return error('少し時間をおいて再試行してください。', 429)
  const [emailCount, ipCount] = await Promise.all([
    env.DB.prepare('SELECT COUNT(*) AS n FROM auth_requests WHERE email = ? AND created_at > ?').bind(email, now - hour).first<{ n: number }>(),
    env.DB.prepare('SELECT COUNT(*) AS n FROM auth_requests WHERE ip_hash = ? AND created_at > ?').bind(ipHash, now - hour).first<{ n: number }>(),
  ])
  if ((emailCount?.n || 0) >= 5 || (ipCount?.n || 0) >= 20) return error('しばらく時間をおいて再試行してください。', 429)
  const code = String(crypto.getRandomValues(new Uint32Array(1))[0] % 1000000).padStart(6, '0')
  const codeHash = await hmac(env.AUTH_SECRET, `${email}:${code}`)
  await env.DB.prepare('INSERT INTO login_codes(email, code_hash, expires_at, attempts, sent_at) VALUES(?, ?, ?, 0, ?) ON CONFLICT(email) DO UPDATE SET code_hash=excluded.code_hash, expires_at=excluded.expires_at, attempts=0, sent_at=excluded.sent_at').bind(email, codeHash, now + 600, now).run()
  try {
    if (!await sendCode(env, email, code)) { await env.DB.prepare('DELETE FROM login_codes WHERE email = ? AND code_hash = ?').bind(email, codeHash).run(); return error('メールを送信できませんでした。', 502) }
  } catch { await env.DB.prepare('DELETE FROM login_codes WHERE email = ? AND code_hash = ?').bind(email, codeHash).run(); return error('メールを送信できませんでした。', 502) }
  await env.DB.prepare('INSERT INTO auth_requests(id, email, ip_hash, created_at) VALUES(?, ?, ?, ?)').bind(crypto.randomUUID(), email, ipHash, now).run()
  return json({ ok: true })
}

async function verifyCode(request: Request, env: Env) {
  if (!env.AUTH_SECRET) return error('認証サービスの設定が完了していません。', 503)
  const body = await bodyJson(request)
  if (!body || !validEmail(body.email) || typeof body.code !== 'string' || !/^\d{6}$/.test(body.code)) return error('メールアドレスと6桁のコードを入力してください。', 400)
  const email = body.email.trim().toLowerCase()
  const row = await env.DB.prepare('SELECT code_hash, expires_at, attempts FROM login_codes WHERE email = ?').bind(email).first<{ code_hash: string; expires_at: number; attempts: number }>()
  const now = Math.floor(Date.now() / 1000)
  if (!row || row.expires_at < now || row.attempts >= 5) return error('認証コードが無効か期限切れです。', 400)
  const codeHash = await hmac(env.AUTH_SECRET, `${email}:${body.code}`)
  if (!fixedEqual(codeHash, row.code_hash)) {
    await env.DB.prepare('UPDATE login_codes SET attempts = attempts + 1 WHERE email = ? AND attempts < 5').bind(email).run()
    return error('認証コードが無効か期限切れです。', 400)
  }
  const consumed = await env.DB.prepare('DELETE FROM login_codes WHERE email = ? AND code_hash = ? AND expires_at >= ? AND attempts < 5').bind(email, codeHash, now).run()
  if (consumed.meta.changes !== 1) return error('認証コードが無効か期限切れです。', 400)
  const createdAt = new Date().toISOString()
  await env.DB.prepare("INSERT INTO users(id, email, role, created_at) VALUES(?, ?, 'customer', ?) ON CONFLICT(email) DO NOTHING").bind(crypto.randomUUID(), email, createdAt).run()
  const user = await env.DB.prepare('SELECT id, email, role FROM users WHERE email = ?').bind(email).first<UserRow>()
  if (!user) return error('認証できませんでした。', 500)
  const token = randomToken()
  await env.DB.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)').bind(await sha256(token), user.id, now + sessionSeconds, now).run()
  return json({ user }, 200, { 'set-cookie': sessionCookie(token, sessionSeconds) })
}

function validateDraft(body: Record<string, unknown> | null): Draft | null {
  if (!body || typeof body.productName !== 'string' || body.productName.trim().length < 1 || body.productName.length > 200) return null
  if (typeof body.amazonUrl !== 'string' || body.amazonUrl.length > 2000 || !isAmazonUrl(body.amazonUrl)) return null
  if (typeof body.price !== 'number' || !Number.isSafeInteger(body.price) || body.price < 1 || body.price > 100000000) return null
  if (typeof body.quantity !== 'number' || !Number.isSafeInteger(body.quantity) || body.quantity < 1 || body.quantity > 99) return null
  if (typeof body.paymentDue !== 'string' || !Number.isFinite(Date.parse(body.paymentDue)) || Date.parse(body.paymentDue) <= Date.now()) return null
  if (typeof body.notes !== 'string' || body.notes.length > 2000) return null
  return { productName: body.productName.trim(), amazonUrl: body.amazonUrl, price: body.price, quantity: body.quantity, paymentDue: new Date(body.paymentDue).toISOString(), notes: body.notes.trim() }
}

function orderDto(row: OrderRow) {
  return { id: row.id, customerEmail: row.customer_email, productName: row.product_name, amazonUrl: row.amazon_url, price: row.price, quantity: row.quantity, fee: row.fee, total: row.total, paymentDue: row.payment_due, status: row.status, notes: row.notes, createdAt: row.created_at, updatedAt: row.updated_at }
}
function invoiceDto(row: InvoiceRow) { return { id: row.id, orderId: row.order_id, issuerName: row.issuer_name, issuerAddress: row.issuer_address, issuerContact: row.issuer_contact, issuerTaxDetails: row.issuer_tax_details, paymentInstructions: row.payment_instructions, customerEmail: row.customer_email, productName: row.product_name, price: row.price, quantity: row.quantity, fee: row.fee, total: row.total, paymentDue: row.payment_due, notes: row.notes, issuedAt: row.issued_at } }

async function listOrders(env: Env, user: UserRow) {
  const sql = 'SELECT orders.*, users.email AS customer_email FROM orders JOIN users ON users.id = orders.user_id'
  const result = user.role === 'admin'
    ? await env.DB.prepare(`${sql} ORDER BY orders.created_at DESC, orders.id DESC`).all<OrderRow>()
    : await env.DB.prepare(`${sql} WHERE orders.user_id = ? ORDER BY orders.created_at DESC, orders.id DESC`).bind(user.id).all<OrderRow>()
  return json({ orders: result.results.map(orderDto) })
}

async function getOrder(env: Env, user: UserRow, id: string) {
  const row = await env.DB.prepare('SELECT orders.*, users.email AS customer_email FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ? AND (orders.user_id = ? OR ? = \'admin\')').bind(id, user.id, user.role).first<OrderRow>()
  if (!row) return error('注文が見つかりません。', 404)
  const events = await env.DB.prepare('SELECT status, created_at FROM status_events WHERE order_id = ? ORDER BY created_at ASC').bind(id).all<{ status: Status; created_at: string }>()
  return json({ order: { ...orderDto(row), statusEvents: events.results.map(event => ({ status: event.status, createdAt: event.created_at })) } })
}

async function createOrder(request: Request, env: Env, user: UserRow) {
  const body = await bodyJson(request)
  const draft = validateDraft(body)
  const idempotencyKey = request.headers.get('idempotency-key')
  if (!draft || !idempotencyKey || !/^[a-f0-9-]{36}$/i.test(idempotencyKey)) return error('注文内容を確認してください。', 400)
  const existing = await env.DB.prepare('SELECT orders.*, users.email AS customer_email FROM orders JOIN users ON users.id = orders.user_id WHERE orders.user_id = ? AND orders.idempotency_key = ?').bind(user.id, idempotencyKey).first<OrderRow>()
  if (existing) return json({ order: orderDto(existing) })
  const subtotal = draft.price * draft.quantity
  const fee = Math.round(subtotal * 0.1)
  const total = subtotal + fee
  const now = new Date().toISOString()
  const id = `PB-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  try {
    await env.DB.batch([
      env.DB.prepare('INSERT INTO orders(id, user_id, idempotency_key, product_name, amazon_url, price, quantity, fee, total, payment_due, status, notes, created_at, updated_at) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(id, user.id, idempotencyKey, draft.productName, draft.amazonUrl, draft.price, draft.quantity, fee, total, draft.paymentDue, statuses[0], draft.notes, now, now),
      env.DB.prepare('INSERT INTO status_events(id, order_id, status, changed_by, created_at) VALUES(?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, statuses[0], user.id, now),
    ])
  } catch {
    const duplicate = await env.DB.prepare('SELECT orders.*, users.email AS customer_email FROM orders JOIN users ON users.id = orders.user_id WHERE orders.user_id = ? AND orders.idempotency_key = ?').bind(user.id, idempotencyKey).first<OrderRow>()
    if (duplicate) return json({ order: orderDto(duplicate) })
    return error('注文を保存できませんでした。', 500)
  }
  return getOrder(env, user, id)
}

async function setStatus(request: Request, env: Env, user: UserRow, id: string) {
  if (user.role !== 'admin') return error('管理者権限が必要です。', 403)
  const body = await bodyJson(request)
  if (!body || typeof body.status !== 'string' || !statuses.includes(body.status as Status)) return error('無効なステータスです。', 400)
  const existing = await env.DB.prepare('SELECT status FROM orders WHERE id = ?').bind(id).first<{ status: Status }>()
  if (!existing) return error('注文が見つかりません。', 404)
  if (existing.status === body.status) return getOrder(env, user, id)
  const now = new Date().toISOString()
  await env.DB.batch([
    env.DB.prepare('UPDATE orders SET status = ?, updated_at = ? WHERE id = ?').bind(body.status, now, id),
    env.DB.prepare('INSERT INTO status_events(id, order_id, status, changed_by, created_at) VALUES(?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, body.status, user.id, now),
  ])
  return getOrder(env, user, id)
}

async function invoiceFor(env: Env, user: UserRow, id: string) {
  const allowed = await env.DB.prepare("SELECT id FROM orders WHERE id = ? AND (user_id = ? OR ? = 'admin')").bind(id, user.id, user.role).first()
  if (!allowed) return error('注文が見つかりません。', 404)
  const row = await env.DB.prepare('SELECT * FROM invoices WHERE order_id = ?').bind(id).first<InvoiceRow>()
  if (!row) return error('請求書はまだ発行されていません。', 404)
  return json({ invoice: invoiceDto(row) })
}

async function issueInvoice(env: Env, user: UserRow, id: string) {
  if (user.role !== 'admin') return error('管理者権限が必要です。', 403)
  if (!env.ISSUER_NAME || !env.ISSUER_ADDRESS || !env.ISSUER_CONTACT || !env.ISSUER_TAX_DETAILS || !env.PAYMENT_INSTRUCTIONS) return error('請求書の発行情報が設定されていません。', 503)
  const existing = await env.DB.prepare('SELECT * FROM invoices WHERE order_id = ?').bind(id).first<InvoiceRow>()
  if (existing) return json({ invoice: invoiceDto(existing) })
  const order = await env.DB.prepare('SELECT orders.*, users.email AS customer_email FROM orders JOIN users ON users.id = orders.user_id WHERE orders.id = ?').bind(id).first<OrderRow>()
  if (!order) return error('注文が見つかりません。', 404)
  const now = new Date().toISOString()
  const invoiceId = `INV-${now.slice(0, 10).replaceAll('-', '')}-${crypto.randomUUID().slice(0, 8).toUpperCase()}`
  const statements = [env.DB.prepare('INSERT INTO invoices(id, order_id, issuer_name, issuer_address, issuer_contact, issuer_tax_details, payment_instructions, customer_email, product_name, price, quantity, fee, total, payment_due, notes, issued_at, issued_by) VALUES(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').bind(invoiceId, id, env.ISSUER_NAME, env.ISSUER_ADDRESS, env.ISSUER_CONTACT, env.ISSUER_TAX_DETAILS, env.PAYMENT_INSTRUCTIONS, order.customer_email, order.product_name, order.price, order.quantity, order.fee, order.total, order.payment_due, order.notes, now, user.id)]
  if (order.status === '依頼受付') {
    statements.push(env.DB.prepare("UPDATE orders SET status = '支払い待ち', updated_at = ? WHERE id = ?").bind(now, id))
    statements.push(env.DB.prepare('INSERT INTO status_events(id, order_id, status, changed_by, created_at) VALUES(?, ?, ?, ?, ?)').bind(crypto.randomUUID(), id, '支払い待ち', user.id, now))
  }
  try { await env.DB.batch(statements) } catch {
    const duplicate = await env.DB.prepare('SELECT * FROM invoices WHERE order_id = ?').bind(id).first<InvoiceRow>()
    if (duplicate) return json({ invoice: invoiceDto(duplicate) })
    return error('請求書を発行できませんでした。', 500)
  }
  return invoiceFor(env, user, id)
}

async function api(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url)
  const path = url.pathname
  const method = request.method
  if (method !== 'GET' && !isSameOrigin(request)) return error('不正なリクエストです。', 403)
  if (path === '/api/health' && method === 'GET') {
    let databaseReady = false
    try { await env.DB.prepare('SELECT id FROM users LIMIT 1').first(); await env.DB.prepare('SELECT id FROM invoices LIMIT 1').first(); databaseReady = true } catch { /* Migrations have not been applied. */ }
    return json({ ready: databaseReady && !!(env.AUTH_SECRET && env.AUTH_SECRET.length >= 32 && env.RESEND_API_KEY && env.MAIL_FROM && env.TURNSTILE_SITE_KEY && env.TURNSTILE_SECRET_KEY && env.ISSUER_NAME && env.ISSUER_ADDRESS && env.ISSUER_CONTACT && env.ISSUER_TAX_DETAILS && env.PAYMENT_INSTRUCTIONS), turnstileSiteKey: env.TURNSTILE_SITE_KEY || '' })
  }
  if (path === '/api/auth/request-code' && method === 'POST') return requestCode(request, env)
  if (path === '/api/auth/verify-code' && method === 'POST') return verifyCode(request, env)
  const user = await getUser(request, env)
  if (!user) return error('ログインが必要です。', 401)
  if (path === '/api/auth/me' && method === 'GET') return json({ user })
  if (path === '/api/auth/logout' && method === 'POST') {
    const token = readCookie(request)
    if (token) await env.DB.prepare('DELETE FROM sessions WHERE token_hash = ?').bind(await sha256(token)).run()
    return json({ ok: true }, 200, { 'set-cookie': sessionCookie('', 0) })
  }
  if (path === '/api/orders' && method === 'GET') return listOrders(env, user)
  if (path === '/api/orders' && method === 'POST') return createOrder(request, env, user)
  const match = /^\/api\/orders\/(PB-[A-Z0-9-]+)$/.exec(path)
  if (match && method === 'GET') return getOrder(env, user, match[1])
  if (match && method === 'PATCH') return setStatus(request, env, user, match[1])
  const invoiceMatch = /^\/api\/orders\/(PB-[A-Z0-9-]+)\/invoice$/.exec(path)
  if (invoiceMatch && method === 'GET') return invoiceFor(env, user, invoiceMatch[1])
  if (invoiceMatch && method === 'POST') return issueInvoice(env, user, invoiceMatch[1])
  return error('ページが見つかりません。', 404)
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    try {
      const response = new URL(request.url).pathname.startsWith('/api/') ? await api(request, env) : await env.ASSETS.fetch(request)
      return securityHeaders(response)
    } catch (cause) {
      console.error('Request failed', cause instanceof Error ? cause.message : 'unknown')
      return securityHeaders(error('サーバーエラーが発生しました。', 500))
    }
  },
  async scheduled(_controller: ScheduledController, env: Env): Promise<void> {
    const now = Math.floor(Date.now() / 1000)
    await env.DB.batch([
      env.DB.prepare('DELETE FROM login_codes WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM sessions WHERE expires_at < ?').bind(now),
      env.DB.prepare('DELETE FROM auth_requests WHERE created_at < ?').bind(now - 24 * hour),
    ])
  },
} satisfies ExportedHandler<Env>
