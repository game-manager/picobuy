import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, limit, orderBy, query, setDoc, serverTimestamp, Timestamp, updateDoc, where } from 'firebase/firestore'

let env
before(async () => {
  env = await initializeTestEnvironment({
    projectId: 'demo-picobuy',
    firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') },
  })
  await env.withSecurityRulesDisabled(async context => {
    const db = context.firestore()
    await setDoc(doc(db, 'admins', 'admin'), { active: true })
    await setDoc(doc(db, 'settings', 'issuer'), {
      issuerName: 'Test operator', issuerAddress: 'Test address', issuerContact: 'test@example.invalid',
      issuerTaxDetails: 'Test only', paymentInstructions: 'Test only',
    })
    await setDoc(doc(db, 'settings', 'launch'), { active: true })
  })
})
after(async () => { await env?.cleanup() })

const context = (uid, email = `${uid}@example.invalid`) => env.authenticatedContext(uid, { email, email_verified: true }).firestore()
const orderId = 'PB-1234567890ABCDEF1234567890ABCDEF'
function orderData(owner = 'alice', price = 10000) {
  return {
    customerId: owner, customerEmail: `${owner}@example.invalid`,
    productName: 'Test product', amazonUrl: 'https://www.amazon.co.jp/dp/B000000000',
    price, quantity: 1, fee: Math.round(price / 10), total: Math.round(price * 1.1),
    paymentDue: Timestamp.fromDate(new Date(Date.now() + 86400000)),
    status: '依頼受付', notes: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(),
    statusTimes: { '0': serverTimestamp() },
  }
}

test('verified customer can create a correctly priced order, but cannot forge the fee or status', async () => {
  const db = context('alice')
  await assertFails(setDoc(doc(db, 'admins', 'alice'), { active: true }))
  await assertFails(setDoc(doc(db, 'orders', 'PB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), { ...orderData(), fee: 0, total: 10000 }))
  await assertFails(setDoc(doc(db, 'orders', 'PB-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'), { ...orderData(), status: '支払い済み' }))
  await assertSucceeds(setDoc(doc(db, 'orders', orderId), orderData()))
  await assertFails(updateDoc(doc(db, 'orders', orderId), { status: '支払い済み' }))
})

test('another customer cannot see an order, while the administrator can update status', async () => {
  await assertFails(getDoc(doc(context('bob'), 'orders', orderId)))
  await assertFails(getDocs(query(collection(context('bob'), 'orders'), orderBy('createdAt', 'desc'), limit(100))))
  await assertSucceeds(getDocs(query(collection(context('alice'), 'orders'), where('customerId', '==', 'alice'), orderBy('createdAt', 'desc'), limit(100))))
  const adminDb = context('admin')
  await assertSucceeds(getDoc(doc(adminDb, 'orders', orderId)))
  await assertSucceeds(updateDoc(doc(adminDb, 'orders', orderId), {
    status: '支払い待ち', 'statusTimes.1': serverTimestamp(), updatedAt: serverTimestamp(),
  }))
  assert.equal((await getDoc(doc(context('alice'), 'orders', orderId))).data().status, '支払い待ち')
})

test('only administrator can issue an immutable invoice matching the order', async () => {
  const invoiceId = `INV-${orderId}`
  const invoice = {
    id: invoiceId, orderId, customerId: 'alice', customerEmail: 'alice@example.invalid',
    issuerName: 'Test operator', issuerAddress: 'Test address', issuerContact: 'test@example.invalid',
    issuerTaxDetails: 'Test only', paymentInstructions: 'Test only',
    productName: 'Test product', price: 10000, quantity: 1, fee: 1000, total: 11000,
    paymentDue: (await getDoc(doc(context('admin'), 'orders', orderId))).data().paymentDue,
    notes: '', issuedAt: serverTimestamp(),
  }
  await assertFails(setDoc(doc(context('bob'), 'invoices', orderId), invoice))
  await assertFails(setDoc(doc(context('admin'), 'invoices', orderId), { ...invoice, total: 1 }))
  await assertSucceeds(setDoc(doc(context('admin'), 'invoices', orderId), invoice))
  await assertSucceeds(getDoc(doc(context('alice'), 'invoices', orderId)))
  await assertFails(getDoc(doc(context('bob'), 'invoices', orderId)))
  await assertFails(updateDoc(doc(context('admin'), 'invoices', orderId), { total: 1 }))
})
