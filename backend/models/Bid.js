import mongoose from 'mongoose';

const bidSchema = new mongoose.Schema({
  listing: { type: String, ref: 'Auction', required: true, index: true },
  bidder: { type: String, ref: 'User', required: true, index: true },
  bidderName: { type: String, required: true },
  amount: { type: Number, required: true, min: 1 },
  createdAt: { type: Date, default: Date.now }
}, { versionKey: false });
bidSchema.index({ listing: 1, createdAt: -1 });
export default mongoose.model('Bid', bidSchema);
