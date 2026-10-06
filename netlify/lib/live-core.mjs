import { randomBytes } from 'node:crypto';
import { PRIZES, ROUNDS } from './live-questions.mjs';
import { hasBannedWord } from './live-banned.mjs';

export const QUESTION_MS = 10000;
// Phones see a question up to one poll later than the big screen and count their own 10 s,
// so late answers are accepted for a little while after the host's timer ends.
const GRACE_MS = 4000;
const PID_RE = /^[A-Za-z0-9-]{8,64}$/;

const shuffle = (arr, random) => {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
};

// More correct answers wins; on a tie, less total time wins
const rank = (scores) =>
  Object.entries(scores)
    .map(([pid, s]) => ({ pid, ...s }))
    .sort((a, b) => b.correct - a.correct || a.time - b.time || a.joinedAt - b.joinedAt);

export function createLive(store, { now = Date.now, random = Math.random, rounds = ROUNDS, prizes = PRIZES } = {}) {
  const readState = async () => (await store.get('state', { type: 'json' })) || { phase: 'off' };
  const writeState = (state) => store.setJSON('state', state);
  const readScores = async (session) => (await store.get(`s/${session}/scores`, { type: 'json' })) || {};

  const listJson = async (prefix) => {
    const { blobs } = await store.list({ prefix });
    const rows = await Promise.all(blobs.map(async (b) => [b.key.slice(prefix.length), await store.get(b.key, { type: 'json' })]));
    return Object.fromEntries(rows.filter(([, v]) => v));
  };

  // Each game gets its own question order and option order
  const makePlan = () =>
    rounds.map((r) => shuffle(r.questions.map((_, i) => i), random).map((qi) => ({ qi, order: shuffle([0, 1, 2, 3], random) })));

  const current = (state) => {
    const round = rounds[state.round];
    const slot = state.plan[state.round][state.q];
    const src = round.questions[slot.qi];
    const all = [src.a, ...src.w];
    const opts = slot.order.map((i) => all[i]);
    return { round, src, opts, correct: slot.order.indexOf(0), key: `${state.round}-${state.q}` };
  };

  // Text questions have no picture
  const mediaOf = (q) => q.media || null;

  const roundInfo = (state) => {
    const r = rounds[state.round];
    return { index: state.round, count: rounds.length, title: r.title, rule: r.rule, kind: r.kind, id: r.id };
  };

  // ---------- players ----------

  async function view(pid) {
    const state = await readState();
    const base = { phase: state.phase, session: state.session || null, prizes };
    if (state.phase === 'off' || state.phase === 'lobby') return base;
    if (state.phase === 'final') {
      const board = rank(await readScores(state.session));
      const me = board.findIndex((r) => r.pid === pid);
      // Top-3 players learn their place only when the host announces it on the big screen
      const hidden = me >= 0 && me + 1 <= 3 && me + 1 < (state.podium ?? 1);
      return {
        ...base,
        total: rounds.reduce((s, r) => s + r.questions.length, 0),
        me: me < 0 ? null : hidden ? { pending: true } : { place: me + 1, correct: board[me].correct, time: board[me].time },
        players: board.length,
      };
    }
    const out = { ...base, round: roundInfo(state) };
    if (state.phase === 'intro') return out;

    const { round, opts, correct, key } = current(state);
    out.question = { key, num: state.q + 1, of: round.questions.length, prompt: current(state).src.prompt || round.prompt, opts };
    if (state.phase === 'question') {
      const mine = PID_RE.test(pid || '') ? await store.get(`s/${state.session}/a/${key}/${pid}`, { type: 'json' }) : null;
      out.answered = mine ? mine.opt : null;
      return out;
    }
    // reveal
    const scores = await readScores(state.session);
    const board = rank(scores);
    const place = board.findIndex((r) => r.pid === pid);
    const last = scores[pid]?.last;
    out.reveal = { correct, info: current(state).src.info, a: opts[correct] };
    out.me = place < 0 ? null : {
      place: place + 1,
      correct: board[place].correct,
      picked: last && last.key === key ? last.opt : null,
      ms: last && last.key === key ? last.ms : null,
    };
    out.players = board.length;
    return out;
  }

  async function join({ pid, name, team, session }) {
    const state = await readState();
    if (state.phase === 'off' || !state.session) return { status: 409, body: { error: 'no_game' } };
    if (session && session !== state.session) return { status: 409, body: { error: 'stale_session' } };
    const cleanName = String(name || '').trim().slice(0, 24);
    const cleanTeam = String(team || '').trim().slice(0, 32);
    if (!PID_RE.test(String(pid || ''))) return { status: 400, body: { error: 'invalid_player' } };
    if (!cleanName) return { status: 400, body: { error: 'invalid_name' } };
    if (!cleanTeam) return { status: 400, body: { error: 'invalid_team' } };
    if (hasBannedWord(cleanName)) return { status: 400, body: { error: 'banned_name' } };
    if (hasBannedWord(cleanTeam)) return { status: 400, body: { error: 'banned_team' } };
    const key = `s/${state.session}/p/${pid}`;
    const prev = await store.get(key, { type: 'json' });
    await store.setJSON(key, { name: cleanName, team: cleanTeam, joinedAt: prev?.joinedAt ?? now() });
    return { status: 200, body: { ok: true, session: state.session } };
  }

  async function answer({ pid, key, opt, ms }) {
    const state = await readState();
    if (state.phase !== 'question') return { status: 409, body: { error: 'closed' } };
    if (!PID_RE.test(String(pid || ''))) return { status: 400, body: { error: 'invalid_player' } };
    const cur = current(state);
    if (key !== cur.key) return { status: 409, body: { error: 'wrong_question' } };
    if (now() > state.startedAt + QUESTION_MS + GRACE_MS) return { status: 409, body: { error: 'closed' } };
    const o = Number(opt);
    if (!Number.isInteger(o) || o < 0 || o > 3) return { status: 400, body: { error: 'invalid_option' } };
    if (!(await store.get(`s/${state.session}/p/${pid}`, { type: 'json' }))) return { status: 403, body: { error: 'not_joined' } };
    // Time is measured on the phone from the moment the question appeared there
    const t = Math.min(Math.max(Math.round(Number(ms) || 0), 0), QUESTION_MS);
    const res = await store.setJSON(`s/${state.session}/a/${cur.key}/${pid}`, { opt: o, ms: t }, { onlyIfNew: true });
    return { status: 200, body: { ok: true, accepted: res?.modified !== false } };
  }

  // ---------- host ----------

  async function hostStatus() {
    const state = await readState();
    if (state.phase === 'off') return { phase: 'off', prizes };
    const players = await listJson(`s/${state.session}/p/`);
    const scores = await readScores(state.session);
    const out = {
      phase: state.phase,
      prizes,
      step: stepOf(state),
      session: state.session,
      players: Object.values(players).sort((a, b) => a.joinedAt - b.joinedAt).map(({ name, team }) => ({ name, team })),
      board: rank(scores).map(({ name, team, correct, time }) => ({ name, team, correct, time })),
      total: rounds.reduce((s, r) => s + r.questions.length, 0),
    };
    if (state.phase === 'final') out.podium = state.podium ?? 1;
    if (state.phase === 'lobby' || state.phase === 'final') return out;
    out.round = roundInfo(state);
    // What comes next, so the host screen can preload it
    if (state.phase === 'intro' || state.phase === 'reveal') {
      const nx = nextSlot(state);
      if (nx) out.upcoming = mediaOf(rounds[nx.round].questions[state.plan[nx.round][nx.q].qi]);
    }
    if (state.phase === 'intro') return out;
    const { round, src, opts, correct, key } = current(state);
    out.question = { key, num: state.q + 1, of: round.questions.length, prompt: round.prompt, opts, media: mediaOf(src), big: src.big, sub: src.sub, kind: round.kind, startedAt: state.startedAt };
    if (state.phase === 'question') {
      const { blobs } = await store.list({ prefix: `s/${state.session}/a/${key}/` });
      out.answered = blobs.length;
    } else {
      out.reveal = { correct, a: src.a, info: src.info, ...state.stats };
    }
    out.now = now();
    return out;
  }

  const nextSlot = (state) => {
    if (state.phase === 'intro') return { round: state.round, q: 0 };
    if (state.q + 1 < rounds[state.round].questions.length) return { round: state.round, q: state.q + 1 };
    if (state.round + 1 < rounds.length) return { round: state.round + 1, q: 0 };
    return null;
  };

  async function purgeSession(session) {
    if (!session) return;
    const { blobs } = await store.list({ prefix: `s/${session}/` });
    for (let i = 0; i < blobs.length; i += 50) {
      await Promise.all(blobs.slice(i, i + 50).map((b) => store.delete(b.key)));
    }
  }

  async function newGame() {
    const prev = await readState();
    const state = { phase: 'lobby', session: randomBytes(6).toString('hex'), plan: makePlan(), round: 0, q: 0, revealed: 0 };
    await writeState(state);
    await purgeSession(prev.session);
    return hostStatus();
  }

  // Closed between quiz nights: players see a "closed" screen and can't join
  async function close() {
    const prev = await readState();
    await writeState({ phase: 'off' });
    await purgeSession(prev.session);
    return hostStatus();
  }

  async function reveal({ step } = {}) {
    const state = await readState();
    if (state.phase !== 'question' || (step && step !== stepOf(state))) return hostStatus();
    const { key, correct } = current(state);
    const [players, answers, scores] = await Promise.all([
      listJson(`s/${state.session}/p/`),
      listJson(`s/${state.session}/a/${key}/`),
      readScores(state.session),
    ]);
    const counts = [0, 0, 0, 0];
    let right = 0;
    for (const [pid, p] of Object.entries(players)) {
      // Late joiners start with the full time for every question they missed
      const s = scores[pid] || { correct: 0, time: state.revealed * QUESTION_MS, joinedAt: p.joinedAt };
      const a = answers[pid];
      const ok = a ? a.opt === correct : false;
      if (a) counts[a.opt] += 1;
      if (ok) right += 1;
      s.name = p.name;
      s.team = p.team;
      s.correct += ok ? 1 : 0;
      s.time += a ? a.ms : QUESTION_MS;
      s.last = a ? { key, opt: a.opt, ms: a.ms } : { key, opt: null, ms: null };
      scores[pid] = s;
    }
    await store.setJSON(`s/${state.session}/scores`, scores);
    await writeState({ ...state, phase: 'reveal', revealed: state.revealed + 1, stats: { counts, right, answered: Object.keys(answers).length } });
    return hostStatus();
  }

  // `step` is what the host screen was showing, so a double tap can't skip a question
  const stepOf = (state) => `${state.phase}:${state.round}-${state.q}` + (state.phase === 'final' ? `:${state.podium ?? 1}` : '');

  async function next({ step } = {}) {
    const state = await readState();
    if (state.phase === 'off') return newGame();
    if (step && step !== stepOf(state)) return hostStatus();
    if (state.phase === 'lobby') {
      await writeState({ ...state, phase: 'intro', round: 0, q: 0 });
    } else if (state.phase === 'intro') {
      await writeState({ ...state, phase: 'question', q: 0, startedAt: now() });
    } else if (state.phase === 'question') {
      return reveal({ step });
    } else if (state.phase === 'reveal') {
      const nx = nextSlot(state);
      if (!nx) {
        // `podium` is the best place announced so far: 4 = none yet, then 3, 2, 1
        const scored = Object.keys(await readScores(state.session)).length;
        await writeState({ ...state, phase: 'final', stats: null, podium: Math.min(3, scored) + 1 });
      }
      else if (nx.round !== state.round) await writeState({ ...state, phase: 'intro', round: nx.round, q: 0, stats: null });
      else await writeState({ ...state, phase: 'question', q: nx.q, startedAt: now(), stats: null });
    }
    return hostStatus();
  }

  // Announce the next place on the podium (3rd, then 2nd, then 1st)
  async function announce({ step } = {}) {
    const state = await readState();
    if (state.phase !== 'final' || (step && step !== stepOf(state))) return hostStatus();
    if ((state.podium ?? 1) > 1) await writeState({ ...state, podium: state.podium - 1 });
    return hostStatus();
  }

  return { view, join, answer, hostStatus, newGame, close, next, reveal, announce };
}
