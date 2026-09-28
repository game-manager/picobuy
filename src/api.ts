import { Account, AppwriteException, Client, Functions, OAuthProvider, type Models } from 'appwrite'
import type { Draft, Order, Status } from './data'

export type User = { id: string; email: string; role: 'customer' | 'admin' }
export type Invoice = { id: string; orderId: string; issuerName: string; issuerAddress: string; issuerContact: string; issuerTaxDetails: string; paymentInstructions: string; customerEmail: string; productName: string; price: number; quantity: number; fee: number; total: number; paymentDue: string; notes: string; issuedAt: string }

export class ApiError extends Error {
  constructor(message: string, public status: number) { super(message) }
}

const endpoint = import.meta.env.VITE_APPWRITE_ENDPOINT as string | undefined
const projectId = import.meta.env.VITE_APPWRITE_PROJECT_ID as string | undefined
const functionId = import.meta.env.VITE_APPWRITE_FUNCTION_ID as string | undefined
const configured = !!(endpoint && projectId && functionId)
const client = configured ? new Client().setEndpoint(endpoint!).setProject(projectId!) : null
const account = client ? new Account(client) : null
const functions = client ? new Functions(client) : null

function toUser(value: Models.User<Models.Preferences>): User {
  return { id: value.$id, email: value.email, role: value.labels?.includes('admin') ? 'admin' : 'customer' }
}

function asApiError(cause: unknown) {
  if (cause instanceof AppwriteException) return new ApiError(cause.message || '通信に失敗しました。', cause.code || 500)
  return cause instanceof Error ? cause : new ApiError('通信に失敗しました。時間をおいて再試行してください。', 500)
}

async function execute<T>(action: string, data: Record<string, unknown> = {}): Promise<T> {
  if (!functions || !functionId) throw new ApiError('サービスの設定が完了していません。', 503)
  try {
    const execution = await functions.createExecution({ functionId, body: JSON.stringify({ action, ...data }) })
    const result = JSON.parse(execution.responseBody || '{}') as T & { error?: string }
    if (execution.responseStatusCode < 200 || execution.responseStatusCode >= 300) {
      throw new ApiError(result.error || '操作に失敗しました。', execution.responseStatusCode || 500)
    }
    return result
  } catch (cause) { throw asApiError(cause) }
}

export const authApi = {
  health: async () => configured ? execute<{ ready: boolean; turnstileSiteKey: string }>('health').then(value => ({ ...value, turnstileSiteKey: '' })) : { ready: false, turnstileSiteKey: '' },
  completeGoogleLogin: async () => {
    const url = new URL(location.href)
    const userId = url.searchParams.get('userId')
    const secret = url.searchParams.get('secret')
    if (!userId || !secret) return false
    url.searchParams.delete('userId')
    url.searchParams.delete('secret')
    history.replaceState(null, '', url)
    if (!account) throw new ApiError('サービスの設定が完了していません。', 503)
    try { await account.createSession({ userId, secret }); location.hash = '/history'; return true }
    catch (cause) { throw asApiError(cause) }
  },
  me: async () => {
    if (!account) throw new ApiError('サービスの設定が完了していません。', 503)
    try { return { user: toUser(await account.get()) } } catch (cause) { throw asApiError(cause) }
  },
  loginWithGoogle: async () => {
    if (!account) throw new ApiError('サービスの設定が完了していません。', 503)
    const callback = `${location.origin}${location.pathname}`
    try { account.createOAuth2Token({ provider: OAuthProvider.Google, success: callback, failure: `${callback}#/login` }) }
    catch (cause) { throw asApiError(cause) }
  },
  logout: async () => {
    if (!account) throw new ApiError('サービスの設定が完了していません。', 503)
    try { await account.deleteSession({ sessionId: 'current' }); return { ok: true } }
    catch (cause) { throw asApiError(cause) }
  },
}

export const orderApi = {
  list: () => execute<{ orders: Order[] }>('listOrders'),
  get: (id: string) => execute<{ order: Order }>('getOrder', { id }),
  create: (draft: Draft, idempotencyKey: string) => execute<{ order: Order }>('createOrder', { draft, idempotencyKey }),
  status: (id: string, status: Status) => execute<{ order: Order }>('setStatus', { id, status }),
  invoice: (id: string) => execute<{ invoice: Invoice }>('getInvoice', { id }),
  issueInvoice: (id: string) => execute<{ invoice: Invoice }>('issueInvoice', { id }),
}
