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
- Item listings with edit and cancel actions, image URL, closing time, and minimum increment.
- Public bid history, bid validation, per-auction countdowns, and 30-second anti-sniping extensions.
- Seller approval/rejection, reservation, and handover outcomes.
- Saved search alerts, auction questions, browser notification permission, and a consent-first assistant tab.

This is a hackathon MVP. Student identity is represented by a name in the UI; add campus SSO and authorization before using it for real transactions.
