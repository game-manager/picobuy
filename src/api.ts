import type { Draft, Order, Status } from './data'

export type User = { id: string; email: string; role: 'customer' | 'admin' }
export type Invoice = { id: string; orderId: string; issuerName: string; issuerAddress: string; issuerContact: string; issuerTaxDetails: string; paymentInstructions: string; customerEmail: string; productName: string; price: number; quantity: number; fee: number; total: number; paymentDue: string; notes: string; issuedAt: string }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

async function api<T>(path: string, method = 'GET', data?: unknown, extraHeaders: Record<string, string> = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: { ...(data === undefined ? {} : { 'content-type': 'application/json' }), ...extraHeaders },
    body: data === undefined ? undefined : JSON.stringify(data),
  })
  const result = await response.json().catch(() => null) as T & { error?: string } | null
  if (!response.ok) throw new ApiError(result?.error || '通信に失敗しました。時間をおいて再試行してください。', response.status)
  if (!result) throw new ApiError('サーバーからの応答を読み取れませんでした。', response.status)
  return result
}

export const authApi = {
  health: () => api<{ ready: boolean; turnstileSiteKey: string }>('/health'),
  me: () => api<{ user: User }>('/auth/me'),
  requestCode: (email: string, turnstileToken: string) => api<{ ok: boolean }>('/auth/request-code', 'POST', { email, turnstileToken }),
  verifyCode: (email: string, code: string) => api<{ user: User }>('/auth/verify-code', 'POST', { email, code }),
  logout: () => api<{ ok: boolean }>('/auth/logout', 'POST', {}),
}

export const orderApi = {
  list: () => api<{ orders: Order[] }>('/orders'),
  get: (id: string) => api<{ order: Order }>(`/orders/${encodeURIComponent(id)}`),
  create: (draft: Draft, idempotencyKey: string) => api<{ order: Order }>('/orders', 'POST', draft, { 'idempotency-key': idempotencyKey }),
  status: (id: string, status: Status) => api<{ order: Order }>(`/orders/${encodeURIComponent(id)}`, 'PATCH', { status }),
  invoice: (id: string) => api<{ invoice: Invoice }>(`/orders/${encodeURIComponent(id)}/invoice`),
  issueInvoice: (id: string) => api<{ invoice: Invoice }>(`/orders/${encodeURIComponent(id)}/invoice`, 'POST', {}),
}
