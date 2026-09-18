/* ============================================================================
   Precision vs. Volume — the bit that remembers people and their scores.

   Serves the game itself, and four small endpoints behind /api/. Everything
   else is a static file.
   ========================================================================== */

const JSON_HEADERS = { 'content-type': 'application/json; charset=utf-8' };

function json(data, status = 200) {
  return new Response(JSON.stringify(data), { status, headers: JSON_HEADERS });
}

function clean(value, max) {
  if (typeof value !== 'string') return '';
  return value.replace(/\s+/g, ' ').trim().slice(0, max);
}

function looksLikeEmail(value) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value);
}

function now() {
  return new Date().toISOString();
}

/* ---------------------------------------------------------------------------
   POST /api/register
   Takes the form. Same email twice is the same person — their details are
   updated and they keep their history rather than becoming a second player.
   --------------------------------------------------------------------------- */
async function register(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const email      = clean(body.email, 200).toLowerCase();
  const playerName = clean(body.playerName, 20);
  const fullName   = clean(body.fullName, 80);
  const company    = clean(body.company, 80);

  if (!looksLikeEmail(email)) return json({ error: 'Enter a valid email address.' }, 400);
  if (!playerName)            return json({ error: 'Enter a player name.' }, 400);
  if (!fullName)              return json({ error: 'Enter your name.' }, 400);
  if (!company)               return json({ error: 'Enter your company.' }, 400);

  const existing = await env.DB
    .prepare('SELECT id, token FROM players WHERE email = ?')
    .bind(email).first();

  if (existing) {
    await env.DB.prepare(
      'UPDATE players SET player_name = ?, full_name = ?, company = ?, updated_at = ? WHERE id = ?'
    ).bind(playerName, fullName, company, now(), existing.id).run();
    return json({ token: existing.token, playerName, returning: true });
  }

  const token = crypto.randomUUID();
  const stamp = now();
  await env.DB.prepare(
    `INSERT INTO players (email, player_name, full_name, company, token, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).bind(email, playerName, fullName, company, token, stamp, stamp).run();

  return json({ token, playerName, returning: false });
}

/* ---------------------------------------------------------------------------
   GET /api/me?token=...   — is this phone someone we already know?
   --------------------------------------------------------------------------- */
async function me(url, env) {
  const token = clean(url.searchParams.get('token'), 80);
  if (!token) return json({ known: false });
  const row = await env.DB
    .prepare('SELECT player_name FROM players WHERE token = ?')
    .bind(token).first();
  return row ? json({ known: true, playerName: row.player_name }) : json({ known: false });
}

/* ---------------------------------------------------------------------------
   GET /api/scores — the top ten, best run per player so nobody can fill the
   board on their own.
   --------------------------------------------------------------------------- */
async function scores(env) {
  const { results } = await env.DB.prepare(
    `SELECT p.player_name AS playerName, s.side, MAX(s.score) AS score
       FROM scores s
       JOIN players p ON p.id = s.player_id
      GROUP BY p.id
      ORDER BY score DESC, s.created_at ASC
      LIMIT 10`
  ).all();
  return json({ scores: results || [] });
}

/* ---------------------------------------------------------------------------
   POST /api/score — record a finished round.
   --------------------------------------------------------------------------- */
async function submitScore(request, env) {
  let body;
  try { body = await request.json(); } catch { return json({ error: 'bad request' }, 400); }

  const token = clean(body.token, 80);
  if (!token) return json({ error: 'not registered' }, 401);

  const player = await env.DB
    .prepare('SELECT id FROM players WHERE token = ?')
    .bind(token).first();
  if (!player) return json({ error: 'not registered' }, 401);

  const side = body.side === 'volume' ? 'volume' : 'precision';
  const score = Math.max(0, Math.min(1000000, Math.floor(Number(body.score) || 0)));

  await env.DB.prepare(
    `INSERT INTO scores
       (player_id, side, score, seconds, won, invaders_left, shots_fired, shots_hit, shots_blocked, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    player.id, side, score,
    Number(body.seconds) || 0,
    body.won ? 1 : 0,
    Math.max(0, Math.floor(Number(body.invadersLeft) || 0)),
    Math.max(0, Math.floor(Number(body.shotsFired) || 0)),
    Math.max(0, Math.floor(Number(body.shotsHit) || 0)),
    Math.max(0, Math.floor(Number(body.shotsBlocked) || 0)),
    now()
  ).run();

  const better = await env.DB.prepare(
    `SELECT COUNT(*) AS n FROM (
       SELECT MAX(score) AS best FROM scores GROUP BY player_id
     ) WHERE best > ?`
  ).bind(score).first();

  return json({ ok: true, rank: (better ? better.n : 0) + 1 });
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith('/api/')) {
      try {
        if (url.pathname === '/api/register' && request.method === 'POST') return await register(request, env);
        if (url.pathname === '/api/me'       && request.method === 'GET')  return await me(url, env);
        if (url.pathname === '/api/scores'   && request.method === 'GET')  return await scores(env);
        if (url.pathname === '/api/score'    && request.method === 'POST') return await submitScore(request, env);
        return json({ error: 'not found' }, 404);
      } catch (err) {
        return json({ error: 'server error' }, 500);
      }
    }

    return env.ASSETS.fetch(request);
  }
};
