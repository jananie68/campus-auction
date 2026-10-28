import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import cron from 'node-cron';
import multer from 'multer';
import crypto from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import Auction, { AUCTION_CATEGORIES, AUCTION_CONDITIONS } from './models/Auction.js';
import User from './models/User.js';
import Bid from './models/Bid.js';
import Notification from './models/Notification.js';
import { closeOutcome, minimumNextBid, validateBid } from './services/auctionRules.js';
import { createKeyedLock } from './services/keyedLock.js';

const app = express();
app.use(cors());
app.use(express.json({ limit: '2mb' }));
const here = path.dirname(fileURLToPath(import.meta.url));
const uploadDirectory = path.join(here, 'uploads');
mkdirSync(uploadDirectory, { recursive: true });
app.use('/uploads', express.static(uploadDirectory));

let dbReady = false;
const jwtSecret = process.env.JWT_SECRET || 'campus-auction-local-demo-secret-change-before-launch';
const dataFile = process.env.DEMO_STORE_PATH || path.join(here, 'data', 'store.json');
const demoUsers = new Map();
const demoNotifications = [];
let writeQueue = Promise.resolve();
const withListingLock = createKeyedLock();

const legacySeed = [
  { _id: 'a1', title: 'Trek city cycle', category: 'Cycles', description: 'Smooth ride, recently serviced. Includes a sturdy lock.', condition: 'Good', image: 'https://images.unsplash.com/photo-1485965120184-e220f721d03e?auto=format&fit=crop&w=1000&q=85', startingPrice: 1800, minIncrement: 100, closesAt: new Date(Date.now() + 5 * 3600000).toISOString(), seller: 'Aarav M.', bids: [{ _id: 'b1', bidder: 'Meera S.', amount: 2100, placedAt: new Date(Date.now() - 3600000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a2', title: 'Casio fx-991EX calculator', category: 'Electronics', description: 'All functions work perfectly. Comes with original case and guide.', condition: 'Like new', image: 'https://images.unsplash.com/photo-1509228468518-180dd4864904?auto=format&fit=crop&w=1000&q=85', startingPrice: 350, minIncrement: 25, closesAt: new Date(Date.now() + 25 * 3600000).toISOString(), seller: 'Nisha R.', bids: [], status: 'live', questions: [] },
  { _id: 'a3', title: 'Engineering mathematics bundle', category: 'Books', description: 'Four core texts for first and second year. Light highlighting in two chapters.', condition: 'Good', image: 'https://images.unsplash.com/photo-1544947950-fa07a98d237f?auto=format&fit=crop&w=1000&q=85', startingPrice: 500, minIncrement: 50, closesAt: new Date(Date.now() + 50 * 3600000).toISOString(), seller: 'Kabir P.', bids: [{ _id: 'b2', bidder: 'Dev A.', amount: 600, placedAt: new Date(Date.now() - 7200000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a4', title: 'Sony wireless headphones', category: 'Electronics', description: 'Great sound and battery life. Includes charging cable.', condition: 'Good', image: 'https://images.unsplash.com/photo-1505740420928-5e560c06d30e?auto=format&fit=crop&w=1000&q=85', startingPrice: 1200, minIncrement: 100, closesAt: new Date(Date.now() + 2 * 3600000).toISOString(), seller: 'Ishita K.', bids: [{ _id: 'b3', bidder: 'Rohan D.', amount: 1400, placedAt: new Date(Date.now() - 900000).toISOString() }], status: 'live', questions: [] },
  { _id: 'a5', title: 'Drawing & architecture kit', category: 'Supplies', description: 'Complete compass, set square and scale set. Barely used.', condition: 'Like new', image: 'https://images.unsplash.com/photo-1513364776144-60967b0f800f?auto=format&fit=crop&w=1000&q=85', startingPrice: 250, minIncrement: 25, closesAt: new Date(Date.now() + 70 * 3600000).toISOString(), seller: 'Tara J.', bids: [], status: 'live', questions: [] },
  { _id: 'a6', title: 'Hostel room desk lamp', category: 'Furniture', description: 'Warm and cool light settings, adjustable neck. USB powered.', condition: 'Good', image: 'https://images.unsplash.com/photo-1507473885765-e6ed057f782c?auto=format&fit=crop&w=1000&q=85', startingPrice: 300, minIncrement: 25, closesAt: new Date(Date.now() + 96 * 3600000).toISOString(), seller: 'Arjun V.', bids: [], status: 'live', questions: [] }
];
const categoryMap = { cycles: 'cycle', cycle: 'cycle', calculators: 'calculator', calculator: 'calculator', books: 'books', electronics: 'electronics', supplies: 'supplies', furniture: 'furniture', other: 'other' };
const conditionMap = { new: 'new', 'like new': 'like_new', like_new: 'like_new', good: 'good', fair: 'fair', poor: 'poor' };
const statusMap = { live: 'active', active: 'active', 'awaiting-approval': 'pending_approval', pending_approval: 'pending_approval', reserved: 'reserved', sold: 'completed', completed: 'completed', unsold: 'unsold', rejected: 'rejected', cancelled: 'cancelled', failed_pickup: 'failed_pickup' };
function normalizeAuction(raw) {
  const bids = (raw.bids || []).map(b => ({ ...b, bidder: String(b.bidderId || b.bidder || ''), bidderName: b.bidderName || (typeof b.bidder === 'string' && !b.bidder.includes('@') ? b.bidder : 'Campus student'), createdAt: b.createdAt || b.placedAt || new Date() }));
  const categoryKey = String(raw.category || 'other').toLowerCase();
  const conditionKey = String(raw.condition || 'good').toLowerCase();
  const photos = raw.photos?.length ? raw.photos : raw.image ? [raw.image] : [];
  const currentPrice = Number(raw.currentPrice ?? bids.at(-1)?.amount ?? raw.startingPrice ?? 1);
  return {
    ...raw,
    _id: String(raw._id || crypto.randomUUID()),
    category: categoryMap[categoryKey] || 'other',
    condition: conditionMap[conditionKey] || 'good',
    photos,
    image: raw.image || photos[0] || '',
    startingPrice: Number(raw.startingPrice || 1),
    minBidIncrement: Number(raw.minBidIncrement ?? raw.minIncrement ?? 1),
    minIncrement: Number(raw.minBidIncrement ?? raw.minIncrement ?? 1),
    currentPrice,
    bidCount: Number(raw.bidCount ?? bids.length),
    leadingBidder: raw.leadingBidder || (bids.at(-1)?.bidder || ''),
    leadingBidderName: raw.leadingBidderName || bids.at(-1)?.bidderName || '',
    sellerId: String(raw.sellerId || ''),
    status: statusMap[raw.status] || 'active',
    bids,
    questions: raw.questions || [],
    statusHistory: raw.statusHistory || []
  };
}
let memory = legacySeed.map(normalizeAuction);
try {
  const saved = JSON.parse(await readFile(dataFile, 'utf8'));
  if (Array.isArray(saved.auctions)) memory = saved.auctions.map(normalizeAuction);
  for (const [email, user] of saved.users || []) demoUsers.set(email, user);
  demoNotifications.push(...(saved.notifications || []));
} catch (error) { if (error.code !== 'ENOENT') console.warn(`Could not load local store: ${error.message}`); }

async function persistDemoStore() {
  writeQueue = writeQueue.then(async () => {
    await mkdir(path.dirname(dataFile), { recursive: true });
    await writeFile(dataFile, JSON.stringify({ auctions: memory, users: [...demoUsers.entries()], notifications: demoNotifications }, null, 2), 'utf8');
  });
  return writeQueue;
}
const plain = doc => doc?.toObject ? doc.toObject() : doc;
const allAuctions = async () => dbReady ? (await Auction.find()).map(plain) : memory;
const findAuction = async id => dbReady ? Auction.findById(id) : memory.find(a => a._id === id);
const saveAuction = async item => { if (dbReady) return item.save(); await persistDemoStore(); return item; };
const idOf = value => String(value?._id || value?.id || value || '');
const sellerOwns = (item, user) => user.role === 'seller' && (String(item.sellerId || '') === user.id || (!item.sellerId && item.seller === user.name));
const fail = (res, code, message, extra = {}) => res.status(code).json({ error: message, ...extra });
const jwtPayload = user => ({ id: idOf(user._id || user.id || user.email), name: user.name, email: user.email, role: user.role });
const signToken = user => jwt.sign(jwtPayload(user), jwtSecret, { expiresIn: '7d' });
function requireAuth(req, res, next) {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, '');
  if (!token) return fail(res, 401, 'Please log in to continue.');
  try { req.user = jwt.verify(token, jwtSecret); next(); } catch { return fail(res, 401, 'Your session expired. Please log in again.'); }
}
const allowRoles = (...roles) => (req, res, next) => roles.includes(req.user?.role) ? next() : fail(res, 403, `This action requires ${roles.join(' or ')} access.`);
const upload = multer({
  storage: multer.diskStorage({ destination: uploadDirectory, filename: (_req, file, cb) => cb(null, `${crypto.randomUUID()}${path.extname(file.originalname).toLowerCase()}`) }),
  limits: { fileSize: 5 * 1024 * 1024, files: 6 },
  fileFilter: (_req, file, cb) => cb(file.mimetype?.startsWith('image/') ? null : new Error('Upload image files only.'), file.mimetype?.startsWith('image/'))
});
async function notifyUser(userId, type, message, listingId) {
  if (!userId || !listingId) return;
  const data = { user: String(userId), type, message, listing: String(listingId), read: false, createdAt: new Date() };
  try {
    if (dbReady) await Notification.create(data);
    else { demoNotifications.unshift({ ...data, _id: crypto.randomUUID() }); await persistDemoStore(); }
  } catch (error) { console.warn(`Notification could not be saved: ${error.message}`); }
}
async function notifyBidders(item, type, message) {
  const recipients = new Map((item.bids || []).map(b => [String(b.bidder), b.bidderName]));
  for (const [id] of recipients) await notifyUser(id, type, message, item._id);
}
function historyEvent(from, to, by, reason = '') { return { from: from || '', to, at: new Date(), by: String(by || 'system'), reason }; }

async function closeListing(id, now = new Date()) {
  let item = await findAuction(id);
  if (!item || closeOutcome(item, now) === null) return item;
  const next = closeOutcome(item, now);
  if (dbReady) {
    const winnerBid = item.bids?.at(-1);
    const updated = await Auction.findOneAndUpdate(
      { _id: item._id, status: 'active', closesAt: { $lte: now } },
      { $set: { status: next, winner: winnerBid?.bidder || '', winnerName: winnerBid?.bidderName || '', winningAmount: winnerBid?.amount || null, outcome: next === 'unsold' ? 'Auction ended without bids' : 'Awaiting seller approval', outcomeAt: now }, $push: { statusHistory: historyEvent('active', next, 'system') } },
      { new: true }
    );
    if (updated) {
      item = plain(updated);
      if (next === 'pending_approval') {
        await notifyUser(item.sellerId, 'auction_closed', `${item.title} closed. Review the winning bid of ₹${Number(item.winningAmount).toLocaleString('en-IN')}.`, item._id);
        await notifyUser(item.winner, 'provisional_winner', `You are the provisional winner of ${item.title}.`, item._id);
      } else await notifyUser(item.sellerId, 'auction_unsold', `${item.title} ended without bids.`, item._id);
    }
    return updated || Auction.findById(id);
  }
  const winnerBid = item.bids?.at(-1);
  item.winner = winnerBid?.bidder || ''; item.winnerName = winnerBid?.bidderName || ''; item.winningAmount = winnerBid?.amount || null;
  item.status = next; item.outcome = next === 'unsold' ? 'Auction ended without bids' : 'Awaiting seller approval'; item.outcomeAt = now;
  item.statusHistory.push(historyEvent('active', next, 'system'));
  await saveAuction(item);
  if (next === 'pending_approval') {
    await notifyUser(item.sellerId, 'auction_closed', `${item.title} closed. Review the winning bid of ₹${Number(item.winningAmount).toLocaleString('en-IN')}.`, item._id);
    await notifyUser(item.winner, 'provisional_winner', `You are the provisional winner of ${item.title}.`, item._id);
  } else await notifyUser(item.sellerId, 'auction_unsold', `${item.title} ended without bids.`, item._id);
  return item;
}
async function closeDueAuctions() {
  const now = new Date();
  const due = dbReady ? await Auction.find({ status: 'active', closesAt: { $lte: now } }).select('_id') : memory.filter(a => a.status === 'active' && new Date(a.closesAt) <= now).map(a => ({ _id: a._id }));
  for (const item of due) await closeListing(idOf(item), now);
}
async function sendClosingSoon() {
  const now = new Date(), soon = new Date(now.getTime() + 60 * 60 * 1000);
  const list = dbReady ? await Auction.find({ status: 'active', closesAt: { $gt: now, $lte: soon }, closingSoonNotified: false }) : memory.filter(a => a.status === 'active' && !a.closingSoonNotified && new Date(a.closesAt) > now && new Date(a.closesAt) <= soon);
  for (const doc of list) {
    let item;
    if (dbReady) item = await Auction.findOneAndUpdate({ _id: doc._id, closingSoonNotified: false, status: 'active' }, { $set: { closingSoonNotified: true } }, { new: true });
    else { doc.closingSoonNotified = true; item = doc; await saveAuction(doc); }
    if (!item) continue;
    await notifyUser(item.sellerId, 'closing_soon', `${item.title} closes within an hour.`, item._id);
    await notifyBidders(item, 'closing_soon', `${item.title} closes within an hour.`, item._id);
  }
}
async function ensureClosed(item) {
  if (item && closeOutcome(item, new Date())) return closeListing(idOf(item));
  return item;
}

app.post('/api/auth/signup', async (req, res) => {
  const { name, email, password, role = 'buyer' } = req.body;
  if (!name?.trim() || !/^\S+@\S+\.\S+$/.test(email || '') || !password || password.length < 8 || !['buyer', 'seller'].includes(role)) return fail(res, 400, 'Enter your name, a valid email, a password with at least 8 characters, and choose a buyer or seller account.');
  const normalized = email.trim().toLowerCase();
  try {
    if (dbReady) {
      if (await User.exists({ email: normalized })) return fail(res, 409, 'An account with this email already exists.');
      const user = await User.create({ name: name.trim(), email: normalized, role, passwordHash: await bcrypt.hash(password, 12) });
      return res.status(201).json({ token: signToken(user), user: { name: user.name, email: user.email, role: user.role } });
    }
    if (demoUsers.has(normalized)) return fail(res, 409, 'An account with this email already exists.');
    const user = { id: normalized, name: name.trim(), email: normalized, role, browserNotifications: false, passwordHash: await bcrypt.hash(password, 10) };
    demoUsers.set(normalized, user); await persistDemoStore();
    return res.status(201).json({ token: signToken(user), user: { name: user.name, email: normalized, role } });
  } catch (error) { console.error(error); return fail(res, 500, 'Could not create your account. Please try again.'); }
});
app.post('/api/auth/login', async (req, res) => {
  const normalized = (req.body.email || '').trim().toLowerCase();
  try {
    const user = dbReady ? await User.findOne({ email: normalized }) : demoUsers.get(normalized);
    if (!user || !await bcrypt.compare(req.body.password || '', user.passwordHash)) return fail(res, 401, 'That email and password do not match.');
    if (!user.role) user.role = 'buyer';
    return res.json({ token: signToken(user), user: { name: user.name, email: normalized, role: user.role } });
  } catch (error) { console.error(error); return fail(res, 500, 'Could not log in. Please try again.'); }
});

app.get('/api/health', (_req, res) => res.json({ ok: true, database: dbReady ? 'mongodb' : 'demo-memory' }));
app.get('/api/time', (_req, res) => res.json({ now: new Date().toISOString() }));
app.get('/api/users/me', requireAuth, async (req, res) => {
  const user = dbReady ? await User.findById(req.user.id).select('name email role browserNotifications').lean() : demoUsers.get(req.user.email);
  if (!user) return fail(res, 404, 'Account not found.');
  res.json({ name: user.name, email: user.email, role: user.role || 'buyer', browserNotifications: Boolean(user.browserNotifications) });
});

async function browse(req, res) {
  const now = new Date();
  await closeDueAuctions();
  const status = req.query.status || 'active';
  const search = String(req.query.q || '').trim();
  const minPrice = req.query.minPrice === undefined ? null : Number(req.query.minPrice);
  const maxPrice = req.query.maxPrice === undefined ? null : Number(req.query.maxPrice);
  const page = Math.max(1, Number.parseInt(req.query.page || '1', 10));
  const pageSize = Math.min(50, Math.max(1, Number.parseInt(req.query.limit || '12', 10)));
  const sort = req.query.sort || 'closingSoonest';
  if (dbReady) {
    const filter = {};
    if (status !== 'all') filter.status = status;
    if (search) { const safe = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'); filter.$or = [{ title: { $regex: safe, $options: 'i' } }, { description: { $regex: safe, $options: 'i' } }]; }
    if (req.query.category && req.query.category !== 'all') filter.category = req.query.category;
    if (req.query.condition && req.query.condition !== 'all') filter.condition = req.query.condition;
    if ((minPrice !== null && Number.isFinite(minPrice)) || (maxPrice !== null && Number.isFinite(maxPrice))) filter.currentPrice = { ...(minPrice !== null && Number.isFinite(minPrice) ? { $gte: minPrice } : {}), ...(maxPrice !== null && Number.isFinite(maxPrice) ? { $lte: maxPrice } : {}) };
    if (req.query.closingSoon === 'true') filter.closesAt = { $gt: now, $lte: new Date(now.getTime() + 24 * 60 * 60 * 1000) };
    const mongoSort = sort === 'newest' ? { createdAt: -1 } : sort === 'priceAsc' ? { currentPrice: 1 } : sort === 'priceDesc' ? { currentPrice: -1 } : { closesAt: 1 };
    const total = await Auction.countDocuments(filter);
    const results = await Auction.find(filter).sort(mongoSort).skip((page - 1) * pageSize).limit(pageSize).lean();
    return res.json({ items: results, total, page, pageSize, pages: Math.ceil(total / pageSize), serverTime: now.toISOString() });
  }
  let rows = await allAuctions();
  if (status !== 'all') rows = rows.filter(x => x.status === status);
  if (search) { const lower = search.toLowerCase(); rows = rows.filter(x => `${x.title} ${x.description}`.toLowerCase().includes(lower)); }
  if (req.query.category && req.query.category !== 'all') rows = rows.filter(x => x.category === req.query.category);
  if (req.query.condition && req.query.condition !== 'all') rows = rows.filter(x => x.condition === req.query.condition);
  if (minPrice !== null && Number.isFinite(minPrice)) rows = rows.filter(x => Number(x.currentPrice) >= minPrice);
  if (maxPrice !== null && Number.isFinite(maxPrice)) rows = rows.filter(x => Number(x.currentPrice) <= maxPrice);
  if (req.query.closingSoon === 'true') rows = rows.filter(x => new Date(x.closesAt) > now && new Date(x.closesAt) <= new Date(now.getTime() + 24 * 60 * 60 * 1000));
  rows.sort(sort === 'newest' ? (a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0)
    : sort === 'priceAsc' ? (a, b) => a.currentPrice - b.currentPrice
      : sort === 'priceDesc' ? (a, b) => b.currentPrice - a.currentPrice
        : (a, b) => new Date(a.closesAt) - new Date(b.closesAt));
  const total = rows.length;
  rows = rows.slice((page - 1) * pageSize, page * pageSize);
  res.json({ items: rows, total, page, pageSize, pages: Math.ceil(total / pageSize), serverTime: now.toISOString() });
}
app.get(['/api/auctions', '/api/listings'], requireAuth, browse);

async function getMyBids(req, res) {
  await closeDueAuctions();
  const rows = await allAuctions();
  const result = rows.flatMap(item => {
    const own = (item.bids || []).filter(b => String(b.bidder) === req.user.id || b.bidderName === req.user.name);
    if (!own.length) return [];
    const bid = own.at(-1);
    const state = item.status === 'active' ? (String(item.leadingBidder) === req.user.id || bid._id === item.bids?.at(-1)?._id ? 'leading' : 'outbid')
      : item.status === 'pending_approval' && item.winner === req.user.id ? 'provisional'
        : ['reserved','completed','failed_pickup'].includes(item.status) && item.winner === req.user.id ? 'won' : 'lost';
    return [{ bid, state, auction: item }];
  });
  result.sort((a, b) => new Date(b.bid.createdAt || b.bid.placedAt) - new Date(a.bid.createdAt || a.bid.placedAt));
  res.json(result);
}
app.get(['/api/auctions/mine/bids','/api/bids/mine'], requireAuth, allowRoles('buyer'), getMyBids);
app.get('/api/auctions/mine', requireAuth, allowRoles('seller'), async (req, res) => {
  await closeDueAuctions();
  const rows = (await allAuctions()).filter(x => sellerOwns(x, req.user));
  const groups = Object.fromEntries(['active', 'pending_approval', 'reserved', 'completed', 'unsold', 'cancelled', 'rejected', 'failed_pickup'].map(status => [status, rows.filter(x => x.status === status)]));
  res.json({ items: rows, groups });
});
app.get('/api/my/auctions', requireAuth, allowRoles('seller'), async (req, res) => { await closeDueAuctions(); res.json((await allAuctions()).filter(x => sellerOwns(x, req.user))); });

async function getListing(req, res) {
  let item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  item = await ensureClosed(item);
  return res.json(plain(item));
}
app.get(['/api/auctions/:id', '/api/listings/:id'], requireAuth, getListing);
async function getBids(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  res.json([...(item.bids || [])].sort((a, b) => new Date(b.createdAt || b.placedAt) - new Date(a.createdAt || a.placedAt)));
}
app.get(['/api/auctions/:id/bids', '/api/listings/:id/bids'], requireAuth, getBids);

function listingValues(body, files = [], existing = []) {
  const uploaded = files.map(file => `/uploads/${file.filename}`);
  const urlPhoto = String(body.image || '').trim();
  const photos = [...existing, ...uploaded];
  if (urlPhoto && !photos.includes(urlPhoto)) photos.unshift(urlPhoto);
  const title = String(body.title || '').trim();
  const description = String(body.description || '').trim();
  const category = String(body.category || '').toLowerCase();
  const condition = String(body.condition || '').toLowerCase().replaceAll(' ', '_');
  const startingPrice = Number(body.startingPrice);
  const minBidIncrement = Number(body.minBidIncrement ?? body.minIncrement);
  const closesAt = new Date(body.closesAt);
  if (!title || title.length > 120 || !description || description.length > 3000 || !AUCTION_CATEGORIES.includes(category) || !AUCTION_CONDITIONS.includes(condition) || !Number.isSafeInteger(startingPrice) || startingPrice <= 0 || !Number.isSafeInteger(minBidIncrement) || minBidIncrement <= 0 || Number.isNaN(closesAt.getTime()) || closesAt <= new Date() || photos.length === 0 || photos.length > 6) return { error: 'Add a title, description, valid category and condition, positive whole-number prices, a future close time, and at least one photo (up to six).' };
  return { value: { title, description, category, condition, startingPrice, minBidIncrement, minIncrement: minBidIncrement, closesAt, photos, image: photos[0] } };
}
async function createListing(req, res) {
  const parsed = listingValues(req.body, req.files || []);
  if (parsed.error) return fail(res, 400, parsed.error);
  const data = { ...parsed.value, currentPrice: parsed.value.startingPrice, bidCount: 0, leadingBidder: '', leadingBidderName: '', seller: req.user.name, sellerId: req.user.id, status: 'active', bids: [], questions: [], statusHistory: [historyEvent('', 'active', req.user.id)] };
  if (dbReady) return res.status(201).json(plain(await Auction.create(data)));
  const item = normalizeAuction({ ...data, _id: crypto.randomUUID(), createdAt: new Date(), updatedAt: new Date() }); memory.unshift(item); await persistDemoStore();
  return res.status(201).json(item);
}
app.post(['/api/auctions', '/api/listings'], requireAuth, allowRoles('seller'), upload.array('photos', 6), createListing);

async function editListing(req, res) {
  let item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can edit this item.');
  if (item.status !== 'active') return fail(res, 409, 'Only active listings can be edited.');
  const existingPhotos = Array.isArray(req.body.existingPhotos) ? req.body.existingPhotos : req.body.existingPhotos ? [req.body.existingPhotos] : item.photos || (item.image ? [item.image] : []);
  const parsed = listingValues(req.body, req.files || [], existingPhotos);
  if (parsed.error) return fail(res, 400, parsed.error);
  const hasBids = Number(item.bidCount || item.bids?.length || 0) > 0;
  if (hasBids && (parsed.value.category !== item.category || parsed.value.startingPrice !== item.startingPrice || parsed.value.minBidIncrement !== (item.minBidIncrement ?? item.minIncrement) || new Date(parsed.value.closesAt).getTime() !== new Date(item.closesAt).getTime())) return fail(res, 409, 'After the first bid, category, prices, and closing time are locked. You can still edit the description, condition, and photos.');
  Object.assign(item, { ...parsed.value, currentPrice: hasBids ? (item.currentPrice ?? item.bids?.at(-1)?.amount ?? item.startingPrice) : parsed.value.startingPrice, bidCount: item.bidCount ?? item.bids?.length ?? 0, bids: item.bids || [], questions: item.questions || [], statusHistory: item.statusHistory || [] });
  await saveAuction(item); return res.json(plain(item));
}
app.put(['/api/auctions/:id', '/api/listings/:id'], requireAuth, allowRoles('seller'), upload.array('photos', 6), editListing);
app.patch('/api/auctions/:id', requireAuth, allowRoles('seller'), upload.array('photos', 6), editListing);

async function cancelListing(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can cancel it.');
  if (item.status !== 'active') return fail(res, 409, 'Only active listings can be cancelled.');
  const reason = String(req.body.reason || 'Cancelled by seller').trim().slice(0, 500);
  const prior = item.status; item.status = 'cancelled'; item.outcome = 'Listing cancelled'; item.outcomeReason = reason; item.outcomeAt = new Date();
  item.statusHistory.push(historyEvent(prior, 'cancelled', req.user.id, reason)); await saveAuction(item);
  await notifyBidders(item, 'listing_cancelled', `${item.title} was cancelled by the seller. ${reason}`);
  res.json(plain(item));
}
app.post(['/api/auctions/:id/cancel', '/api/listings/:id/cancel'], requireAuth, allowRoles('seller'), cancelListing);

async function placeBid(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  await ensureClosed(item);
  const amount = Number(req.body.amount);
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail(res, 400, 'Enter a positive whole-number bid amount.');
  if (sellerOwns(item, req.user)) return fail(res, 403, 'You cannot bid on your own listing.');
  const now = new Date();
  if (dbReady) {
    const bid = { bidder: req.user.id, bidderName: req.user.name, amount, createdAt: now };
    const update = { $push: { bids: bid }, $set: { currentPrice: amount, leadingBidder: req.user.id, leadingBidderName: req.user.name }, $inc: { bidCount: 1 } };
    if (new Date(item.closesAt) - now <= 30000) update.$set.closesAt = new Date(now.getTime() + 60000);
    const updated = await Auction.findOneAndUpdate({
      _id: item._id, status: 'active', closesAt: { $gt: now }, sellerId: { $ne: req.user.id },
      $expr: { $gte: [amount, { $let: { vars: { count: { $ifNull: ['$bidCount', { $size: { $ifNull: ['$bids', []] } }] }, price: { $ifNull: ['$currentPrice', { $arrayElemAt: ['$bids.amount', -1] }] }, increment: { $ifNull: ['$minBidIncrement', '$minIncrement'] } }, in: { $cond: [{ $eq: ['$$count', 0] }, '$startingPrice', { $add: [{ $ifNull: ['$$price', '$startingPrice'] }, '$$increment'] }] } } }] }
    }, update, { new: true, runValidators: true });
    if (!updated) {
      const fresh = await findAuction(req.params.id); if (fresh) await ensureClosed(fresh);
      const minimum = fresh?.status === 'active' ? minimumNextBid({ startingPrice: fresh.startingPrice, currentPrice: fresh.currentPrice ?? fresh.startingPrice, bidCount: fresh.bidCount ?? fresh.bids?.length, minBidIncrement: fresh.minBidIncrement ?? fresh.minIncrement }) : null;
      return fail(res, fresh?.status === 'active' ? 409 : 400, fresh?.status === 'active' ? `Someone may have just outbid you. The minimum is now ₹${Number(minimum).toLocaleString('en-IN')}.` : 'Bidding has closed.', { minimum });
    }
    try { await Bid.create({ listing: String(updated._id), bidder: req.user.id, bidderName: req.user.name, amount, createdAt: now }); }
    catch (error) { console.error('Bid archive mirror failed; embedded auction history remains authoritative:', error.message); }
    if (item.leadingBidder && item.leadingBidder !== req.user.id) await notifyUser(item.leadingBidder, 'outbid', `You were outbid on ${item.title}. The new leading bid is ₹${amount.toLocaleString('en-IN')}.`, item._id);
    await notifyUser(item.sellerId, 'bid_received', `${req.user.name} bid ₹${amount.toLocaleString('en-IN')} on ${item.title}.`, item._id);
    return res.status(201).json(plain(updated));
  }
  return withListingLock(idOf(item), async () => {
    const fresh = await findAuction(req.params.id);
    const valid = validateBid({ ...fresh, minBidIncrement: fresh.minBidIncrement ?? fresh.minIncrement, amount, bidderId: req.user.id, sellerId: fresh.sellerId }, new Date());
    if (!valid.ok) return fail(res, valid.code === 'below_minimum' ? 409 : 400, valid.code === 'below_minimum' ? `Someone may have just outbid you. The minimum is now ₹${valid.minimum.toLocaleString('en-IN')}.` : valid.code === 'seller_cannot_bid' ? 'You cannot bid on your own listing.' : 'Bidding has closed.', { minimum: valid.minimum });
    const previousLeader = fresh.leadingBidder;
    fresh.bids.push({ bidder: req.user.id, bidderName: req.user.name, amount, createdAt: new Date() });
    fresh.currentPrice = amount; fresh.leadingBidder = req.user.id; fresh.leadingBidderName = req.user.name; fresh.bidCount = fresh.bids.length;
    if (new Date(fresh.closesAt) - Date.now() <= 30000) fresh.closesAt = new Date(Date.now() + 60000);
    await saveAuction(fresh);
    if (previousLeader && previousLeader !== req.user.id) await notifyUser(previousLeader, 'outbid', `You were outbid on ${fresh.title}. The new leading bid is ₹${amount.toLocaleString('en-IN')}.`, fresh._id);
    await notifyUser(fresh.sellerId, 'bid_received', `${req.user.name} bid ₹${amount.toLocaleString('en-IN')} on ${fresh.title}.`, fresh._id);
    return res.status(201).json(plain(fresh));
  });
}
app.post(['/api/auctions/:id/bids', '/api/listings/:id/bids'], requireAuth, allowRoles('buyer'), placeBid);

async function approveListing(req, res) {
  let item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can approve this bid.');
  item = await ensureClosed(item);
  if (item.status !== 'pending_approval') return fail(res, 409, 'This listing is not waiting for approval.');
  const from = item.status; item.status = 'reserved'; item.outcome = 'Winning bid approved; item reserved'; item.outcomeAt = new Date(); item.handoverNote = String(req.body.handoverNote || '').slice(0, 1000);
  item.winner = item.winner || item.leadingBidder; item.winnerName = item.winnerName || item.leadingBidderName; item.winningAmount = item.winningAmount || item.currentPrice;
  item.statusHistory.push(historyEvent(from, 'reserved', req.user.id)); await saveAuction(item);
  await notifyUser(item.winner, 'seller_approved', `Your winning bid on ${item.title} was approved. ${item.handoverNote || 'Contact the seller to arrange campus pickup.'}`, item._id);
  res.json(plain(item));
}
async function rejectListing(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can reject this bid.');
  await ensureClosed(item);
  if (item.status !== 'pending_approval') return fail(res, 409, 'This listing is not waiting for approval.');
  const reason = String(req.body.reason || 'Seller rejected the winning price').slice(0, 500); const from = item.status;
  item.status = 'rejected'; item.outcome = 'Winning bid rejected'; item.outcomeReason = reason; item.outcomeAt = new Date(); item.statusHistory.push(historyEvent(from, 'rejected', req.user.id, reason)); await saveAuction(item);
  await notifyUser(item.winner, 'seller_rejected', `The seller rejected the winning price on ${item.title}. ${reason}`, item._id);
  res.json(plain(item));
}
async function confirmSellerHandover(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can confirm handover.');
  if (item.status !== 'reserved') return fail(res, 409, 'Only a reserved listing can be handed over.');
  item.sellerHandoverConfirmedAt = new Date(); item.outcome = 'Seller confirmed campus handover; awaiting buyer receipt'; item.outcomeAt = new Date();
  await saveAuction(item); await notifyUser(item.winner, 'handover_ready', `The seller marked ${item.title} as handed over. Confirm when you receive it.`, item._id); res.json(plain(item));
}
async function confirmBuyerReceived(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (item.status !== 'reserved' || item.winner !== req.user.id) return fail(res, 403, 'Only the reserved buyer can confirm receipt.');
  if (!item.sellerHandoverConfirmedAt) return fail(res, 409, 'The seller must confirm the handover first.');
  const from = item.status; item.buyerReceivedAt = new Date(); item.status = 'completed'; item.outcome = 'Campus handover confirmed by both students'; item.outcomeAt = new Date(); item.statusHistory.push(historyEvent(from, 'completed', req.user.id));
  await saveAuction(item); await notifyUser(item.sellerId, 'handover_confirmed', `${item.title} sale is complete.`, item._id); res.json(plain(item));
}
async function pickupFailed(req, res) {
  const item = await findAuction(req.params.id);
  if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can record failed pickup.');
  if (item.status !== 'reserved') return fail(res, 409, 'Only a reserved listing can have a failed pickup recorded.');
  const reason = String(req.body.reason || 'Buyer did not complete pickup').slice(0, 500); const from = item.status;
  item.status = 'failed_pickup'; item.outcome = 'Pickup failed'; item.outcomeReason = reason; item.outcomeAt = new Date(); item.statusHistory.push(historyEvent(from, 'failed_pickup', req.user.id, reason));
  await saveAuction(item); await notifyUser(item.winner, 'pickup_failed', `Pickup failed for ${item.title}. ${reason}`, item._id); res.json(plain(item));
}
app.post(['/api/auctions/:id/approve', '/api/listings/:id/approve', '/api/auctions/:id/decision'], requireAuth, allowRoles('seller'), approveListing);
app.post(['/api/auctions/:id/reject', '/api/listings/:id/reject'], requireAuth, allowRoles('seller'), rejectListing);
app.post(['/api/auctions/:id/confirm-handover', '/api/listings/:id/confirm-handover', '/api/auctions/:id/handover'], requireAuth, allowRoles('seller'), confirmSellerHandover);
app.post(['/api/auctions/:id/confirm-received', '/api/listings/:id/confirm-received'], requireAuth, allowRoles('buyer'), confirmBuyerReceived);
app.post(['/api/auctions/:id/pickup-failed', '/api/listings/:id/pickup-failed'], requireAuth, allowRoles('seller'), pickupFailed);

app.post('/api/auctions/:id/questions', requireAuth, allowRoles('buyer'), async (req, res) => {
  const item = await findAuction(req.params.id); if (!item) return fail(res, 404, 'Auction not found.');
  if (!req.body.text?.trim()) return fail(res, 400, 'Write a question first.');
  item.questions.push({ author: req.user.name, text: String(req.body.text).trim().slice(0, 1000) }); await saveAuction(item); res.status(201).json(plain(item));
});
app.post('/api/auctions/:id/questions/:questionId/answer', requireAuth, allowRoles('seller'), async (req, res) => {
  const item = await findAuction(req.params.id); if (!item) return fail(res, 404, 'Auction not found.');
  if (!sellerOwns(item, req.user)) return fail(res, 403, 'Only the listing seller can answer questions.');
  const question = item.questions.id?.(req.params.questionId) ?? item.questions.find(q => q._id === req.params.questionId);
  if (!question) return fail(res, 404, 'Question not found.'); question.answer = String(req.body.answer || '').trim().slice(0, 1000); await saveAuction(item); res.json(plain(item));
});

app.get('/api/notifications', requireAuth, async (req, res) => {
  const since = req.query.since ? new Date(req.query.since) : null;
  const rows = dbReady ? await Notification.find({ user: req.user.id, ...(since ? { createdAt: { $gt: since } } : {}) }).sort({ createdAt: -1 }).limit(100).lean()
    : demoNotifications.filter(n => n.user === req.user.id && (!since || new Date(n.createdAt) > since)).slice(0, 100);
  const unreadCount = dbReady ? await Notification.countDocuments({ user: req.user.id, read: false }) : demoNotifications.filter(n => n.user === req.user.id && !n.read).length;
  res.json({ items: rows, unreadCount });
});
app.patch('/api/notifications/read-all', requireAuth, async (req, res) => {
  if (dbReady) await Notification.updateMany({ user: req.user.id, read: false }, { $set: { read: true } });
  else { demoNotifications.forEach(n => { if (n.user === req.user.id) n.read = true; }); await persistDemoStore(); }
  res.json({ ok: true });
});
app.patch('/api/notifications/:id/read', requireAuth, async (req, res) => {
  if (dbReady) { const n = await Notification.findOneAndUpdate({ _id: req.params.id, user: req.user.id }, { $set: { read: true } }, { new: true }); if (!n) return fail(res, 404, 'Notification not found.'); return res.json(n); }
  const n = demoNotifications.find(x => x._id === req.params.id && x.user === req.user.id); if (!n) return fail(res, 404, 'Notification not found.'); n.read = true; await persistDemoStore(); res.json(n);
});
app.patch('/api/users/me/notification-prefs', requireAuth, async (req, res) => {
  if (typeof req.body.browserNotifications !== 'boolean') return fail(res, 400, 'Set browserNotifications to true or false.');
  if (dbReady) { const user = await User.findByIdAndUpdate(req.user.id, { browserNotifications: req.body.browserNotifications }, { new: true }); if (!user) return fail(res, 404, 'Account not found.'); }
  else { const user = demoUsers.get(req.user.email); if (!user) return fail(res, 404, 'Account not found.'); user.browserNotifications = req.body.browserNotifications; await persistDemoStore(); }
  res.json({ browserNotifications: req.body.browserNotifications });
});

async function migrateMongoAuctions() {
  const users = await User.find().select('_id name email').lean();
  const usersByName = new Map(users.map(user => [String(user.name).toLowerCase(), user]));
  const listings = await Auction.find();
  for (const listing of listings) {
    const originalStatus = String(listing.status || 'active');
    const category = String(listing.category || 'other').toLowerCase();
    const condition = String(listing.condition || 'good').toLowerCase();
    listing.status = statusMap[originalStatus] || 'active';
    listing.category = categoryMap[category] || 'other';
    listing.condition = conditionMap[condition] || 'good';
    listing.photos = listing.photos?.length ? listing.photos : listing.image ? [listing.image] : [];
    listing.image = listing.image || listing.photos[0] || '';
    listing.minBidIncrement = Number(listing.minBidIncrement ?? listing.minIncrement ?? 1);
    listing.bidCount = Number(listing.bidCount ?? listing.bids?.length ?? 0);
    listing.currentPrice = Number(listing.currentPrice ?? listing.bids?.at(-1)?.amount ?? listing.startingPrice ?? 1);
    for (const bid of listing.bids || []) {
      const previousBidder = String(bid.bidder || '');
      const matchingUser = usersByName.get(previousBidder.toLowerCase());
      bid.bidderName = bid.bidderName || matchingUser?.name || previousBidder || 'Campus student';
      bid.bidder = matchingUser ? String(matchingUser._id) : previousBidder;
      if (!bid.createdAt) bid.createdAt = bid.placedAt || listing.createdAt || new Date();
    }
    const latest = listing.bids?.at(-1);
    listing.leadingBidder = listing.leadingBidder || latest?.bidder || '';
    listing.leadingBidderName = listing.leadingBidderName || latest?.bidderName || '';
    if (!listing.sellerId) listing.sellerId = String(usersByName.get(String(listing.seller || '').toLowerCase())?._id || `legacy:${listing._id}`);
    if (!listing.statusHistory) listing.statusHistory = [];
    await listing.save();
  }
}

app.use((error, _req, res, next) => {
  if (error instanceof multer.MulterError || error.message?.startsWith('Upload image')) return fail(res, 400, error.message);
  next(error);
});

async function closeAllJobs() { try { await closeDueAuctions(); await sendClosingSoon(); } catch (error) { console.error('Auction closing job failed:', error); } }
cron.schedule('* * * * *', closeAllJobs);
if (process.env.MONGODB_URI) {
  try { await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 }); await migrateMongoAuctions(); dbReady = true; console.log('Connected to MongoDB.'); }
  catch { console.warn('MongoDB connection failed. Using the durable local auction store.'); }
}
const port = process.env.PORT || 5000;
app.listen(port, () => console.log(`Campus Auction API listening on ${port}`));
