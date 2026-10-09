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

CREATE TABLE IF NOT EXISTS products (
  id BIGSERIAL PRIMARY KEY,
  user_id TEXT NOT NULL,
  name TEXT NOT NULL,
  target_margin_pct INTEGER NOT NULL DEFAULT 20
    CHECK (target_margin_pct >= 0 AND target_margin_pct <= 90),
  batch_size INTEGER NOT NULL DEFAULT 1 CHECK (batch_size >= 1 AND batch_size <= 100000),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS products_user_name ON products (user_id, (lower(name)));
COMMENT ON TABLE products IS 'staging:private';

-- What one batch of an item cost: free-text component names (ingredients,
-- packaging, gas are only the starting rows). Replaced as a set on save.
CREATE TABLE IF NOT EXISTS product_costs (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  position INTEGER NOT NULL,
  name TEXT NOT NULL,
  amount_cents BIGINT NOT NULL
);
CREATE INDEX IF NOT EXISTS product_costs_product ON product_costs (product_id, position);
COMMENT ON TABLE product_costs IS 'staging:private';

-- One dated entry per save: the cost per item and the price it sold at.
-- Unique per day, so saving twice on one day replaces that day's entry.
CREATE TABLE IF NOT EXISTS price_entries (
  id BIGSERIAL PRIMARY KEY,
  product_id BIGINT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  entry_date DATE NOT NULL,
  unit_cost_cents BIGINT NOT NULL,
  sell_price_cents BIGINT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS price_entries_product_date
  ON price_entries (product_id, entry_date);
COMMENT ON TABLE price_entries IS 'staging:private';
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
    await db.query('DELETE FROM products WHERE user_id = $1', [DEMO_USER]); // cascades
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
    // Demo items for the prices and profit screen. Amounts are whole units
    // (×100 for cents). Iced tea's newest entry is dated today, so the demo
    // always shows a cost rise this week and a dashboard alert.
    const items = [
      { name: 'Staging demo iced tea', goal: 25, batch: 30,
        costs: [['Ingredients', 54000], ['Packaging', 12000]],
        entries: [[8, 1500, 2500], [0, 2200, 2500]] },
      { name: 'Staging demo fried banana', goal: 20, batch: 20,
        costs: [['Ingredients', 30000], ['Packaging', 5000], ['Gas', 10000]],
        entries: [[15, 2000, 3000], [3, 2250, 3000]] },
      { name: 'Staging demo rice box', goal: 30, batch: 1,
        costs: [['Ingredients', 7000], ['Packaging', 1500], ['Gas', 500]],
        entries: [[12, 9000, 15000]] },
    ];
    for (const it of items) {
      const r = await db.query(
        `INSERT INTO products (user_id, name, target_margin_pct, batch_size)
         VALUES ($1, $2, $3, $4) RETURNING id`, [DEMO_USER, it.name, it.goal, it.batch]);
      const pid = r.rows[0].id;
      for (let i = 0; i < it.costs.length; i++) {
        await db.query(
          `INSERT INTO product_costs (product_id, position, name, amount_cents)
           VALUES ($1, $2, $3, $4)`, [pid, i, it.costs[i][0], it.costs[i][1] * 100]);
      }
      for (const [ago, cost, sell] of it.entries) {
        await db.query(
          `INSERT INTO price_entries (product_id, entry_date, unit_cost_cents, sell_price_cents)
           VALUES ($1, CURRENT_DATE - $2::int, $3, $4)`, [pid, ago, cost * 100, sell * 100]);
      }
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

// ── Prices and profit maths ─────────────────────────────────────────────
// One definition, used by every /api route and exported so the page's live
// readout can keep a copy of the same rules. Profit % is taken on the
// selling price: 300 profit on a 2,500 price is 12%.
function suggestedPrice(costCents, pct) {
  return Math.ceil((costCents * 100) / (100 - pct) / 100) * 100;
}

function priceFacts(costCents, sellCents, pct) {
  const profitCents = sellCents - costCents;
  return {
    profitCents,
    marginPct: Math.floor((profitCents * 100) / sellCents),
    belowGoal: profitCents * 100 < pct * sellCents,
    suggestedCents: suggestedPrice(costCents, pct),
  };
}

// The Monday that starts the week a date falls in (weeks start on Monday,
// like the rest of WageBook).
function mondayOf(dateStr) {
  const d = new Date(dateStr + 'T00:00:00Z');
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}

// Every item's price facts at its latest entry on or before today, what its
// cost was before this week started, and the entry just before the current
// one (for the "costs went up" warning). One query; the maths happens here
// in JS so lists, alerts and the item screen all read the same numbers.
async function productSummaries(db, owner, today) {
  const r = await db.query(
    `SELECT p.id, p.name, p.target_margin_pct, p.batch_size,
       cur.unit_cost_cents, cur.sell_price_cents,
       to_char(cur.entry_date, 'YYYY-MM-DD') AS entry_date,
       before_e.unit_cost_cents AS before_cost_cents,
       prev_e.unit_cost_cents AS prev_cost_cents
     FROM products p
     LEFT JOIN LATERAL (
       SELECT e.entry_date, e.unit_cost_cents, e.sell_price_cents
       FROM price_entries e WHERE e.product_id = p.id AND e.entry_date <= $2::date
       ORDER BY e.entry_date DESC LIMIT 1) cur ON true
     LEFT JOIN LATERAL (
       SELECT e.unit_cost_cents FROM price_entries e
       WHERE e.product_id = p.id AND e.entry_date < date_trunc('week', $2::date)
       ORDER BY e.entry_date DESC LIMIT 1) before_e ON true
     LEFT JOIN LATERAL (
       SELECT e.unit_cost_cents FROM price_entries e
       WHERE e.product_id = p.id AND e.entry_date < cur.entry_date
       ORDER BY e.entry_date DESC LIMIT 1) prev_e ON true
     WHERE p.user_id = $1 AND cur.entry_date IS NOT NULL
     ORDER BY p.updated_at DESC, p.id DESC`, [owner, today]);
  const weekStart = mondayOf(today);
  const list = r.rows.map((row) => {
    const costCents = Number(row.unit_cost_cents);
    const sellCents = Number(row.sell_price_cents);
    const facts = priceFacts(costCents, sellCents, row.target_margin_pct);
    return {
      id: Number(row.id),
      name: row.name,
      goalPct: row.target_margin_pct,
      batchSize: row.batch_size,
      entryDate: row.entry_date,
      costCents,
      sellCents,
      ...facts,
      costRoseCents: row.prev_cost_cents == null
        ? 0 : Math.max(0, costCents - Number(row.prev_cost_cents)),
      weekCostChangeCents: row.entry_date >= weekStart && row.before_cost_cents != null
        ? costCents - Number(row.before_cost_cents) : 0,
    };
  });
  // Below-goal items first, keeping the most-recently-updated order inside
  // each group (Array.sort is stable).
  const products = list.slice().sort((a, b) => (b.belowGoal === a.belowGoal ? 0 : (b.belowGoal ? 1 : -1)));
  const week = list.slice().sort((a, b) =>
    (b.marginPct - a.marginPct) || (b.profitCents - a.profitCents));
  return { products, week, weekStart };
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
        weeks: [], clients: [], recent: [], owedCents: 0, advanceLeftCents: 0,
        priceAlerts: [] });
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
    const sums = await productSummaries(pool, owner, today);
    const priceAlerts = sums.products.filter((p) => p.belowGoal);
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
      priceAlerts,
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

  // ── Prices and profit ───────────────────────────────────────────────────
  // Items a person sells, what one batch costs them, and the price history.
  // Ownership always goes through products.user_id: the cost and price rows
  // carry no user_id of their own.

  router.get('/api/products', async (req, res) => {
    const owner = readOwner(req);
    const today = todayFor(req);
    if (!owner) {
      return res.json({ today, weekStart: mondayOf(today), products: [], week: [] });
    }
    const sums = await productSummaries(pool, owner, today);
    res.json({ today, weekStart: sums.weekStart, products: sums.products, week: sums.week });
  });

  router.get('/api/products/:id', async (req, res) => {
    const owner = readOwner(req);
    const id = Number(req.params.id);
    if (!owner || !Number.isInteger(id)) {
      return res.status(404).json({ error: 'That item is not in your book.' });
    }
    const today = todayFor(req);
    const found = await pool.query(
      'SELECT name, target_margin_pct, batch_size FROM products WHERE id = $1 AND user_id = $2',
      [id, owner]);
    const row = found.rows[0];
    if (!row) return res.status(404).json({ error: 'That item is not in your book.' });
    const sums = await productSummaries(pool, owner, today);
    const cur = sums.products.find((p) => p.id === id) || null;
    const costs = await pool.query(
      'SELECT name, amount_cents FROM product_costs WHERE product_id = $1 ORDER BY position', [id]);
    const history = await pool.query(
      `SELECT to_char(entry_date, 'YYYY-MM-DD') AS date, unit_cost_cents, sell_price_cents
       FROM price_entries WHERE product_id = $1 ORDER BY entry_date DESC, id DESC LIMIT 12`, [id]);
    res.json({
      product: {
        id, name: row.name, goalPct: row.target_margin_pct, batchSize: row.batch_size,
        costCents: cur ? cur.costCents : 0,
        sellCents: cur ? cur.sellCents : 0,
        profitCents: cur ? cur.profitCents : 0,
        marginPct: cur ? cur.marginPct : 0,
        suggestedCents: cur ? cur.suggestedCents : 0,
        belowGoal: cur ? cur.belowGoal : false,
        costRoseCents: cur ? cur.costRoseCents : 0,
        costs: costs.rows.map((c) => ({ name: c.name, cents: Number(c.amount_cents) })),
      },
      history: history.rows.map((h) => ({
        date: h.date,
        costCents: Number(h.unit_cost_cents),
        sellCents: Number(h.sell_price_cents),
        ...priceFacts(Number(h.unit_cost_cents), Number(h.sell_price_cents), row.target_margin_pct),
      })),
    });
  });

  // One set of rules for reading a save's body, shared by POST and PUT.
  function readProductBody(b) {
    const name = cleanText(b.name, 80);
    if (!name) return { error: "Add the item's name." };
    const goal = Math.round(Number(b.goalPct));
    if (!Number.isInteger(goal) || goal < 0 || goal > 90) {
      return { error: 'Set a profit goal from 0 to 90%.' };
    }
    const batch = Math.round(Number(b.batchSize));
    if (!Number.isInteger(batch) || batch < 1 || batch > 100000) {
      return { error: 'Enter how many items these costs make.' };
    }
    if (!Array.isArray(b.costs) || b.costs.length < 1 || b.costs.length > 12) {
      return { error: 'Enter at least one cost.' };
    }
    const costs = [];
    for (const c of b.costs) {
      const cName = cleanText(c && c.name, 40);
      const amount = toCents(c && c.amount);
      if (!cName) return { error: 'Name each cost, e.g. Gas.' };
      if (amount == null) return { error: 'Enter each cost as a number.' };
      costs.push({ name: cName, cents: amount });
    }
    if (!costs.some((c) => c.cents > 0)) return { error: 'Enter at least one cost.' };
    const sell = toCents(b.sell);
    if (sell == null || sell <= 0) return { error: 'Enter your selling price.' };
    if (!DATE_RE.test(b.date || '') || Number.isNaN(Date.parse(b.date))) {
      return { error: 'Pick the day for these prices.' };
    }
    return { name, goal, batch, costs, sell, date: b.date };
  }

  function duplicateName(err, name, res) {
    if (err && err.code === '23505') {
      res.status(400).json({ error: 'You already have an item called ' + name + '.' });
      return true;
    }
    return false;
  }

  router.post('/api/products', async (req, res) => {
    const body = readProductBody(req.body || {});
    if (body.error) return res.status(400).json({ error: body.error });
    const unitCost = Math.round(body.costs.reduce((s, c) => s + c.cents, 0) / body.batch);
    const userId = String(req.user.id);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      const r = await db.query(
        `INSERT INTO products (user_id, name, target_margin_pct, batch_size)
         VALUES ($1, $2, $3, $4) RETURNING id`,
        [userId, body.name, body.goal, body.batch]);
      const pid = r.rows[0].id;
      for (let i = 0; i < body.costs.length; i++) {
        await db.query(
          `INSERT INTO product_costs (product_id, position, name, amount_cents)
           VALUES ($1, $2, $3, $4)`, [pid, i, body.costs[i].name, body.costs[i].cents]);
      }
      await db.query(
        `INSERT INTO price_entries (product_id, entry_date, unit_cost_cents, sell_price_cents)
         VALUES ($1, $2, $3, $4)`, [pid, body.date, unitCost, body.sell]);
      await db.query('COMMIT');
      res.status(201).json({ id: Number(pid) });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      if (duplicateName(err, body.name, res)) return;
      throw err;
    } finally {
      db.release();
    }
  });

  router.put('/api/products/:id', async (req, res) => {
    const id = Number(req.params.id);
    if (!Number.isInteger(id)) return res.status(404).json({ error: 'That item is not in your book.' });
    const owned = await pool.query(
      'SELECT id FROM products WHERE id = $1 AND user_id = $2', [id, String(req.user.id)]);
    if (!owned.rows[0]) return res.status(404).json({ error: 'That item is not in your book.' });
    const body = readProductBody(req.body || {});
    if (body.error) return res.status(400).json({ error: body.error });
    const unitCost = Math.round(body.costs.reduce((s, c) => s + c.cents, 0) / body.batch);
    const db = await pool.connect();
    try {
      await db.query('BEGIN');
      await db.query(
        `UPDATE products SET name = $1, target_margin_pct = $2, batch_size = $3, updated_at = NOW()
         WHERE id = $4`, [body.name, body.goal, body.batch, id]);
      await db.query('DELETE FROM product_costs WHERE product_id = $1', [id]);
      for (let i = 0; i < body.costs.length; i++) {
        await db.query(
          `INSERT INTO product_costs (product_id, position, name, amount_cents)
           VALUES ($1, $2, $3, $4)`, [id, i, body.costs[i].name, body.costs[i].cents]);
      }
      // A second save on the same day replaces that day's entry.
      await db.query(
        `INSERT INTO price_entries (product_id, entry_date, unit_cost_cents, sell_price_cents)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (product_id, entry_date) DO UPDATE
         SET unit_cost_cents = EXCLUDED.unit_cost_cents,
             sell_price_cents = EXCLUDED.sell_price_cents`, [id, body.date, unitCost, body.sell]);
      await db.query('COMMIT');
      res.json({ id });
    } catch (err) {
      await db.query('ROLLBACK').catch(() => {});
      if (duplicateName(err, body.name, res)) return;
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

module.exports = { migrate, createRouter, settle, suggestedPrice, priceFacts, OCCUPATIONS };
