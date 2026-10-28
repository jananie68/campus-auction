# Campus Auction

A campus marketplace where every item gets its own timed auction, transparent bidding, and a clear handover outcome.

## Run locally

1. Install Node.js 18+ and MongoDB (local or Atlas).
2. From this folder run `npm run install:all`.
3. Copy `backend/.env.example` to `backend/.env` and set `MONGODB_URI` (defaults to local MongoDB).
4. Run `npm run dev` and open [http://localhost:5173](http://localhost:5173).

The API runs on port 5000. If MongoDB is unavailable, the demo backend persists accounts and auction changes in `backend/data/store.json`, so they survive page refreshes and server restarts. That local data file is excluded from Git. Sign-up and log-in use hashed passwords and signed sessions; configure a private `JWT_SECRET` for any deployed environment.

## Included

- Search and filters for category, condition, price, and closing soon.
- Separate buyer and seller accounts: buyers browse and bid, while sellers manage listings and confirm auction outcomes.
- Item listings with edit and cancel actions, local multi-photo uploads, closing time, and minimum increment.
- Public bid history, bid validation, per-auction countdowns, and 30-second anti-sniping extensions.
- Seller approval/rejection, reservation, and handover outcomes.
- Saved items, auction questions and seller replies, in-app and optional browser notifications, and a consent-first listing assistant.
- Search sorting and pagination, server-side role guards, lazy and scheduled auction closing, and seller/buyer handover confirmation.
- Rule tests for bid thresholds, bid rejection, closing outcomes, idempotency, and serialized simultaneous demo bids.

Uploaded images are stored locally in `backend/uploads` and served from `/uploads`; use persistent object storage for deployment. The demo JSON mode is useful for local development; use MongoDB for shared multi-user persistence.

This is a hackathon MVP. Student identity is represented by a name in the UI; add campus SSO and authorization before using it for real transactions.
