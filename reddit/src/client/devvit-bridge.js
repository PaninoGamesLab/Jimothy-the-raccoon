/*
 * Backend bridge for the Reddit build. Loaded before game.js inside the
 * expanded game view; the game uses window.JimothyBackend when it exists and
 * falls back to localStorage otherwise (the GitHub Pages build never has it).
 */
(() => {
  'use strict';

  const json = async (url, init) => {
    const res = await fetch(url, Object.assign({ credentials: 'same-origin' }, init));
    if (!res.ok) throw new Error(`${url} -> ${res.status}`);
    return res.json();
  };

  window.JimothyBackend = {
    name: 'reddit',
    /** -> { username, best, me, top } */
    load: () => json('/api/init'),
    /** -> same shape, plus `improved` */
    submit: (score, items) =>
      json('/api/score', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ score, items }),
      }),
  };
})();
