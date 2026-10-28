import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import Auction from './models/Auction.js';
import User from './models/User.js';

const app = express();
app.use(cors()); app.use(express.json());
let dbReady = false;
const memory = [
  { _id: 'a1', title: 'Trek city cycle', category: 'Cycles', description: 'Smooth ride, recently serviced. Includes a sturdy lock.', condition: 'Good', image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1000&q=85', startingPrice: 1800, minIncrement: 100, closesAt: new Date(Date.now() + 5 * 3600000).toISOString(), seller: 'Aarav M.', bids: [{ _id: 'b1', bidder: 'Meera S.', amount: 2100, placedAt: new Date(Date.now() - 3600000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a2', title: 'Casio fx-991EX calculator', category: 'Electronics', description: 'All functions work perfectly. Comes with original case and guide.', condition: 'Like new', image: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=1000&q=85', startingPrice: 350, minIncrement: 25, closesAt: new Date(Date.now() + 25 * 3600000).toISOString(), seller: 'Nisha R.', bids: [], status: 'live', questions: [] },
  { _id: 'a3', title: 'Engineering mathematics bundle', category: 'Books', description: 'Four core texts for first and second year. Light highlighting in two chapters.', condition: 'Good', image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=1000&q=85', startingPrice: 500, minIncrement: 50, closesAt: new Date(Date.now() + 50 * 3600000).toISOString(), seller: 'Kabir P.', bids: [{ _id: 'b2', bidder: 'Dev A.', amount: 600, placedAt: new Date(Date.now() - 7200000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a4', title: 'Sony wireless headphones', category: 'Electronics', description: 'Great sound and battery life. Includes charging cable.', condition: 'Good', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1000&q=85', startingPrice: 1200, minIncrement: 100, closesAt: new Date(Date.now() + 2 * 3600000).toISOString(), seller: 'Ishita K.', bids: [{ _id: 'b3', bidder: 'Rohan D.', amount: 1400, placedAt: new Date(Date.now() - 900000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a5', title: 'Drawing & architecture kit', category: 'Supplies', description: 'Complete compass, set square and scale set. Barely used.', condition: 'Like new', image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=1000&q=85', startingPrice: 250, minIncrement: 25, closesAt: new Date(Date.now() + 70 * 3600000).toISOString(), seller: 'Tara J.', bids: [], status: 'live', questions: [] },
  { _id: 'a6', title: 'Hostel room desk lamp', category: 'Furniture', description: 'Warm and cool light settings, adjustable neck. USB powered.', condition: 'Good', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1000&q=85', startingPrice: 300, minIncrement: 25, closesAt: new Date(Date.now() + 96 * 3600000).toISOString(), seller: 'Arjun V.', bids: [], status: 'live', questions: [] }
];
const serialize = (doc) => doc?.toObject ? { ...doc.toObject(), currentPrice: doc.currentPrice } : { ...doc, currentPrice: doc.bids?.at(-1)?.amount ?? doc.startingPrice };
const all = async () => dbReady ? (await Auction.find().sort({ closesAt: 1 })).map(serialize) : memory;
const find = async (id) => dbReady ? Auction.findById(id) : memory.find(x => x._id === id);
const save = async (item) => dbReady ? item.save() : item;
const fail = (res, code, message) => res.status(code).json({ error: message });
const sellerOwns = (item, user) => user.role === 'seller' && (item.sellerId ? item.sellerId === user.id : item.seller === user.name);
const demoUsers = new Map();
const jwtSecret = process.env.JWT_SECRET || 'campus-auction-local-demo-secret-change-before-launch';
const requireAuth = (req, res, next) => {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Please log in to continue.');
  try { req.user = jwt.verify(token, jwtSecret); next(); } catch { return fail(res, 401, 'Your session expired. Please log in again.'); }
};

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role = 'buyer' } = req.body;
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || !password || password.length < 8 || !['buyer', 'seller'].includes(role)) return fail(res, 400, 'Enter your name, a valid email, a password with at least 8 characters, and choose a buyer or seller account.');
  const normalized = email.trim().toLowerCase();
  try {
    if (dbReady) {
      if (await User.exists({ email: normalized })) return fail(res, 409, 'An account with this email already exists.');
      const user = await User.create({ name: name.trim(), email: normalized, role, passwordHash: await bcrypt.hash(password, 12) });
      const token = jwt.sign({ id: user.id, name: user.name, email: user.email, role: user.role }, jwtSecret, { expiresIn: '7d' });
      return res.status(201).json({ token, user: { name: user.name, email: user.email, role: user.role } });
    }
    if (demoUsers.has(normalized)) return fail(res, 409, 'An account with this email already exists.');
    const user = { name: name.trim(), email: normalized, role, passwordHash: await bcrypt.hash(password, 10) }; demoUsers.set(normalized, user);
    const token = jwt.sign({ id: normalized, name: user.name, email: normalized, role }, jwtSecret, { expiresIn: '7d' });
    return res.status(201).json({ token, user: { name: user.name, email: normalized, role } });
  } catch (error) { console.error(error); return fail(res, 500, 'Could not create your account. Please try again.'); }
});
app.post('/api/auth/login', async (req, res) => {
  const { email, password } = req.body; const normalized = (email || '').trim().toLowerCase();
  try {
    const user = dbReady ? await User.findOne({ email: normalized }) : demoUsers.get(normalized);
    if (!user || !await bcrypt.compare(password || '', user.passwordHash)) return fail(res, 401, 'That email and password do not match.');
    const id = user.id || normalized; const role = user.role || 'buyer'; const token = jwt.sign({ id, name: user.name, email: normalized, role }, jwtSecret, { expiresIn: '7d' });
    return res.json({ token, user: { name: user.name, email: normalized, role } });
  } catch (error) { console.error(error); return fail(res, 500, 'Could not log in. Please try again.'); }
});

app.get('/api/health', (_, res) => res.json({ ok: true, database: dbReady ? 'mongodb' : 'demo-memory' }));
app.get('/api/auctions', async (req, res) => {
  let rows = await all(); const { q, category, condition, maxPrice, closingSoon } = req.query;
  if (q) rows = rows.filter(x => `${x.title} ${x.description} ${x.category}`.toLowerCase().includes(q.toLowerCase()));
  if (category && category !== 'All categories') rows = rows.filter(x => x.category === category);
  if (condition && condition !== 'Any condition') rows = rows.filter(x => x.condition === condition);
  if (maxPrice) rows = rows.filter(x => (x.bids?.at(-1)?.amount ?? x.startingPrice) <= Number(maxPrice));
  if (closingSoon === 'true') rows = rows.filter(x => new Date(x.closesAt) - Date.now() < 86400000);
  res.json(rows);
});
app.get('/api/auctions/:id', async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); res.json(serialize(item)); });
app.get('/api/my/auctions', requireAuth, async (req, res) => {
  if (req.user.role !== 'seller') return fail(res, 403, 'Seller workspace only.');
  const rows = await all(); res.json(rows.filter(x => x.sellerId === req.user.id || (x.seller === req.user.name && !x.sellerId)));
});
app.post('/api/auctions', requireAuth, async (req, res) => {
  if (req.user.role !== 'seller') return fail(res, 403, 'Switch to a seller account to list an item.');
  const { title, category, description, condition, image, startingPrice, minIncrement, closesAt } = req.body;
  if (!title || !category || !condition || !closesAt || Number(startingPrice) < 1 || Number(minIncrement) < 1 || new Date(closesAt) <= Date.now()) return fail(res, 400, 'Add the required details and a future closing time.');
  const data = { title, category, description, condition, image, startingPrice: Number(startingPrice), minIncrement: Number(minIncrement), closesAt, seller: req.user.name, sellerId: req.user.id, bids: [], questions: [], status: 'live' };
  const item = dbReady ? new Auction(data) : { ...data, _id: `a${Date.now()}` }; await save(item); if (!dbReady) memory.unshift(item); res.status(201).json(serialize(item));
});
app.patch('/api/auctions/:id', requireAuth, async (req, res) => {
  const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can edit this item.');
  if (item.status !== 'live' || item.bids?.length) return fail(res, 409, 'Only live auctions without bids can be edited.');
  const { title, category, description, condition, image, startingPrice, minIncrement, closesAt } = req.body;
  if (!title?.trim() || !category || !condition || Number(startingPrice) < 1 || Number(minIncrement) < 1 || !closesAt || new Date(closesAt) <= Date.now()) return fail(res, 400, 'Add the required details and a future closing time.');
  Object.assign(item, { title: title.trim(), category, description, condition, image, startingPrice: Number(startingPrice), minIncrement: Number(minIncrement), closesAt });
  await save(item); res.json(serialize(item));
});
app.post('/api/auctions/:id/cancel', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can cancel this item.'); item.status = 'cancelled'; item.outcome = 'Seller cancelled'; await save(item); res.json(serialize(item)); });
app.post('/api/auctions/:id/bids', requireAuth, async (req, res) => {
  if (req.user.role !== 'buyer') return fail(res, 403, 'Buyer accounts place bids.');
  const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found');
  if (item.status !== 'live' || new Date(item.closesAt) <= Date.now()) return fail(res, 409, 'Bidding has closed.');
  const amount = Number(req.body.amount); const minimum = item.bids?.at(-1)?.amount + item.minIncrement || item.startingPrice;
  if (!Number.isFinite(amount) || amount < minimum) return fail(res, 400, `Your bid must be at least ₹${minimum.toLocaleString('en-IN')}.`);
  item.bids.push({ bidder: req.user.name, amount, placedAt: new Date() });
  if (new Date(item.closesAt) - Date.now() <= 30000) item.closesAt = new Date(Date.now() + 60000);
  await save(item); res.status(201).json(serialize(item));
});
app.post('/api/auctions/:id/close', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the seller can close this auction.'); if (new Date(item.closesAt) > Date.now()) return fail(res, 409, 'This auction is still open.'); item.status = item.bids.length ? 'awaiting-approval' : 'unsold'; await save(item); res.json(serialize(item)); });
app.post('/api/auctions/:id/decision', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can decide on this bid.'); if (item.status !== 'awaiting-approval') return fail(res, 409, 'No winning bid is awaiting a decision.'); item.status = req.body.approved ? 'reserved' : 'rejected'; item.outcome = req.body.approved ? 'Seller approved winning bid' : 'Seller rejected winning bid'; await save(item); res.json(serialize(item)); });
app.post('/api/auctions/:id/handover', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can confirm handover.'); if (item.status !== 'reserved') return fail(res, 409, 'Only a reserved item can be handed over.'); item.status = req.body.completed ? 'sold' : 'unsold'; item.outcome = req.body.completed ? 'Handover confirmed' : 'Pickup failed'; await save(item); res.json(serialize(item)); });
app.post('/api/auctions/:id/questions', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); if (!req.body.text?.trim()) return fail(res, 400, 'Write a question first.'); item.questions.push({ author: req.user.name, text: req.body.text.trim() }); await save(item); res.status(201).json(serialize(item)); });
app.post('/api/auctions/:id/questions/:questionId/answer', requireAuth, async (req, res) => { const item = await find(req.params.id); if (!item) return fail(res, 404, 'Auction not found'); const question = item.questions.id?.(req.params.questionId) ?? item.questions.find(q => q._id === req.params.questionId); if (!question) return fail(res, 404, 'Question not found'); question.answer = req.body.answer; await save(item); res.json(serialize(item)); });

const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Campus Auction API listening on ${port}`));
if (process.env.MONGODB_URI) mongoose.connect(process.env.MONGODB_URI).then(() => { dbReady = true; console.log('Connected to MongoDB'); }).catch(err => console.warn(`MongoDB unavailable; using demo data (${err.message})`));
