import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { after, before, test } from 'node:test'
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing'
import { collection, doc, getDoc, getDocs, orderBy, query, setDoc, serverTimestamp, Timestamp, updateDoc, writeBatch } from 'firebase/firestore'

let env
before(async () => {
  env = await initializeTestEnvironment({ projectId: 'demo-picobuy', firestore: { rules: readFileSync(new URL('../firestore.rules', import.meta.url), 'utf8') } })
  await env.withSecurityRulesDisabled(async c => {
    const db = c.firestore()
    await setDoc(doc(db, 'admins', 'admin'), { active: true })
    await setDoc(doc(db, 'settings', 'issuer'), { issuerName: 'Test operator', issuerAddress: 'Test address', issuerContact: 'test@example.invalid', issuerTaxDetails: 'Test only', paymentInstructions: 'Test only' })
    await setDoc(doc(db, 'settings', 'launch'), { active: true })
  })
})
after(async () => env?.cleanup())
const db = uid => env.authenticatedContext(uid, { email: `${uid}@example.invalid`, email_verified: true }).firestore()
const id = 'PB-1234567890ABCDEF1234567890ABCDEF'
const orderData = () => ({ customerId: 'alice', customerEmail: 'alice@example.invalid', productName: 'Test product', amazonUrl: 'https://www.amazon.co.jp/dp/B000000000', price: 10000, quantity: 1, fee: 1000, total: 11000, quotedTotal: 0, paymentDue: Timestamp.fromDate(new Date(Date.now() + 86400000)), status: '依頼受付', currentProposalId: '', acceptedProposalId: '', acceptedAt: null, acceptedQuotes: {}, cancelReason: '', cashBalance: 0, lastCashEntryId: '', notes: '', createdAt: serverTimestamp(), updatedAt: serverTimestamp(), statusTimes: { '0': serverTimestamp() } })
const proposalData = (fee = 1100) => ({ customerId: 'alice', unitPrice: 11000, shipping: 500, fee, total: 12600, reason: 'Price and shipping confirmed', proposedBy: 'admin', proposedAt: serverTimestamp() })
function cashBatch(admin, orderId, entryId, kind, amount, nextBalance) {
  const batch = writeBatch(admin)
  batch.set(doc(admin, 'orders', orderId, 'cashEntries', entryId), { customerId: 'alice', kind, amount, note: kind === '受領' ? 'Cash received' : 'Cash refunded', adminId: 'admin', createdAt: serverTimestamp() })
  batch.update(doc(admin, 'orders', orderId), { cashBalance: nextBalance, lastCashEntryId: entryId, updatedAt: serverTimestamp() })
  return batch
}

test('quote, acceptance, cash, invoice and isolation', async () => {
  const alice = db('alice'), bob = db('bob'), admin = db('admin')
  await assertFails(setDoc(doc(alice, 'admins', 'alice'), { active: true }))
  await assertFails(setDoc(doc(alice, 'orders', 'PB-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'), { ...orderData(), fee: 0 }))
  await assertSucceeds(setDoc(doc(alice, 'orders', id), orderData()))
  await assertFails(getDoc(doc(bob, 'orders', id)))
  await assertFails(getDocs(query(collection(bob, 'orders'), orderBy('createdAt', 'desc'))))
  const orderRef = doc(admin, 'orders', id), quoteId = 'q1'
  await assertFails(setDoc(doc(alice, 'orders', id, 'proposals', 'bad'), proposalData()))
  const forged = writeBatch(admin)
  forged.set(doc(admin, 'orders', id, 'proposals', quoteId), proposalData(0))
  forged.update(orderRef, { currentProposalId: quoteId, quotedTotal: 12600, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertFails(forged.commit())
  const batch = writeBatch(admin)
  batch.set(doc(admin, 'orders', id, 'proposals', quoteId), proposalData())
  batch.update(orderRef, { currentProposalId: quoteId, quotedTotal: 12600, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertSucceeds(batch.commit())
  await assertFails(updateDoc(doc(bob, 'orders', id), { acceptedProposalId: quoteId, acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertFails(updateDoc(doc(alice, 'orders', id), { acceptedProposalId: 'bad', acceptedAt: serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(updateDoc(doc(alice, 'orders', id), { acceptedProposalId: quoteId, acceptedAt: serverTimestamp(), [`acceptedQuotes.${quoteId}`]: serverTimestamp(), status: '支払い待ち', 'statusTimes.1': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertFails(setDoc(doc(alice, 'orders', id, 'cashEntries', 'forged'), { customerId: 'alice', kind: '受領', amount: 12600, note: 'Cash received', adminId: 'admin', createdAt: serverTimestamp() }))
  await assertFails(updateDoc(orderRef, { cashBalance: 12600, lastCashEntryId: 'fake', updatedAt: serverTimestamp() }))
  await assertSucceeds(cashBatch(admin, id, 'payment1', '受領', 12600, 12600).commit())
  await assertSucceeds(getDocs(query(collection(alice, 'orders', id, 'cashEntries'), orderBy('createdAt', 'asc'))))
  await assertFails(getDocs(query(collection(bob, 'orders', id, 'cashEntries'), orderBy('createdAt', 'asc'))))
  await assertFails(updateDoc(orderRef, { status: '注文済み', 'statusTimes.3': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(updateDoc(orderRef, { status: '支払い済み', 'statusTimes.2': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(updateDoc(orderRef, { status: '注文済み', 'statusTimes.3': serverTimestamp(), updatedAt: serverTimestamp() }))
  const invoice = { id: `INV-${id}`, orderId: id, proposalId: quoteId, customerId: 'alice', customerEmail: 'alice@example.invalid', issuerName: 'Test operator', issuerAddress: 'Test address', issuerContact: 'test@example.invalid', issuerTaxDetails: 'Test only', paymentInstructions: 'Test only', productName: 'Test product', price: 11000, quantity: 1, fee: 1100, shipping: 500, total: 12600, paymentDue: (await getDoc(orderRef)).data().paymentDue, notes: '', issuedAt: serverTimestamp() }
  await assertFails(setDoc(doc(bob, 'invoices', id), invoice))
  await assertFails(setDoc(doc(admin, 'invoices', id), { ...invoice, total: 1 }))
  await assertSucceeds(setDoc(doc(admin, 'invoices', id), invoice))
  await assertSucceeds(getDoc(doc(alice, 'invoices', id)))
  await assertFails(updateDoc(doc(admin, 'invoices', id), { total: 1 }))
  await assertFails(cashBatch(admin, id, 'latePayment', '受領', 100, 12700).commit())
  const late = writeBatch(admin)
  late.set(doc(admin, 'orders', id, 'proposals', 'q2'), proposalData())
  late.update(orderRef, { currentProposalId: 'q2', quotedTotal: 12600, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertFails(late.commit())
  assert.equal((await getDoc(doc(alice, 'orders', id))).data().status, '注文済み')
})

test('cancellation and refund log preserve earlier timeline', async () => {
  const admin = db('admin'), id2 = 'PB-BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB'
  await assertSucceeds(setDoc(doc(db('alice'), 'orders', id2), orderData()))
  const quote = writeBatch(admin)
  quote.set(doc(admin, 'orders', id2, 'proposals', 'q1'), proposalData())
  quote.update(doc(admin, 'orders', id2), { currentProposalId: 'q1', quotedTotal: 12600, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertSucceeds(quote.commit())
  await assertSucceeds(updateDoc(doc(db('alice'), 'orders', id2), { acceptedProposalId: 'q1', acceptedAt: serverTimestamp(), 'acceptedQuotes.q1': serverTimestamp(), status: '支払い待ち', 'statusTimes.1': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(cashBatch(admin, id2, 'payment', '受領', 1000, 1000).commit())
  await assertFails(updateDoc(doc(admin, 'orders', id2), { status: 'キャンセル', cancelReason: 'Unavailable', 'statusTimes.0': serverTimestamp(), 'statusTimes.8': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(updateDoc(doc(admin, 'orders', id2), { status: 'キャンセル', cancelReason: 'Unavailable', 'statusTimes.8': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertFails(cashBatch(admin, id2, 'tooMuch', '返金', 2000, -1000).commit())
  await assertSucceeds(cashBatch(admin, id2, 'refund1', '返金', 1000, 0).commit())
  assert.equal((await getDoc(doc(db('alice'), 'orders', id2))).data().status, 'キャンセル')
})

test('a changed price after payment needs another customer acceptance', async () => {
  const alice = db('alice'), admin = db('admin'), changedId = 'PB-CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC'
  const orderRef = doc(admin, 'orders', changedId)
  await assertSucceeds(setDoc(doc(alice, 'orders', changedId), orderData()))
  const first = writeBatch(admin)
  first.set(doc(admin, 'orders', changedId, 'proposals', 'first'), proposalData())
  first.update(orderRef, { currentProposalId: 'first', quotedTotal: 12600, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertSucceeds(first.commit())
  await assertSucceeds(updateDoc(doc(alice, 'orders', changedId), { acceptedProposalId: 'first', acceptedAt: serverTimestamp(), 'acceptedQuotes.first': serverTimestamp(), status: '支払い待ち', 'statusTimes.1': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(cashBatch(admin, changedId, 'cash1', '受領', 12600, 12600).commit())
  await assertSucceeds(updateDoc(orderRef, { status: '支払い済み', 'statusTimes.2': serverTimestamp(), updatedAt: serverTimestamp() }))
  const second = writeBatch(admin)
  second.set(doc(admin, 'orders', changedId, 'proposals', 'second'), { ...proposalData(1200), unitPrice: 12000, shipping: 600, total: 13800, reason: 'Price increased' })
  second.update(orderRef, { currentProposalId: 'second', quotedTotal: 13800, acceptedProposalId: '', acceptedAt: null, updatedAt: serverTimestamp() })
  await assertSucceeds(second.commit())
  await assertFails(updateDoc(orderRef, { status: '注文済み', 'statusTimes.3': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(updateDoc(doc(alice, 'orders', changedId), { acceptedProposalId: 'second', acceptedAt: serverTimestamp(), 'acceptedQuotes.second': serverTimestamp(), updatedAt: serverTimestamp() }))
  const accepted = (await getDoc(doc(alice, 'orders', changedId))).data().acceptedQuotes
  assert.ok(accepted.first && accepted.second)
  await assertFails(updateDoc(orderRef, { status: '注文済み', 'statusTimes.3': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertSucceeds(cashBatch(admin, changedId, 'cash2', '受領', 1200, 13800).commit())
  await assertSucceeds(updateDoc(orderRef, { status: '注文済み', 'statusTimes.3': serverTimestamp(), updatedAt: serverTimestamp() }))
  await assertFails(updateDoc(orderRef, { status: 'キャンセル', cancelReason: 'Too late', 'statusTimes.8': serverTimestamp(), updatedAt: serverTimestamp() }))
})
