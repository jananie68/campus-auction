import mongoose from 'mongoose';

export const AUCTION_CATEGORIES = ['cycle', 'calculator', 'books', 'electronics', 'supplies', 'furniture', 'other'];
export const AUCTION_CONDITIONS = ['new', 'like_new', 'good', 'fair', 'poor'];
export const AUCTION_STATUSES = ['active', 'pending_approval', 'reserved', 'completed', 'unsold', 'cancelled', 'rejected', 'failed_pickup'];

const bidSchema = new mongoose.Schema({
  bidder: { type: String, required: true },
  bidderName: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  createdAt: { type: Date, default: Date.now }
}, { _id: true });
const statusEventSchema = new mongoose.Schema({ from: String, to: String, at: { type: Date, default: Date.now }, by: String, reason: String }, { _id: false });
const questionSchema = new mongoose.Schema({ author: String, text: String, answer: String, askedAt: { type: Date, default: Date.now } });

const auctionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  category: { type: String, required: true, enum: AUCTION_CATEGORIES },
  description: { type: String, required: true, trim: true, maxlength: 3000 },
  condition: { type: String, required: true, enum: AUCTION_CONDITIONS },
  photos: { type: [String], default: [] },
  image: String,
  startingPrice: { type: Number, required: true, min: 1 },
  minBidIncrement: { type: Number, required: true, min: 1 },
  minIncrement: Number,
  currentPrice: { type: Number, required: true, min: 1 },
  leadingBidder: String,
  leadingBidderName: String,
  winner: String,
  winnerName: String,
  winningAmount: Number,
  bidCount: { type: Number, default: 0, min: 0 },
  closesAt: { type: Date, required: true },
  seller: { type: String, required: true },
  sellerId: { type: String, ref: 'User', required: true },
  status: { type: String, enum: AUCTION_STATUSES, default: 'active', index: true },
  bids: { type: [bidSchema], default: [] },
  questions: { type: [questionSchema], default: [] },
  statusHistory: { type: [statusEventSchema], default: [] },
  outcome: String,
  outcomeReason: String,
  outcomeAt: Date,
  closingSoonNotified: { type: Boolean, default: false },
  handoverNote: { type: String, maxlength: 1000 },
  sellerHandoverConfirmedAt: Date,
  buyerReceivedAt: Date
}, { timestamps: true, optimisticConcurrency: false });

auctionSchema.index({ status: 1, closesAt: 1 });
auctionSchema.index({ category: 1, condition: 1, currentPrice: 1 });
auctionSchema.index({ sellerId: 1, status: 1 });
auctionSchema.index({ title: 'text', description: 'text' });

export default mongoose.model('Auction', auctionSchema);
