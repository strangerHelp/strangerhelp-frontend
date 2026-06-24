-- Users table
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  name TEXT NOT NULL,
  email TEXT UNIQUE NOT NULL,
  password TEXT NOT NULL,
  city TEXT DEFAULT '',
  area TEXT DEFAULT '',
  phone TEXT DEFAULT '',
  bio TEXT DEFAULT '',
  avatar TEXT DEFAULT '',
  trust_score INTEGER DEFAULT 0,
  tasks_completed INTEGER DEFAULT 0,
  tasks_posted INTEGER DEFAULT 0,
  rating REAL DEFAULT 0,
  verified INTEGER DEFAULT 0,
  is_admin INTEGER DEFAULT 0,
  banned INTEGER DEFAULT 0,
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
  status TEXT DEFAULT 'open',
  claimed_by TEXT,
  claimed_by_name TEXT,
  completion_proof TEXT DEFAULT '[]',
  created_at TEXT DEFAULT (datetime('now')),
  claimed_at TEXT,
  completed_at TEXT,
  FOREIGN KEY (poster_id) REFERENCES users(id)
);

-- Conversations table
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
  sender_id TEXT NOT NULL,
  sender_name TEXT DEFAULT '',
  text TEXT DEFAULT '',
  attachments TEXT DEFAULT '[]',
  type TEXT DEFAULT 'text',
  created_at TEXT DEFAULT (datetime('now')),
  FOREIGN KEY (conversation_id) REFERENCES conversations(id)
);

-- Reports table
CREATE TABLE IF NOT EXISTS reports (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(12)))),
  reporter_id TEXT NOT NULL,
  reporter_name TEXT DEFAULT '',
  type TEXT NOT NULL,
  target_id TEXT,
  reason TEXT NOT NULL,
  description TEXT DEFAULT '',
  status TEXT DEFAULT 'open',
  admin_note TEXT DEFAULT '',
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT
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

-- Indexes
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status);
CREATE INDEX IF NOT EXISTS idx_tasks_poster ON tasks(poster_id);
CREATE INDEX IF NOT EXISTS idx_tasks_claimed ON tasks(claimed_by);
CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_conv_p1 ON conversations(participant_1);
CREATE INDEX IF NOT EXISTS idx_conv_p2 ON conversations(participant_2);
CREATE INDEX IF NOT EXISTS idx_pulse_seen ON pulse(last_seen);
CREATE INDEX IF NOT EXISTS idx_questions_cat ON questions(category);
