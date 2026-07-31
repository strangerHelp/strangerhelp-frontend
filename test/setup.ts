import { beforeAll, beforeEach } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { env } from './cloudflare-workers';
import { createTestD1 } from './d1';

const TABLES = [
  'users', 'tasks', 'claimed_users', 'claim_requests', 'conversations',
  'messages', 'reports', 'reviews', 'notifications', 'pulse', 'paths',
  'meets', 'meet_attendees', 'questions', 'question_votes', 'answers',
  'push_subscriptions', 'email_tokens', 'rate_limits',
];

export const db = createTestD1();

beforeAll(() => {
  // Apply the real schema.sql so tests fail if it drifts from the code.
  const sql = fs.readFileSync(path.resolve(__dirname, '../schema.sql'), 'utf-8');
  db._raw.exec(sql);
  env.DB = db;
});

beforeEach(() => {
  // Truncate with FK enforcement off so table order does not matter.
  db._raw.exec('PRAGMA foreign_keys = OFF');
  for (const t of TABLES) db._raw.exec(`DELETE FROM ${t}`);
  db._raw.exec('PRAGMA foreign_keys = ON');
});
