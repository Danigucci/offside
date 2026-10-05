import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export const ROUNDS = 7;
const MAX_TEAMS = 60;

const digest = (s) => createHash('sha256').update(String(s)).digest();

export function checkPassword(given, expected) {
  if (!expected) return null;
  return timingSafeEqual(digest(given || ''), digest(expected));
}

export const emptyState = () => ({ title: '', teams: [], scores: {}, rev: 0 });

export function sanitizeState(input) {
  const src = input && typeof input === 'object' ? input : {};
  const title = String(src.title ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);

  const teams = [];
  const seen = new Set();
  for (const t of Array.isArray(src.teams) ? src.teams : []) {
    const name = String(t?.name ?? '').trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!name) continue;
    let id = String(t?.id ?? '');
    if (!/^[a-z0-9]{4,20}$/.test(id) || seen.has(id)) id = randomBytes(5).toString('hex');
    seen.add(id);
    teams.push({ id, name });
    if (teams.length >= MAX_TEAMS) break;
  }

  const ids = new Set(teams.map((t) => t.id));
  const scores = {};
  const srcScores = src.scores && typeof src.scores === 'object' ? src.scores : {};
  for (let r = 1; r <= ROUNDS; r++) {
    const row = srcScores[r];
    if (!row || typeof row !== 'object') continue;
    const out = {};
    for (const [id, v] of Object.entries(row)) {
      if (!ids.has(id) || v === '' || v === null || v === undefined) continue;
      const n = Number(v);
      if (!Number.isFinite(n)) continue;
      const i = Math.round(n);
      if (i < -999 || i > 999) continue;
      out[id] = i;
    }
    if (Object.keys(out).length) scores[r] = out;
  }
  return { title, teams, scores };
}

export async function handleScoreboard({ route, method, password, body }, store, adminPassword) {
  if (method !== 'POST') return { status: 405, body: { error: 'method_not_allowed' } };
  const auth = checkPassword(password, adminPassword);
  if (auth === null) return { status: 503, body: { error: 'admin_not_configured' } };
  if (!auth) return { status: 401, body: { error: 'unauthorized' } };

  const load = async () => (await store.get('state', { type: 'json' })) || emptyState();

  if (route === 'get') return { status: 200, body: await load() };

  if (route === 'save') {
    const current = await load();
    if (Number(body?.baseRev) !== current.rev) return { status: 409, body: { error: 'stale', ...current } };
    const next = { ...sanitizeState(body?.state), rev: current.rev + 1 };
    await store.setJSON('state', next);
    return { status: 200, body: next };
  }

  if (route === 'clear') {
    const current = await load();
    const next = { ...emptyState(), rev: current.rev + 1 };
    await store.setJSON('state', next);
    return { status: 200, body: next };
  }

  return { status: 404, body: { error: 'not_found' } };
}
