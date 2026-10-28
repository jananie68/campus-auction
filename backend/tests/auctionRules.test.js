import test from 'node:test';
import assert from 'node:assert/strict';
import { closeOutcome, minimumNextBid, validateBid } from '../services/auctionRules.js';
import { createKeyedLock } from '../services/keyedLock.js';

const base = { status: 'active', closesAt: '2026-10-29T00:00:00.000Z', startingPrice: 400, currentPrice: 500, bidCount: 1, minBidIncrement: 25, sellerId: 'seller-1', bidderId: 'buyer-1' };

test('first bid minimum is the starting price; later minimum adds increment', () => {
  assert.equal(minimumNextBid({ ...base, bidCount: 0 }), 400);
  assert.equal(minimumNextBid(base), 525);
});

test('bid validation rejects low, late, inactive and seller bids', () => {
  const now = new Date('2026-10-28T00:00:00Z');
  assert.deepEqual(validateBid({ ...base, amount: 524 }, now), { ok: false, code: 'below_minimum', minimum: 525 });
  assert.equal(validateBid({ ...base, amount: 525, closesAt: '2026-10-27T00:00:00Z' }, now).code, 'closed');
  assert.equal(validateBid({ ...base, amount: 525, status: 'cancelled' }, now).code, 'closed');
  assert.equal(validateBid({ ...base, amount: 525, bidderId: 'seller-1' }, now).code, 'seller_cannot_bid');
});

test('close transition chooses unsold or pending approval and is idempotent', () => {
  const now = new Date('2026-10-28T01:00:00Z');
  assert.equal(closeOutcome({ ...base, closesAt: '2026-10-28T00:00:00Z', bidCount: 0 }, now), 'unsold');
  assert.equal(closeOutcome({ ...base, closesAt: '2026-10-28T00:00:00Z' }, now), 'pending_approval');
  assert.equal(closeOutcome({ ...base, status: 'pending_approval', closesAt: '2026-10-28T00:00:00Z' }, now), null);
  assert.equal(closeOutcome({ ...base, closesAt: '2026-10-29T00:00:00Z' }, now), null);
});

test('simultaneous memory bids serialize so only one stale minimum bid wins', async () => {
  const lock = createKeyedLock();
  const listing = { status: 'active', closesAt: '2026-10-29T00:00:00Z', startingPrice: 400, currentPrice: 400, bidCount: 0, minBidIncrement: 25, bids: [] };
  const attempt = amount => lock('auction-1', async () => {
    const decision = validateBid({ ...listing, amount, bidderId: `buyer-${amount}` }, new Date('2026-10-28T00:00:00Z'));
    if (!decision.ok) return decision;
    await Promise.resolve();
    listing.bids.push(amount); listing.currentPrice = amount; listing.bidCount += 1;
    return decision;
  });
  const results = await Promise.all([attempt(400), attempt(400)]);
  assert.equal(results.filter(x=>x.ok).length, 1);
  assert.equal(results.filter(x=>x.code==='below_minimum').length, 1);
  assert.equal(listing.bidCount, 1);
});
