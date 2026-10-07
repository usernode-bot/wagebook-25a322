// WageBook's data: the schema, the staging demo seed and the /api routes.
//
// Money is stored as integer cents (BIGINT) and sent to the page as whole
// numbers of cents too; the page formats them. Dates are plain DATEs, always
// read back with to_char so no time zone can shift them by a day.
//
// Every table is keyed to the signed-in person (req.user.id, stored as text)
// and marked staging:private: wages, advances and who pays them are personal
// financial records.

const express = require('express');

const IS_STAGING = process.env.USERNODE_ENV === 'staging';
// The fake owner of the staging demo book. Never the visitor: a preview shows
// it only behind ?demo=1, and only for reads.
const DEMO_USER = 'staging-demo-user';

const OCCUPATIONS = [
  'Construction worker',
  'Carpenter',
  'Welder',
  'Delivery or ride-hailing driver',
  'Motorcycle taxi driver',
  'Domestic helper',
  'Other',
];
const STATUSES = ['paid', 'unpaid', 'partial'];
const PAY_BASES = ['day', 'hour'];
const MAX_CENTS = 100_000_000_000_00; // 100 billion, far above any real wage
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS profiles (
  user_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  photo_url TEXT,
  occupation TEXT,
  location TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
COMMENT ON TABLE profiles IS 'staging:private';

CREATE TABLE IF NOT EXISTS clients (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS clients_user_name ON clients (user_id, (lower(name)));
COMMENT ON TABLE clients IS 'staging:private';

CREATE TABLE IF NOT EXISTS work_logs (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  work_date DATE NOT NULL,
  work_type TEXT NOT NULL DEFAULT '',
  pay_basis TEXT NOT NULL CHECK (pay_basis IN ('day', 'hour')),
  quantity NUMERIC(7,2) NOT NULL,
  rate_cents BIGINT NOT NULL,
  total_cents BIGINT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('paid', 'unpaid', 'partial')),
  paid_cents BIGINT NOT NULL DEFAULT 0,
  photo_url TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS work_logs_user_date ON work_logs (user_id, work_date);
COMMENT ON TABLE work_logs IS 'staging:private';

CREATE TABLE IF NOT EXISTS advances (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  client_id BIGINT NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  advance_date DATE NOT NULL,
  amount_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS advances_user_date ON advances (user_id, advance_date);
COMMENT ON TABLE advances IS 'staging:private';
`;

async function migrate(pool) {
  await pool.query(SCHEMA);
  if (IS_STAGING) await seedDemo(pool);
}

// Rebuilt on every staging boot (delete then insert, for the fake owner
// only) so the demo dates stay relative to today and "this week" is never
// empty. A no-op outside staging.
async function seedDemo(pool) {
  const db = await pool.connect();
  try {
    await db.query('BEGIN');
    await db.query('DELETE FROM work_logs WHERE user_id = $1', [DEMO_USER]);
    await db.query('DELETE FROM advances WHERE user_id = $1', [DEMO_USER]);
    await db.query('DELETE FROM clients WHERE user_id = $1', [DEMO_USER]);
    await db.query(
      `INSERT INTO profiles (user_id, name, occupation, location)
       VALUES ($1, 'Staging demo worker', 'Carpenter', 'Staging demo town')
       ON CONFLICT (user_id) DO NOTHING`, [DEMO_USER]);
    const names = ['Staging demo builder', 'Staging demo cafe', 'Staging demo family'];
    const ids = {};
    for (const n of names) {
      const r = await db.query(
        'INSERT INTO clients (user_id, name) VALUES ($1, $2) RETURNING id', [DEMO_USER, n]);
      ids[n] = r.rows[0].id;
    }
    // [days ago, client, work type, basis, quantity, rate, status, paid]
    const logs = [
      [0, 'Staging demo builder', 'Roof frame', 'day', 1, 150000, 'unpaid', 0],
      [1, 'Staging demo builder', 'Roof frame', 'day', 1, 150000, 'unpaid', 0],
      [2, 'Staging demo cafe', 'Shelves', 'hour', 5, 25000, 'partial', 60000],
      [4, 'Staging demo builder', 'Door frames', 'day', 1, 150000, 'paid', 150000],
      [6, 'Staging demo family', 'Cupboard repair', 'hour', 3, 25000, 'paid', 75000],
      [8, 'Staging demo builder', 'Door frames', 'day', 1, 150000, 'paid', 150000],
      [9, 'Staging demo builder', 'Door frames', 'day', 1, 150000, 'paid', 150000],
      [13, 'Staging demo cafe', 'Counter top', 'day', 1, 175000, 'paid', 175000],
      [16, 'Staging demo builder', 'Floor boards', 'day', 1, 150000, 'paid', 150000],
      [20, 'Staging demo family', 'Window fix', 'hour', 4, 25000, 'paid', 100000],
      [23, 'Staging demo builder', 'Floor boards', 'day', 1, 150000, 'paid', 150000],
      [30, 'Staging demo cafe', 'Benches', 'day', 1, 175000, 'paid', 175000],
      [37, 'Staging demo builder', 'Stairs', 'day', 1, 150000, 'paid', 150000],
      [44, 'Staging demo builder', 'Stairs', 'day', 1, 150000, 'paid', 150000],
    ];
    for (const [ago, client, type, basis, qty, rate, status, paid] of logs) {
      await db.query(
        `INSERT INTO work_logs (user_id, client_id, work_date, work_type, pay_basis,
           quantity, rate_cents, total_cents, status, paid_cents)
         VALUES ($1, $2, CURRENT_DATE - $3::int, $4, $5, $6, $7, $8, $9, $10)`,
        [DEMO_USER, ids[client], ago, type, basis, qty, rate * 100,
          Math.round(qty * rate * 100), status, paid * 100]);
    }
    // The builder's advance is covered by unpaid wages; the cafe's is not,
    // so a remaining advance balance shows too.
    const advances = [[3, 'Staging demo builder', 200000], [5, 'Staging demo cafe', 150000]];
    for (const [ago, client, amount] of advances) {
      await db.query(
        `INSERT INTO advances (user_id, client_id, advance_date, amount_cents)
         VALUES ($1, $2, CURRENT_DATE - $3::int, $4)`,
        [DEMO_USER, ids[client], ago, amount * 100]);
    }
    await db.query('COMMIT');
  } catch (err) {
    await db.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    db.release();
  }
}

// Whose book a read shows: the signed-in person, or on a staging preview
// with ?demo=1 the fake demo owner. Guests have no book (null).
function readOwner(req) {
  if (IS_STAGING && req.query.demo === '1') return DEMO_USER;
  return req.user ? String(req.user.id) : null;
}

// The page sends its own local date, so "today" and "this week" follow the
// worker's day rather than the server's UTC one. Falls back to req.now.
function todayFor(req) {
  const t = req.query.today;
  if (typeof t === 'string' && DATE_RE.test(t) && !Number.isNaN(Date.parse(t))) return t;
  return req.now.toISOString().slice(0, 10);
}

function toCents(v) {
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) return null;
  const c = Math.round(n * 100);
  return c <= MAX_CENTS ? c : null;
}

function cleanText(v, max) {
  return typeof v === 'string' ? v.trim().replace(/\s+/g, ' ').slice(0, max) : '';
}

// Each client's advances are taken from the unpaid wages that client owes.
// Whatever is left over on one side is what remains: wages still owed, or an
// advance balance not yet covered by work.
function settle(owedCents, advanceCents) {
  return {
    owedCents: Math.max(0, owedCents - advanceCents),
    advanceLeftCents: Math.max(0, advanceCents - owedCents),
  };
}

async function upsertClient(db, userId, name) {
  const r = await db.query(
    `INSERT INTO clients (user_id, name) VALUES ($1, $2)
     ON CONFLICT (user_id, (lower(name))) DO UPDATE SET last_used_at = NOW()
     RETURNING id`, [userId, name]);
  return r.rows[0].id;
}

async function clientBalances(db, owner) {
  const r = await db.query(
    `SELECT c.id, c.name,
       COALESCE((SELECT SUM(total_cents - paid_cents) FROM work_logs w
                 WHERE w.client_id = c.id), 0) AS unpaid,
       COALESCE((SELECT SUM(amount_cents) FROM advances a
                 WHERE a.client_id = c.id), 0) AS advanced
     FROM clients c WHERE c.user_id = $1
     ORDER BY c.last_used_at DESC`, [owner]);
  return r.rows.map((row) => {
    const unpaid = Number(row.unpaid);
    const advanced = Number(row.advanced);
    return { id: Number(row.id), name: row.name, unpaidCents: unpaid,
      advancedCents: advanced, ...settle(unpaid, advanced) };
  });
}

function createRouter(pool) {
  const router = express.Router();

  router.get('/api/me', async (req, res) => {
    const owner = readOwner(req);
    let profile = null;
    if (owner) {
      const r = await pool.query(
        'SELECT name, photo_url, occupation, location FROM profiles WHERE user_id = $1', [owner]);
      profile = r.rows[0] || null;
    }
    res.json({
      signedIn: !!req.user,
      username: req.user ? req.user.username : null,
      demo: owner === DEMO_USER,
      profile,
      occupations: OCCUPATIONS,
    });
  });

  router.put('/api/profile', async (req, res) => {
    const b = req.body || {};
    const occupation = OCCUPATIONS.includes(b.occupation) ? b.occupation : null;
    const photo = typeof b.photoUrl === 'string' && /^https?:\/\//.test(b.photoUrl)
      ? b.photoUrl.slice(0, 500) : null;
    const r = await pool.query(
      `INSERT INTO profiles (user_id, name, photo_url, occupation, location, updated_at)
       VALUES ($1, $2, $3, $4, $5, NOW())
       ON CONFLICT (user_id) DO UPDATE SET name = $2, photo_url = $3,
         occupation = $4, location = $5, updated_at = NOW()
       RETURNING name, photo_url, occupation, location`,
      [String(req.user.id), cleanText(b.name, 80), photo, occupation, cleanText(b.location, 120)]);
    res.json({ profile: r.rows[0] });
  });

  router.get('/api/dashboard', async (req, res) => {
    const owner = readOwner(req);
    const today = todayFor(req);
    if (!owner) {
      return res.json({ today, monthCents: 0, weekCents: 0, monthDays: 0,
        weeks: [], clients: [], recent: [], owedCents: 0, advanceLeftCents: 0 });
    }
    const totals = await pool.query(
      `SELECT
         COALESCE(SUM(total_cents) FILTER (WHERE work_date >= date_trunc('month', $2::date)
           AND work_date < date_trunc('month', $2::date) + interval '1 month'), 0) AS month,
         COUNT(DISTINCT work_date) FILTER (WHERE work_date >= date_trunc('month', $2::date)
           AND work_date < date_trunc('month', $2::date) + interval '1 month') AS month_days,
         COALESCE(SUM(total_cents) FILTER (WHERE work_date >= date_trunc('week', $2::date)
           AND work_date < date_trunc('week', $2::date) + interval '1 week'), 0) AS week
       FROM work_logs WHERE user_id = $1`, [owner, today]);
    const weeks = await pool.query(
      `SELECT to_char(s.start, 'YYYY-MM-DD') AS start, COALESCE(SUM(w.total_cents), 0) AS total
       FROM generate_series(date_trunc('week', $2::date) - interval '7 weeks',
                            date_trunc('week', $2::date), interval '1 week') AS s(start)
       LEFT JOIN work_logs w ON w.user_id = $1
         AND w.work_date >= s.start AND w.work_date < s.start + interval '1 week'
       GROUP BY s.start ORDER BY s.start`, [owner, today]);
    const recent = await pool.query(
      `SELECT * FROM (
         SELECT 'work' AS kind, w.id, to_char(w.work_date, 'YYYY-MM-DD') AS date, c.name AS client,
           w.work_type, w.pay_basis, w.quantity, w.total_cents AS amount, w.status, w.paid_cents,
           w.photo_url, w.created_at
         FROM work_logs w JOIN clients c ON c.id = w.client_id WHERE w.user_id = $1
         UNION ALL
         SELECT 'advance', a.id, to_char(a.advance_date, 'YYYY-MM-DD'), c.name,
           NULL, NULL, NULL, a.amount_cents, NULL, NULL, NULL, a.created_at
         FROM advances a JOIN clients c ON c.id = a.client_id WHERE a.user_id = $1
       ) e ORDER BY date DESC, created_at DESC LIMIT 8`, [owner]);
    const clients = await clientBalances(pool, owner);
    const t = totals.rows[0];
    res.json({
      today,
      monthCents: Number(t.month),
      weekCents: Number(t.week),
      monthDays: Number(t.month_days),
      weeks: weeks.rows.map((w) => ({ start: w.start, cents: Number(w.total) })),
      clients,
      owedCents: clients.reduce((s, c) => s + c.owedCents, 0),
      advanceLeftCents: clients.reduce((s, c) => s + c.advanceLeftCents, 0),
      recent: recent.rows.map((e) => ({
        kind: e.kind, id: Number(e.id), date: e.date, client: e.client,
        workType: e.work_type, payBasis: e.pay_basis,
        quantity: e.quantity == null ? null : Number(e.quantity),
        cents: Number(e.amount), status: e.status,
        paidCents: e.paid_cents == null ? null : Number(e.paid_cents),
        photoUrl: e.photo_url,
      })),
    });
  });

  // Frequent clients for the quick-pick chips, each with what was last
  // logged for them, so a repeat job is a couple of taps.
  router.get('/api/clients', async (req, res) => {
    const owner = readOwner(req);
    if (!owner) return res.json({ clients: [], workTypes: [] });
    const clients = await clientBalances(pool, owner);
    const last = await pool.query(
      `SELECT DISTINCT ON (client_id) client_id, work_type, pay_basis, quantity, rate_cents
       FROM work_logs WHERE user_id = $1 ORDER BY client_id, work_date DESC, id DESC`, [owner]);
    const byClient = new Map(last.rows.map((r) => [Number(r.client_id), r]));
    const types = await pool.query(
      `SELECT work_type FROM work_logs WHERE user_id = $1 AND work_type <> ''
       GROUP BY work_type ORDER BY MAX(created_at) DESC LIMIT 8`, [owner]);
    res.json({
      clients: clients.slice(0, 12).map((c) => {
        const l = byClient.get(c.id);
        return { ...c, last: l ? { workType: l.work_type, payBasis: l.pay_basis,
          quantity: Number(l.quantity), rateCents: Number(l.rate_cents) } : null };
      }),
      workTypes: types.rows.map((r) => r.work_type),
    });
  });

  router.post('/api/work-logs', async (req, res) => {
    const b = req.body || {};
    const client = cleanText(b.client, 80);
    const workType = cleanText(b.workType, 80);
    const quantity = Number(b.quantity);
    const rate = toCents(b.rate);
    const total = toCents(b.total);
    let paid = toCents(b.paid);
    if (!DATE_RE.test(b.date || '') || Number.isNaN(Date.parse(b.date))) {
      return res.status(400).json({ error: 'Pick the day you worked.' });
    }
    if (!client) return res.status(400).json({ error: 'Add who you worked for.' });
    if (!PAY_BASES.includes(b.payBasis)) return res.status(400).json({ error: 'Choose by the day or by the hour.' });
    if (!(quantity > 0 && quantity <= 999)) return res.status(400).json({ error: 'Enter how many days or hours.' });
    if (rate == null || total == null) return res.status(400).json({ error: 'Enter the pay as a number.' });
    if (!STATUSES.includes(b.status)) return res.status(400).json({ error: 'Choose if you were paid.' });
    if (b.status === 'paid') paid = total;
    else if (b.status === 'unpaid') paid = 0;
    else if (paid == null || paid <= 0 || paid >= total) {
      return res.status(400).json({ error: 'For part paid, enter an amount above 0 and below the total wage.' });
    }
    const photo = typeof b.photoUrl === 'string' && /^https?:\/\//.test(b.photoUrl)
      ? b.photoUrl.slice(0, 500) : null;
    const userId = String(req.user.id);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const clientId = await upsertClient(db, userId, client);
      const r = await db.query(
        `INSERT INTO work_logs (user_id, client_id, work_date, work_type, pay_basis, quantity,
           rate_cents, total_cents, status, paid_cents, photo_url)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
        [userId, clientId, b.date, workType, b.payBasis, Math.round(quantity * 100) / 100,
          rate, total, b.status, paid, photo]);
      await db.query('COMMIT');
      res.status(201).json({ id: Number(r.rows[0].id) });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });

  router.post('/api/advances', async (req, res) => {
    const b = req.body || {};
    const client = cleanText(b.client, 80);
    const amount = toCents(b.amount);
    if (!DATE_RE.test(b.date || '') || Number.isNaN(Date.parse(b.date))) {
      return res.status(400).json({ error: 'Pick the day you got the advance.' });
    }
    if (!client) return res.status(400).json({ error: 'Add who gave you the advance.' });
    if (!amount) return res.status(400).json({ error: 'Enter the advance amount.' });
    const userId = String(req.user.id);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const clientId = await upsertClient(db, userId, client);
      const r = await db.query(
        `INSERT INTO advances (user_id, client_id, advance_date, amount_cents)
         VALUES ($1, $2, $3, $4) RETURNING id`, [userId, clientId, b.date, amount]);
      await db.query('COMMIT');
      res.status(201).json({ id: Number(r.rows[0].id) });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      throw err;
    } finally {
      db.release();
    }
  });

  // Express 4 does not catch rejected promises from async handlers.
  for (const layer of router.stack) {
    for (const l of layer.route.stack) {
      const fn = l.handle;
      l.handle = (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
    }
  }
  router.use('/api', (err, _req, res, _next) => {
    console.error('[api]', err.message);
    res.status(500).json({ error: 'Something went wrong on our side. Try again.' });
  });

  return router;
}

module.exports = { migrate, createRouter, settle, OCCUPATIONS };
