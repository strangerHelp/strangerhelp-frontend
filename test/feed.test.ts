import { describe, it, expect, beforeEach } from 'vitest';
import { env } from './cloudflare-workers';
import { createSession } from '../src/lib/session';

const DB = () => env.DB as any;

async function seedUser(id: string, verified = 0) {
  await DB().prepare(
    "INSERT INTO users (id, name, email, password, verified) VALUES (?, ?, ?, 'x', ?)"
  ).bind(id, id, `${id}@example.com`, verified).run();
}

let n = 0;
async function seedTask(o: Record<string, any> = {}) {
  const id = o.id ?? `task_${++n}`;
  await DB().prepare(
    `INSERT INTO tasks (id, title, description, category, budget, deadline, location, city,
       anonymous, urgent, lat, lng, max_claimers, attachments, poster_id, poster_name, status, created_at)
     VALUES (?, ?, ?, ?, ?, 'Today', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    id, o.title ?? 'Task ' + id, o.description ?? '', o.category ?? 'Errand',
    o.budget ?? 100, o.location ?? 'Mumbai', o.city ?? 'Mumbai',
    o.anonymous ?? 0, o.urgent ?? 0, o.lat ?? null, o.lng ?? null,
    o.max_claimers ?? 1, o.attachments ?? '[]',
    o.poster_id ?? 'poster', o.poster_name ?? 'Poster',
    o.status ?? 'open', o.created_at ?? '2026-07-01 10:00:00'
  ).run();
  return id;
}

/** Call the feed endpoint with a query string. */
async function feed(query = '', session?: string) {
  const { GET } = await import('../src/pages/api/tasks/index');
  const url = new URL(`https://strangerhelp.com/api/tasks?${query}`);
  const token = session ? await createSession(session) : null;
  const res = await GET({
    url,
    request: new Request(url.toString()),
    cookies: { get: (k: string) => (k === 'session' && token ? { value: token } : undefined) },
  } as any);
  return { res, body: await res.json() as any[] };
}

describe('feed search', () => {
  beforeEach(async () => {
    await seedUser('poster');
    await seedTask({ title: 'Fix the kitchen sink', category: 'Plumbing' });
    await seedTask({ title: 'Walk my dog', description: 'needs a plumber later', category: 'Errand' });
    await seedTask({ title: 'Collect parcel', location: 'Plumstead, London' });
    await seedTask({ title: 'Unrelated task', category: 'Other' });
  });

  // Regression: search ran in the browser over the 20 rows already fetched, so
  // matches outside the first page were silently invisible.
  it('matches on title', async () => {
    const { body } = await feed('q=kitchen');
    expect(body).toHaveLength(1);
    expect(body[0].title).toBe('Fix the kitchen sink');
  });

  it('matches on description, location and category', async () => {
    expect((await feed('q=plumber')).body).toHaveLength(1);   // description
    expect((await feed('q=Plumstead')).body).toHaveLength(1); // location
    expect((await feed('q=Plumbing')).body).toHaveLength(1);  // category
  });

  it('is case-insensitive', async () => {
    expect((await feed('q=KITCHEN')).body).toHaveLength(1);
  });

  it('returns nothing for a non-match', async () => {
    expect((await feed('q=zzzznope')).body).toHaveLength(0);
  });

  it('treats LIKE wildcards as literals', async () => {
    // '%' must not match everything, or search silently returns the whole table.
    expect((await feed('q=%')).body).toHaveLength(0);
    expect((await feed('q=_')).body).toHaveLength(0);
  });

  it('does not match an anonymous poster name', async () => {
    await seedTask({ title: 'Secret job', poster_name: 'Bruce', anonymous: 1 });
    expect((await feed('q=Bruce')).body).toHaveLength(0);
  });

  it('matches a non-anonymous poster name', async () => {
    await seedTask({ title: 'Open job', poster_name: 'Clark', anonymous: 0 });
    expect((await feed('q=Clark')).body).toHaveLength(1);
  });
});

describe('feed filters', () => {
  beforeEach(async () => {
    await seedUser('poster');
    await seedUser('vposter', 1);
    await seedTask({ budget: 50 });
    await seedTask({ budget: 500, urgent: 1 });
    await seedTask({ budget: 5000, poster_id: 'vposter' });
    await seedTask({ budget: 200, status: 'completed' });
  });

  it('filters by budget range', async () => {
    expect((await feed('minBudget=100&maxBudget=1000')).body.map(t => t.budget)).toEqual([500]);
    expect((await feed('minBudget=1000')).body.map(t => t.budget)).toEqual([5000]);
    expect((await feed('maxBudget=100')).body.map(t => t.budget)).toEqual([50]);
  });

  it('filters urgent only', async () => {
    const { body } = await feed('urgent=true');
    expect(body).toHaveLength(1);
    expect(body[0].urgent).toBe(1);
  });

  it('filters by verified poster', async () => {
    const { body } = await feed('verified=true');
    expect(body).toHaveLength(1);
    expect(body[0].posterVerified).toBe(true);
  });

  it('defaults to open tasks only', async () => {
    const { body } = await feed();
    expect(body.every(t => t.status === 'open')).toBe(true);
    expect(body).toHaveLength(3);
  });

  it('can select other statuses', async () => {
    expect((await feed('status=completed')).body).toHaveLength(1);
    expect((await feed('status=all')).body).toHaveLength(4);
  });

  it('ignores an unknown status rather than returning everything', async () => {
    const { body } = await feed('status=bogus');
    expect(body.every(t => t.status === 'open')).toBe(true);
  });

  it('filters by category', async () => {
    await seedTask({ category: 'Tutoring' });
    expect((await feed('category=Tutoring')).body).toHaveLength(1);
    expect((await feed('category=All')).body.length).toBeGreaterThan(1);
  });
});

describe('feed sorting', () => {
  beforeEach(async () => {
    await seedUser('poster');
    await seedTask({ title: 'cheap old',  budget: 10,   created_at: '2026-01-01 00:00:00' });
    await seedTask({ title: 'rich new',   budget: 9000, created_at: '2026-06-01 00:00:00' });
    await seedTask({ title: 'urgent mid', budget: 500,  created_at: '2026-03-01 00:00:00', urgent: 1 });
  });

  it('sorts by newest', async () => {
    expect((await feed('sort=newest')).body[0].title).toBe('rich new');
  });

  it('sorts by budget high then low', async () => {
    expect((await feed('sort=budget_high')).body.map(t => t.budget)).toEqual([9000, 500, 10]);
    expect((await feed('sort=budget_low')).body.map(t => t.budget)).toEqual([10, 500, 9000]);
  });

  it('sorts urgent first', async () => {
    expect((await feed('sort=urgent')).body[0].title).toBe('urgent mid');
  });

  it('falls back safely for an unknown sort', async () => {
    expect((await feed('sort=;DROP TABLE tasks')).body).toHaveLength(3);
    const still: any = await DB().prepare("SELECT COUNT(*) AS c FROM tasks").first();
    expect(still.c).toBe(3);
  });
});

describe('feed distance', () => {
  beforeEach(async () => {
    await seedUser('poster');
    // Bengaluru reference point: 12.9716, 77.5946
    await seedTask({ title: 'very near', lat: 12.9750, lng: 77.5950 });
    await seedTask({ title: 'few km',    lat: 13.0220, lng: 77.5530 });
    await seedTask({ title: 'far away',  lat: 19.0760, lng: 72.8777 }); // Mumbai
    await seedTask({ title: 'no coords', lat: null, lng: null });
  });

  it('sorts nearest first and reports distance', async () => {
    const { body } = await feed('sort=distance&lat=12.9716&lng=77.5946');
    expect(body[0].title).toBe('very near');
    expect(body[1].title).toBe('few km');
    expect(body[0].distance).toBeLessThan(body[1].distance);
  });

  it('places tasks without coordinates last instead of dropping them', async () => {
    const { body } = await feed('sort=distance&lat=12.9716&lng=77.5946');
    expect(body).toHaveLength(4);
    expect(body[body.length - 1].title).toBe('no coords');
  });

  it('restricts results with maxDistance', async () => {
    const { body } = await feed('lat=12.9716&lng=77.5946&maxDistance=10');
    const titles = body.map(t => t.title);
    expect(titles).toContain('very near');
    expect(titles).not.toContain('far away');
    expect(titles).not.toContain('no coords'); // bounding box requires coords
  });

  it('accepts lat/lng of 0 without treating it as missing', async () => {
    await seedTask({ title: 'null island', lat: 0.001, lng: 0.001 });
    const { body } = await feed('lat=0&lng=0&maxDistance=50');
    expect(body.map(t => t.title)).toEqual(['null island']);
  });
});

describe('feed pagination', () => {
  beforeEach(async () => {
    await seedUser('poster');
    for (let i = 0; i < 25; i++) {
      await seedTask({ budget: 100 + i, created_at: `2026-06-${String((i % 28) + 1).padStart(2, '0')} 10:00:00` });
    }
  });

  it('caps the page size and reports totals in headers', async () => {
    const { res, body } = await feed('limit=10&sort=newest');
    expect(body).toHaveLength(10);
    expect(res.headers.get('X-Total-Count')).toBe('25');
    expect(res.headers.get('X-Has-More')).toBe('true');
  });

  it('returns the next page without overlap', async () => {
    const a = await feed('limit=10&offset=0&sort=budget_low');
    const b = await feed('limit=10&offset=10&sort=budget_low');
    const ids = new Set(a.body.map(t => t._id));
    expect(b.body.some(t => ids.has(t._id))).toBe(false);
  });

  it('reports the final page correctly', async () => {
    const { res, body } = await feed('limit=10&offset=20&sort=newest');
    expect(body).toHaveLength(5);
    expect(res.headers.get('X-Has-More')).toBe('false');
  });

  it('clamps an oversized limit', async () => {
    const { res } = await feed('limit=9999');
    expect(res.headers.get('X-Limit')).toBe('50');
  });

  it('paginates distance-sorted results too', async () => {
    for (let i = 0; i < 5; i++) await seedTask({ lat: 12.97 + i * 0.01, lng: 77.59 });
    const a = await feed('sort=distance&lat=12.97&lng=77.59&limit=3&offset=0');
    const b = await feed('sort=distance&lat=12.97&lng=77.59&limit=3&offset=3');
    expect(a.body).toHaveLength(3);
    const ids = new Set(a.body.map(t => t._id));
    expect(b.body.some(t => ids.has(t._id))).toBe(false);
  });
});

describe('feed payload', () => {
  beforeEach(async () => {
    await seedUser('poster');
    await seedTask({
      attachments: JSON.stringify(['data:image/png;base64,AAAA', 'data:image/png;base64,BBBB']),
    });
  });

  // Attachments are base64 data URLs that can be megabytes each and the feed
  // never renders them, so the list returns only a count.
  it('returns a count instead of the base64 attachment blobs', async () => {
    const { body, res } = await feed();
    expect(body[0].attachmentCount).toBe(2);
    expect(body[0].attachments).toBeUndefined();
    const raw = JSON.stringify(body);
    expect(raw).not.toContain('base64');
    expect(res.headers.get('Content-Type')).toContain('application/json');
  });
});

describe('feed mine=true', () => {
  beforeEach(async () => {
    await seedUser('alice');
    await seedUser('bob');
    await seedTask({ title: 'alice posted', poster_id: 'alice' });
    await seedTask({ title: 'bob posted', poster_id: 'bob' });
    await seedTask({ title: 'alice claimed', poster_id: 'bob', status: 'claimed' });
    await DB().prepare("UPDATE tasks SET claimed_by = 'alice' WHERE title = 'alice claimed'").run();
  });

  it('returns an empty list when unauthenticated', async () => {
    const { body } = await feed('mine=true');
    expect(body).toEqual([]);
  });

  it('returns only the callerical posted and claimed tasks', async () => {
    const { body } = await feed('mine=true', 'alice');
    const titles = body.map(t => t.title).sort();
    expect(titles).toEqual(['alice claimed', 'alice posted']);
  });
});
