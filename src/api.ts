import { FirebaseError, initializeApp } from 'firebase/app'
import { getAuth, getRedirectResult, GoogleAuthProvider, onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut, type User as FirebaseUser } from 'firebase/auth'
import { collection, doc, getDoc, getDocs, getFirestore, limit, orderBy, query, serverTimestamp, setDoc, Timestamp, updateDoc, where, type DocumentData, type QueryDocumentSnapshot } from 'firebase/firestore'
import { feeFor, isAmazonUrl, statuses, totalFor, type Draft, type Order, type Status } from './data'

export type User = { id: string; email: string; role: 'customer' | 'admin' }
export type Invoice = { id: string; orderId: string; issuerName: string; issuerAddress: string; issuerContact: string; issuerTaxDetails: string; paymentInstructions: string; customerEmail: string; productName: string; price: number; quantity: number; fee: number; total: number; paymentDue: string; notes: string; issuedAt: string }
export class ApiError extends Error { constructor(message: string, public status: number) { super(message) } }

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}
const configured = Object.values(config).every(value => typeof value === 'string' && value.length > 0)
const app = configured ? initializeApp(config) : null
const auth = app ? getAuth(app) : null
const db = app ? getFirestore(app) : null

function errorFor(cause: unknown): ApiError {
  if (cause instanceof ApiError) return cause
  if (cause instanceof FirebaseError) {
    const code = cause.code
    if (code === 'permission-denied') return new ApiError('操作が許可されていません。ログイン状態と設定を確認してください。', 403)
    if (code === 'auth/invalid-credential' || code === 'auth/wrong-password') return new ApiError('メールアドレスまたはパスワードを確認してください。', 401)
    if (code === 'auth/email-already-in-use') return new ApiError('このメールアドレスは登録済みです。ログインしてください。', 409)
    if (code === 'auth/weak-password') return new ApiError('より長いパスワードを設定してください。', 400)
    if (code === 'auth/too-many-requests' || code === 'resource-exhausted') return new ApiError('利用が集中しています。時間をおいて再試行してください。', 429)
    return new ApiError(`Firebaseの操作に失敗しました（${code}）。`, 500)
  }
  return new ApiError(cause instanceof Error ? cause.message : '通信に失敗しました。', 500)
}
function requireServices() {
  if (!auth || !db) throw new ApiError('Firebaseの設定が完了していません。', 503)
  return { auth, db }
}
async function currentFirebaseUser(): Promise<FirebaseUser> {
  const { auth } = requireServices()
  const current = auth.currentUser || await new Promise<FirebaseUser | null>((resolve, reject) => {
    const unsubscribe = onAuthStateChanged(auth, value => { unsubscribe(); resolve(value) }, reject)
  })
  if (!current || !current.emailVerified || !current.email) throw new ApiError('ログインまたはメール確認が必要です。', 401)
  return current
}
async function currentUser(): Promise<User> {
  const current = await currentFirebaseUser()
  const { db } = requireServices()
  const admin = await getDoc(doc(db, 'admins', current.uid))
  return { id: current.uid, email: current.email!, role: admin.exists() && admin.data().active === true ? 'admin' : 'customer' }
}
function timestampToIso(value: Timestamp | undefined): string { return value instanceof Timestamp ? value.toDate().toISOString() : '' }
function toOrder(snapshot: QueryDocumentSnapshot<DocumentData>): Order {
  const d = snapshot.data()
  const times = (d.statusTimes || {}) as Record<string, Timestamp>
  return {
    id: snapshot.id, customerEmail: d.customerEmail, productName: d.productName, amazonUrl: d.amazonUrl,
    price: d.price, quantity: d.quantity, fee: d.fee, total: d.total, paymentDue: timestampToIso(d.paymentDue),
    status: d.status, notes: d.notes, createdAt: timestampToIso(d.createdAt), updatedAt: timestampToIso(d.updatedAt),
    statusEvents: statuses.flatMap((status, index) => times[String(index)] ? [{ status, createdAt: timestampToIso(times[String(index)]) }] : []),
  }
}
function toInvoice(d: DocumentData): Invoice {
  return {
    id: d.id, orderId: d.orderId, issuerName: d.issuerName, issuerAddress: d.issuerAddress,
    issuerContact: d.issuerContact, issuerTaxDetails: d.issuerTaxDetails, paymentInstructions: d.paymentInstructions,
    customerEmail: d.customerEmail, productName: d.productName, price: d.price, quantity: d.quantity,
    fee: d.fee, total: d.total, paymentDue: timestampToIso(d.paymentDue), notes: d.notes, issuedAt: timestampToIso(d.issuedAt),
  }
}
function validDraft(draft: Draft): boolean {
  return typeof draft.productName === 'string' && draft.productName.trim().length > 0 && draft.productName.length <= 200
    && typeof draft.amazonUrl === 'string' && isAmazonUrl(draft.amazonUrl)
    && Number.isSafeInteger(draft.price) && draft.price > 0 && draft.price <= 100000000
    && Number.isSafeInteger(draft.quantity) && draft.quantity > 0 && draft.quantity <= 99
    && typeof draft.notes === 'string' && draft.notes.length <= 2000
    && Number.isFinite(Date.parse(draft.paymentDue)) && Date.parse(draft.paymentDue) > Date.now()
}

export const authApi = {
  health: async () => {
    if (!configured || !db) return { ready: false, ordersOpen: false }
    try {
      const launch = await getDoc(doc(db, 'settings', 'launch'))
      return { ready: true, ordersOpen: launch.exists() && launch.data().active === true }
    } catch { return { ready: false, ordersOpen: false } }
  },
  completeGoogleLogin: async () => {
    const { auth } = requireServices()
    try { return Boolean(await getRedirectResult(auth)) } catch (cause) { throw errorFor(cause) }
  },
  loginWithGoogle: async () => {
    const { auth } = requireServices()
    const provider = new GoogleAuthProvider()
    provider.setCustomParameters({ prompt: 'select_account' })
    try {
      await signInWithPopup(auth, provider)
      return { user: await currentUser() }
    } catch (cause) {
      if (cause instanceof FirebaseError && ['auth/popup-blocked', 'auth/operation-not-supported-in-this-environment'].includes(cause.code)) {
        await signInWithRedirect(auth, provider)
        return null
      }
      throw errorFor(cause)
    }
  },
  me: async () => ({ user: await currentUser() }),
  logout: async () => { const { auth } = requireServices(); await signOut(auth); return { ok: true } },
}

export const orderApi = {
  list: async (): Promise<{ orders: Order[] }> => {
    try {
      const user = await currentUser()
      const { db } = requireServices()
      const base = collection(db, 'orders')
      const result = await getDocs(user.role === 'admin'
        ? query(base, orderBy('createdAt', 'desc'), limit(100))
        : query(base, where('customerId', '==', user.id), orderBy('createdAt', 'desc'), limit(100)))
      return { orders: result.docs.map(toOrder) }
    } catch (cause) { throw errorFor(cause) }
  },
  get: async (id: string): Promise<{ order: Order }> => {
    try {
      await currentUser()
      const { db } = requireServices()
      const result = await getDoc(doc(db, 'orders', id))
      if (!result.exists()) throw new ApiError('注文が見つかりません。', 404)
      return { order: toOrder(result) }
    } catch (cause) { throw errorFor(cause) }
  },
  create: async (draft: Draft, idempotencyKey: string): Promise<{ order: Order }> => {
    try {
      const user = await currentUser()
      if (!validDraft(draft) || !/^[a-f0-9-]{36}$/i.test(idempotencyKey)) throw new ApiError('注文内容を確認してください。', 400)
      const { db } = requireServices()
      const id = `PB-${idempotencyKey.replaceAll('-', '').toUpperCase()}`
      const ref = doc(db, 'orders', id)
      const data = {
        customerId: user.id, customerEmail: user.email,
        productName: draft.productName.trim(), amazonUrl: draft.amazonUrl.trim(),
        price: draft.price, quantity: draft.quantity, fee: feeFor(draft.price, draft.quantity),
        total: totalFor(draft.price, draft.quantity), paymentDue: Timestamp.fromDate(new Date(draft.paymentDue)),
        status: statuses[0], notes: draft.notes.trim(), createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(), statusTimes: { '0': serverTimestamp() },
      }
      try {
        await setDoc(ref, data)
      } catch (cause) {
        // A repeated submission has the same document ID. Customer updates are denied by rules.
        const existing = await getDoc(ref).catch(() => null)
        if (existing?.exists()) return { order: toOrder(existing) }
        throw cause
      }
      const saved = await getDoc(ref)
      if (!saved.exists()) throw new ApiError('注文を保存できませんでした。', 500)
      return { order: toOrder(saved) }
    } catch (cause) { throw errorFor(cause) }
  },
  status: async (id: string, status: Status): Promise<{ order: Order }> => {
    try {
      const user = await currentUser()
      if (user.role !== 'admin') throw new ApiError('管理者権限が必要です。', 403)
      const index = statuses.indexOf(status)
      if (index < 0) throw new ApiError('無効なステータスです。', 400)
      const { db } = requireServices()
      const ref = doc(db, 'orders', id)
      await updateDoc(ref, { status, [`statusTimes.${index}`]: serverTimestamp(), updatedAt: serverTimestamp() })
      const saved = await getDoc(ref)
      if (!saved.exists()) throw new ApiError('注文が見つかりません。', 404)
      return { order: toOrder(saved) }
    } catch (cause) { throw errorFor(cause) }
  },
  invoice: async (id: string): Promise<{ invoice: Invoice }> => {
    try {
      await currentUser()
      const { db } = requireServices()
      const result = await getDoc(doc(db, 'invoices', id))
      if (!result.exists()) throw new ApiError('請求書はまだ発行されていません。', 404)
      return { invoice: toInvoice(result.data()) }
    } catch (cause) { throw errorFor(cause) }
  },
  issueInvoice: async (id: string): Promise<{ invoice: Invoice }> => {
    try {
      const user = await currentUser()
      if (user.role !== 'admin') throw new ApiError('管理者権限が必要です。', 403)
      const { db } = requireServices()
      const ref = doc(db, 'invoices', id)
      const existing = await getDoc(ref)
      if (existing.exists()) return { invoice: toInvoice(existing.data()) }
      const [order, issuer] = await Promise.all([getDoc(doc(db, 'orders', id)), getDoc(doc(db, 'settings', 'issuer'))])
      if (!order.exists()) throw new ApiError('注文が見つかりません。', 404)
      if (!issuer.exists()) throw new ApiError('事業者情報が未設定です。', 503)
      const o = order.data(), s = issuer.data()
      const snapshot = {
        id: `INV-${id}`, orderId: id, customerId: o.customerId, customerEmail: o.customerEmail,
        issuerName: s.issuerName, issuerAddress: s.issuerAddress, issuerContact: s.issuerContact,
        issuerTaxDetails: s.issuerTaxDetails, paymentInstructions: s.paymentInstructions,
        productName: o.productName, price: o.price, quantity: o.quantity, fee: o.fee, total: o.total,
        paymentDue: o.paymentDue, notes: o.notes, issuedAt: serverTimestamp(),
      }
      try {
        await setDoc(ref, snapshot)
      } catch (cause) {
        const issued = await getDoc(ref).catch(() => null)
        if (issued?.exists()) return { invoice: toInvoice(issued.data()) }
        throw cause
      }
      const saved = await getDoc(ref)
      return { invoice: toInvoice(saved.data()!) }
    } catch (cause) { throw errorFor(cause) }
  },
}
