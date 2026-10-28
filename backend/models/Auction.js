import mongoose from 'mongoose';

const bidSchema = new mongoose.Schema({ bidder: { type: String, required: true }, amount: { type: Number, required: true }, placedAt: { type: Date, default: Date.now } }, { _id: true });
const questionSchema = new mongoose.Schema({ author: String, text: String, answer: String, askedAt: { type: Date, default: Date.now } });
const auctionSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true }, category: { type: String, required: true }, description: String,
  condition: { type: String, required: true }, image: String, startingPrice: { type: Number, required: true, min: 1 },
  minIncrement: { type: Number, required: true, min: 1 }, closesAt: { type: Date, required: true }, seller: { type: String, required: true }, sellerId: String,
  status: { type: String, enum: ['live', 'awaiting-approval', 'reserved', 'sold', 'unsold', 'rejected', 'cancelled'], default: 'live' },
  bids: [bidSchema], questions: [questionSchema], outcome: String
}, { timestamps: true });
auctionSchema.virtual('currentPrice').get(function () { return this.bids.at(-1)?.amount ?? this.startingPrice; });
export default mongoose.model('Auction', auctionSchema);
