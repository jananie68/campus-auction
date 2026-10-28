export function minimumNextBid(auction) {
  const { startingPrice, currentPrice, minBidIncrement } = auction;
  const count = Number(auction.bidCount ?? auction.bids?.length ?? 0);
  return count === 0 ? Number(startingPrice) : Number(currentPrice) + Number(minBidIncrement);
}

export function validateBid({ status, closesAt, amount, startingPrice, currentPrice, bidCount, minBidIncrement, sellerId, bidderId }, now = new Date()) {
  if (status !== 'active') return { ok: false, code: 'closed', minimum: null };
  if (new Date(closesAt).getTime() <= now.getTime()) return { ok: false, code: 'closed', minimum: null };
  if (sellerId && String(sellerId) === String(bidderId)) return { ok: false, code: 'seller_cannot_bid', minimum: null };
  const minimum = minimumNextBid({ startingPrice, currentPrice, bidCount, minBidIncrement });
  if (!Number.isInteger(Number(amount)) || Number(amount) < minimum) return { ok: false, code: 'below_minimum', minimum };
  return { ok: true, minimum };
}

export function closeOutcome(auction, now = new Date()) {
  if (auction.status !== 'active' || new Date(auction.closesAt).getTime() > now.getTime()) return null;
  return Number(auction.bidCount ?? auction.bids?.length ?? 0) > 0 ? 'pending_approval' : 'unsold';
}
