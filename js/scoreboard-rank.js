(function (root) {
  const ROUNDS = 7;

  function computeRows(state) {
    const teams = (state && state.teams) || [];
    const scores = (state && state.scores) || {};
    const roundsWithData = [];
    for (let r = 1; r <= ROUNDS; r++) {
      if (scores[r] && Object.keys(scores[r]).length) roundsWithData.push(r);
    }

    const rows = teams.map((t) => {
      const per = {};
      let total = 0;
      for (let r = 1; r <= ROUNDS; r++) {
        const v = scores[r] && scores[r][t.id];
        per[r] = v === undefined ? null : v;
        total += v || 0;
      }
      const sum3 = (per[1] || 0) + (per[2] || 0) + (per[3] || 0);
      const sum6 = sum3 + (per[4] || 0) + (per[5] || 0) + (per[6] || 0);
      return { id: t.id, team: t.name, per, sum3, sum6, total };
    });

    // tie on total: higher score in the latest round wins, then the one before it, ...
    rows.sort((a, b) => {
      if (b.total !== a.total) return b.total - a.total;
      for (let r = ROUNDS; r >= 1; r--) {
        const d = (b.per[r] || 0) - (a.per[r] || 0);
        if (d) return d;
      }
      return a.team.localeCompare(b.team, 'ru');
    });
    rows.forEach((row, i) => { row.place = i + 1; });

    return { rows, roundsWithData };
  }

  function columns(roundsWithData) {
    const has = new Set(roundsWithData);
    const cols = [];
    for (let r = 1; r <= ROUNDS; r++) {
      if (has.has(r)) cols.push({ kind: 'round', r, label: r + ' тур' });
      if (r === 3 && has.has(3) && roundsWithData.some((x) => x > 3)) {
        cols.push({ kind: 'sum3', label: 'После 3' });
      }
      if (r === 6 && has.has(6) && has.has(7)) {
        cols.push({ kind: 'sum6', label: 'После 6' });
      }
    }
    cols.push({ kind: 'total', label: 'Итого' });
    return cols;
  }

  const api = { ROUNDS, computeRows, columns };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Scoreboard = api;
})(typeof window !== 'undefined' ? window : globalThis);
