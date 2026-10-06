import { getStore } from '@netlify/blobs';
import { createHash, timingSafeEqual } from 'node:crypto';
import { createLive } from '../lib/live-core.mjs';

export const config = { path: '/api/live/*' };

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

const digest = (s) => createHash('sha256').update(String(s)).digest();

// The host can use its own password or fall back to the scoreboard one
function isAdmin(req) {
  const expected = process.env.LIVE_ADMIN_PASSWORD || process.env.SCOREBOARD_ADMIN_PASSWORD;
  if (!expected) return null;
  const given = req.headers.get('x-admin-password') || '';
  return timingSafeEqual(digest(given), digest(expected));
}

const readBody = async (req) => {
  try { return (await req.json()) || {}; } catch { return null; }
};

export default async (req) => {
  const live = createLive(getStore({ name: 'offside-live', consistency: 'strong' }));
  const url = new URL(req.url);
  const route = url.pathname.replace(/^\/api\/live\/?/, '');

  if (route === 'state' && req.method === 'GET') {
    return json(200, await live.view(url.searchParams.get('pid') || ''));
  }

  if ((route === 'join' || route === 'answer') && req.method === 'POST') {
    const data = await readBody(req);
    if (!data) return json(400, { error: 'bad_request' });
    const { status, body } = await live[route](data);
    return json(status, body);
  }

  if (route.startsWith('admin/') && req.method === 'POST') {
    const auth = isAdmin(req);
    if (auth === null) return json(503, { error: 'admin_not_configured' });
    if (!auth) return json(401, { error: 'unauthorized' });

    const data = (await readBody(req)) || {};
    const action = route.slice('admin/'.length);
    if (action === 'status') return json(200, await live.hostStatus());
    if (action === 'new') return json(200, await live.newGame());
    if (action === 'close') return json(200, await live.close());
    if (action === 'next') return json(200, await live.next(data));
    if (action === 'reveal') return json(200, await live.reveal(data));
    if (action === 'announce') return json(200, await live.announce(data));
  }

  return json(404, { error: 'not_found' });
};
