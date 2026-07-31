-- StrangerHelp D1 schema
-- Keep this file in sync with the live database. It is the source of truth for
-- rebuilding from scratch; run with:
--   wrangler d1 execute strangerhelp-db --remote --file schema.sql

-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,          -- always stored lowercase
  password TEXT NOT NULL,              -- '__google_oauth__' for OAuth-only accounts
  handle TEXT UNIQUE,
  city TEXT DEFAULT '',
  area TEXT DEFAULT '',
  country TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  skills TEXT DEFAULT '',              -- JSON array of strings
  trust_score INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_posted INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  verified INTEGER DEFAULT 0,
  verification_status TEXT DEFAULT '', -- '' | 'pending' | 'approved'
  email_verified INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
  -- Unix seconds. Session tokens issued before this are rejected, which is how
  -- a password reset revokes previously issued (stateless) session cookies.
  token_valid_from INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Tasks table
CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  budget INTEGER NOT NULL,
  deadline TEXT DEFAULT 'Today',
  location TEXT NOT NULL,
  city TEXT DEFAULT '',
  anonymous INTEGER DEFAULT 0,
  attachments TEXT DEFAULT '[]',
  poster_id TEXT NOT NULL,
  poster_name TEXT DEFAULT '',
  status TEXT DEFAULT 'open',          -- open | claimed | completed
  urgent INTEGER DEFAULT 0,
  lat REAL DEFAULT NULL,
  lng REAL DEFAULT NULL,
  max_claimers INTEGER DEFAULT 1,
  claimed_by TEXT,
  claimed_by_name TEXT,
  completion_proof TEXT DEFAULT '[]',
  completion_status TEXT DEFAULT '',   -- '' | pending | accepted | rejected
  rejection_reason TEXT DEFAULT '',
  tracking_active INTEGER DEFAULT 0,
  helper_lat REAL DEFAULT NULL,
  helper_lng REAL DEFAULT NULL,
  created_at TEXT DEFAULT (datetime('now')),
  claimed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (poster_id) REFERENCES users(id)
);

-- Per-user claims for group tasks (max_claimers > 1)
CREATE TABLE IF NOT EXISTS claimed_users (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT '',
  claimed_at TEXT DEFAULT (datetime('now')),
  UNIQUE (task_id, user_id)
);

-- Claim requests for single-claimer tasks
CREATE TABLE IF NOT EXISTS claim_requests (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  requester_id TEXT NOT NULL,
  requester_name TEXT DEFAULT '',
  status TEXT DEFAULT 'pending',       -- pending | approved | rejected
  offered_budget INTEGER,
  message TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (task_id, requester_id)
);

-- Conversations table (participant_2 = 'support' for support threads)
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  task_id TEXT,
  participant_1 TEXT NOT NULL,
  participant_2 TEXT NOT NULL,
  participant_1_name TEXT DEFAULT '',
  participant_2_name TEXT DEFAULT '',
  last_message TEXT DEFAULT '',
  last_message_at TEXT DEFAULT (datetime('now')),
  created_at TEXT DEFAULT (datetime('now'))
);

-- Messages table
CREATE TABLE IF NOT EXISTS messages (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  conversation_id TEXT NOT NULL,
  sender_id TEXT NOT NULL,             -- 'support' for admin support replies
  sender_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  attachments TEXT DEFAULT '[]',
  type TEXT DEFAULT 'text',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Reports table. type='verification' rows are written only by /api/auth/verify
-- and their description holds submitted ID documents.
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  reporter_id TEXT NOT NULL,
  reporter_name TEXT DEFAULT '',
  type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'open',          -- open | reviewing | resolved | dismissed
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
);

-- Reviews table
CREATE TABLE IF NOT EXISTS reviews (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  reviewer_id TEXT NOT NULL,
  reviewer_name TEXT DEFAULT '',
  reviewee_id TEXT NOT NULL,
  rating INTEGER NOT NULL,             -- 1..5
  comment TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (task_id, reviewer_id)
);

-- Notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT DEFAULT '',
  message TEXT DEFAULT '',
  link TEXT DEFAULT '',
  read INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Pulse (online helpers) table
CREATE TABLE IF NOT EXISTS pulse (
  user_id TEXT PRIMARY KEY,
  name TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  lat REAL NOT NULL,
  lng REAL NOT NULL,
  city TEXT DEFAULT '',
  last_seen TEXT DEFAULT (datetime('now'))
);

-- Paths (helper travelling between two points, matched against open tasks)
CREATE TABLE IF NOT EXISTS paths (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT '',
  from_location TEXT NOT NULL,
  from_lat REAL NOT NULL,
  from_lng REAL NOT NULL,
  to_location TEXT NOT NULL,
  to_lat REAL NOT NULL,
  to_lng REAL NOT NULL,
  radius_km REAL DEFAULT 1,
  recurring INTEGER DEFAULT 0,
  active INTEGER DEFAULT 1,
  expires_at TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Meets (group meetups)
CREATE TABLE IF NOT EXISTS meets (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT DEFAULT '',
  category TEXT NOT NULL,
  location TEXT DEFAULT '',
  date TEXT DEFAULT '',
  time TEXT DEFAULT '',
  visibility TEXT DEFAULT 'public',    -- public | private
  invite_code TEXT UNIQUE,
  max_attendees INTEGER DEFAULT 50,
  host_id TEXT NOT NULL,
  host_name TEXT DEFAULT '',
  voice_note TEXT DEFAULT '',
  anonymous INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS meet_attendees (
  id TEXT PRIMARY KEY,
  meet_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  user_name TEXT DEFAULT '',
  joined_at TEXT DEFAULT (datetime('now')),
  UNIQUE (meet_id, user_id)
);

-- Questions table
CREATE TABLE IF NOT EXISTS questions (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  text TEXT NOT NULL,
  category TEXT NOT NULL,
  location TEXT NOT NULL,
  anonymous INTEGER DEFAULT 1,
  poster_id TEXT NOT NULL,
  votes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- One row per user per question. The UNIQUE constraint is what prevents a
-- single account from voting repeatedly to inflate a question's score.
CREATE TABLE IF NOT EXISTS question_votes (
  id TEXT PRIMARY KEY,
  question_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  value INTEGER NOT NULL,              -- 1 (up) or -1 (down)
  created_at TEXT DEFAULT (datetime('now')),
  UNIQUE (question_id, user_id)
);

-- Answers table
CREATE TABLE IF NOT EXISTS answers (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  question_id TEXT NOT NULL,
  text TEXT NOT NULL,
  author_id TEXT NOT NULL,
  author_name TEXT DEFAULT '',
  anonymous INTEGER DEFAULT 0,
  votes INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (question_id) REFERENCES questions(id)
);

-- Web push subscriptions
CREATE TABLE IF NOT EXISTS push_subscriptions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL UNIQUE,
  keys_p256dh TEXT NOT NULL,
  keys_auth TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Single-use email tokens for verification and password reset
CREATE TABLE IF NOT EXISTS email_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  email TEXT NOT NULL,
  type TEXT NOT NULL,                  -- reset | verify
  token TEXT NOT NULL UNIQUE,
  used INTEGER DEFAULT 0,
  expires_at TEXT NOT NULL,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Fixed-window rate limiting, keyed by "action:ip"
CREATE TABLE IF NOT EXISTS rate_limits (
  key TEXT PRIMARY KEY,
  attempts INTEGER DEFAULT 0,
  window_start INTEGER DEFAULT 0,
  created_at TEXT DEFAULT (datetime('now'))
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_poster ON tasks(poster_id);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed ON tasks(claimed_by);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_p1 ON conversations(participant_1);
CREATE INDEX IF NOT EXISTS idx_conv_p2 ON conversations(participant_2);
CREATE INDEX IF NOT EXISTS idx_pulse_seen ON pulse(last_seen);
CREATE INDEX IF NOT EXISTS idx_questions_cat ON questions(category);
CREATE INDEX IF NOT EXISTS idx_qvotes_q ON question_votes(question_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);
CREATE INDEX IF NOT EXISTS idx_reviews_reviewee ON reviews(reviewee_id);
CREATE INDEX IF NOT EXISTS idx_claimed_users_task ON claimed_users(task_id);
CREATE INDEX IF NOT EXISTS idx_claim_requests_task ON claim_requests(task_id);
CREATE INDEX IF NOT EXISTS idx_meet_attendees_meet ON meet_attendees(meet_id);
CREATE INDEX IF NOT EXISTS idx_paths_user_active ON paths(user_id, active);
CREATE INDEX IF NOT EXISTS idx_push_user ON push_subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_email_tokens_token ON email_tokens(token);
