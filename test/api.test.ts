import { env } from 'cloudflare:test'
import { describe, expect, it } from 'vitest'
import worker from '../worker/index'

const origin = 'https://picobuy.test'
async function call(path: string, options: RequestInit = {}) {
  return worker.fetch(new Request(`${origin}${path}`, options), env as never)
}
async function account(role: 'customer' | 'admin') {
  const id = crypto.randomUUID()
  const email = `${id}@example.invalid`
  const token = Array.from(crypto.getRandomValues(new Uint8Array(32)), byte => byte.toString(16).padStart(2, '0')).join('')
  const hash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))), byte => byte.toString(16).padStart(2, '0')).join('')
  await env.DB.prepare('INSERT INTO users(id, email, role, created_at) VALUES(?, ?, ?, ?)').bind(id, email, role, new Date().toISOString()).run()
  await env.DB.prepare('INSERT INTO sessions(token_hash, user_id, expires_at, created_at) VALUES(?, ?, ?, ?)').bind(hash, id, Math.floor(Date.now() / 1000) + 3600, Math.floor(Date.now() / 1000)).run()
  return { id, email, cookie: `__Host-picobuy_session=${token}` }
}
function postOrder(cookie: string, idempotencyKey = crypto.randomUUID()) {
  return call('/api/orders', { method: 'POST', headers: { origin, cookie, 'content-type': 'application/json', 'idempotency-key': idempotencyKey }, body: JSON.stringify({ productName: 'イヤホン', amazonUrl: 'https://www.amazon.co.jp/dp/B012345678', price: 10000, quantity: 2, paymentDue: new Date(Date.now() + 86400000).toISOString(), notes: '青色', fee: 0, total: 1, status: '支払い済み' }) })
}

describe('PicoBuy API', () => {
  it('requires login and rejects cross-origin mutations', async () => {
    expect((await call('/api/orders')).status).toBe(401)
    const response = await call('/api/auth/verify-code', { method: 'POST', headers: { origin: 'https://other.example', 'content-type': 'application/json' }, body: '{}' })
    expect(response.status).toBe(403)
  })

  it('calculates amounts on the server and keeps orders private', async () => {
    const owner = await account('customer')
    const other = await account('customer')
    const key = crypto.randomUUID()
    const created = await postOrder(owner.cookie, key)
    expect(created.status).toBe(200)
    const { order } = await created.json() as { order: { id: string; fee: number; total: number; status: string } }
    expect(order.fee).toBe(2000)
    expect(order.total).toBe(22000)
    expect(order.status).toBe('依頼受付')
    const duplicate = await postOrder(owner.cookie, key)
    expect((await duplicate.json() as { order: { id: string } }).order.id).toBe(order.id)
    expect((await call(`/api/orders/${order.id}`, { headers: { cookie: other.cookie } })).status).toBe(404)
    expect((await call(`/api/orders/${order.id}`, { headers: { cookie: owner.cookie } })).status).toBe(200)
    const forbidden = await call(`/api/orders/${order.id}`, { method: 'PATCH', headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: '発送済み' }) })
    expect(forbidden.status).toBe(403)
  })

  it('lets only an admin update the status', async () => {
    const owner = await account('customer')
    const admin = await account('admin')
    const created = await postOrder(owner.cookie)
    const { order } = await created.json() as { order: { id: string } }
    const updated = await call(`/api/orders/${order.id}`, { method: 'PATCH', headers: { origin, cookie: admin.cookie, 'content-type': 'application/json' }, body: JSON.stringify({ status: '発送済み' }) })
    expect(updated.status).toBe(200)
    expect((await updated.json() as { order: { status: string; statusEvents: unknown[] } }).order.status).toBe('発送済み')
    expect((await call(`/api/orders/${order.id}`, { headers: { cookie: owner.cookie } })).status).toBe(200)
    expect((await call(`/api/orders/${order.id}/invoice`, { method: 'POST', headers: { origin, cookie: owner.cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(403)
    expect((await call(`/api/orders/${order.id}/invoice`, { method: 'POST', headers: { origin, cookie: admin.cookie, 'content-type': 'application/json' }, body: '{}' })).status).toBe(503)
  })
})
