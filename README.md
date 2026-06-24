# StrangerHelp

A hyperlocal task marketplace where strangers help strangers with physical errands — document submissions, parcel pickups, queue standing, photo verifications, and more.

**Live:** https://strangerhelp.com

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Astro 6 (full SSR, `output: 'server'`) |
| UI | Tailwind CSS 4 + React 19 (islands) |
| Database | Cloudflare D1 (SQLite) |
| Hosting | Cloudflare Workers (edge) |
| Auth | HMAC-SHA256 signed session cookies + bcrypt |
| CLI | Wrangler |

## Project Structure

```
src/
├── lib/              # Shared utilities
│   ├── auth.ts       # Session verification, getUser(), getSessionUserId()
│   ├── admin.ts      # Admin check helper
│   ├── db.ts         # D1 helpers, ID generation, file encoding
│   ├── session.ts    # HMAC sign/verify for session tokens
│   └── ratelimit.ts  # IP-based rate limiting via D1
├── middleware.ts     # Route protection, banned user check
├── layouts/          # Astro layouts (Layout, AccountLayout, PublicLayout)
├── components/       # Shared UI components (Navbar, Footer, TaskCard, etc.)
├── pages/
│   ├── api/          # REST API endpoints
│   │   ├── auth/     # login, register, logout, me, profile, verify
│   │   ├── tasks/    # CRUD + claim/complete flow
│   │   ├── messages/ # Conversations + messages
│   │   ├── questions/# Q&A system
│   │   ├── admin/    # Admin actions
│   │   ├── notifications.ts
│   │   ├── pulse.ts  # Live helper map
│   │   ├── reports.ts
│   │   └── reviews.ts
│   ├── dashboard/    # User dashboard, profile, settings
│   ├── tasks/        # Browse, create, view tasks
│   ├── chat/         # Messaging UI
│   ├── ask/          # Q&A section
│   ├── admin/        # Admin panel
│   └── ...           # Landing pages, legal, SEO pages
└── styles/           # Global CSS
```

## Database Schema

See `schema.sql` for full schema. Key tables:
- `users` — accounts with trust_score, rating, verification status
- `tasks` — task listings with status lifecycle (open → claimed → completed)
- `conversations` / `messages` — chat between task poster and helper
- `questions` / `answers` — community Q&A with voting
- `notifications` — in-app notifications
- `reviews` — mutual ratings after task completion
- `pulse` — live GPS positions of online helpers
- `reports` — abuse reports + ID verification submissions
- `rate_limits` — IP-based rate limiting

## Auth Flow

1. User registers/logs in → server creates HMAC-SHA256 signed token (`userId.timestamp.signature`)
2. Token stored in httpOnly secure cookie (7-day expiry)
3. All API routes call `getSessionUserId(cookies)` which verifies signature + checks expiry
4. Middleware protects page routes, checks banned status
5. Rate limiting on login/register (10 attempts per 15min per IP)

## Environment Variables / Secrets

Configured as Cloudflare Worker secrets (via `wrangler secret put`):
- `SESSION_SECRET` — 256-bit key for HMAC session signing
- `ADMIN_SETUP_KEY` — required to promote a user to admin

## Local Development

```bash
npm install
npm run dev        # Starts dev server at localhost:4321
```

For D1 access locally, wrangler creates a local SQLite database.

## Deployment

```bash
npm run build      # Astro build
npx wrangler deploy # Deploy to Cloudflare Workers
```

## Key Design Decisions

- **Edge-first**: Everything runs on Cloudflare Workers globally
- **No client-side routing**: Full SSR with Astro, React only for interactive islands
- **Polling-based chat**: No WebSockets yet (planned: Durable Objects)
- **Base64 attachments in D1**: Known scalability issue (planned: migrate to R2)
- **Denormalized names**: poster_name, sender_name stored alongside IDs for read performance
- **CSRF protection**: Astro's built-in origin checking enabled
- **India-first**: Budgets in ₹, UPI payment references, Indian city focus

## Known Issues / TODO

- [ ] Replace base64 file storage with Cloudflare R2
- [ ] Real-time chat via Durable Objects + WebSockets
- [ ] Google Maps / Leaflet integration for Pulse and task locations
- [ ] Payment/escrow system
- [ ] Email verification
- [ ] Push notifications
- [ ] Pagination on list endpoints
- [ ] Input sanitization (XSS prevention)
