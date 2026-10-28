import mongoose from 'mongoose';

const notificationSchema = new mongoose.Schema({
  user: { type: String, required: true, index: true },
  type: { type: String, required: true },
  message: { type: String, required: true },
  listing: { type: String, required: true },
  read: { type: Boolean, default: false },
  createdAt: { type: Date, default: Date.now, index: true }
});
notificationSchema.index({ user: 1, createdAt: -1 });
export default mongoose.model('Notification', notificationSchema);
