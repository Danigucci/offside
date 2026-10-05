import { getStore } from '@netlify/blobs';
import { handleScoreboard } from '../lib/scoreboard-core.mjs';

export const config = { path: '/api/scoreboard/*' };

export default async (req) => {
  const route = new URL(req.url).pathname.replace(/^\/api\/scoreboard\/?/, '');
  let body = {};
  if (req.method === 'POST') {
    try { body = await req.json(); } catch { body = {}; }
  }
  const { status, body: out } = await handleScoreboard(
    { route, method: req.method, password: req.headers.get('x-admin-password') || '', body },
    getStore({ name: 'offside-scoreboard', consistency: 'strong' }),
    process.env.SCOREBOARD_ADMIN_PASSWORD
  );
  return new Response(JSON.stringify(out), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });
};
