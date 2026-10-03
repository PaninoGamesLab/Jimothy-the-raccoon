import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { createApi, LEADERBOARD_KEY } from './leaderboard.js';
import { createRouter } from './routes.js';

/** In-memory stand-in for the slice of Devvit's Redis client the API uses. */
function fakeRedis() {
  const sets = new Map();
  const set = (key) => sets.get(key) || sets.set(key, new Map()).get(key);
  const sorted = (key) => [...set(key).entries()].map(([member, score]) => ({ member, score })).sort((a, b) => a.score - b.score || a.member.localeCompare(b.member));
  return {
    calls: [],
    async zAdd(key, ...members) {
      for (const m of members) set(key).set(m.member, m.score);
      return members.length;
    },
    async zScore(key, member) {
      const v = set(key).get(member);
      return v === undefined ? null : v;
    },
    async zCard(key) {
      return set(key).size;
    },
    async zRank(key, member) {
      const i = sorted(key).findIndex((e) => e.member === member);
      return i < 0 ? null : i;
    },
    async zRange(key, start, stop, opts) {
      this.calls.push(opts);
      let arr = sorted(key);
      if (opts && opts.reverse) arr = arr.reverse();
      const end = stop < 0 ? arr.length + stop + 1 : stop + 1;
      return arr.slice(start, end);
    },
  };
}

function makeApi({ username = 'jimothy_fan', redis = fakeRedis() } = {}) {
  const posts = [];
  const reddit = {
    async getCurrentUsername() {
      return username;
    },
    async submitCustomPost(opts) {
      posts.push(opts);
      return { id: 't3_abc', url: 'https://www.reddit.com/r/test/comments/abc' };
    },
  };
  const api = createApi({ context: { subredditName: 'test' }, reddit, redis });
  return { api, redis, posts };
}

test('init for a new player returns an empty board and no personal entry', async () => {
  const { api } = makeApi();
  const r = await api.init();
  assert.equal(r.username, 'jimothy_fan');
  assert.equal(r.best, 0);
  assert.equal(r.me, null);
  assert.deepEqual(r.top, []);
});

test('submitting keeps only the best score and reports rank', async () => {
  const { api, redis } = makeApi();
  await redis.zAdd(LEADERBOARD_KEY, { member: 'alice', score: 500 }, { member: 'bob', score: 300 });
  let r = await api.submitScore({ score: 400, items: 3 });
  assert.equal(r.improved, true);
  assert.equal(r.best, 400);
  assert.equal(r.me.rank, 2);
  assert.deepEqual(r.top.map((e) => e.username), ['alice', 'jimothy_fan', 'bob']);
  r = await api.submitScore({ score: 150, items: 0 });
  assert.equal(r.improved, false);
  assert.equal(r.best, 400, 'a worse run must not lower the best');
  r = await api.submitScore({ score: 900 });
  assert.equal(r.me.rank, 1);
  assert.equal(r.top[0].username, 'jimothy_fan');
});

test('top list is capped at ten and ordered high to low even if redis returns ascending', async () => {
  const redis = fakeRedis();
  redis.zRange = async function (key, start, stop) {
    // Simulate a client that ignores the reverse option
    const all = [...(this.sets || [])];
    return all;
  };
  const { api } = makeApi({ redis });
  const members = Array.from({ length: 14 }, (_, i) => ({ member: `u${i}`, score: i * 10 }));
  await redis.zAdd(LEADERBOARD_KEY, ...members);
  redis.sets = members;
  const r = await api.init();
  assert.equal(r.top.length, 10);
  assert.equal(r.top[0].username, 'u13');
  assert.equal(r.top[9].username, 'u4');
});

test('rejects bad scores and logged-out players', async () => {
  const { api } = makeApi();
  for (const body of [{}, { score: -1 }, { score: 1.5 }, { score: 2_000_000 }, { score: 'x' }, { score: 50, items: 6 }]) {
    await assert.rejects(api.submitScore(body), (e) => e.status === 400, JSON.stringify(body));
  }
  const anon = makeApi({ username: null });
  await assert.rejects(anon.api.submitScore({ score: 10 }), (e) => e.status === 401);
  const r = await anon.api.init();
  assert.equal(r.username, null);
});

test('router maps paths, parses JSON and turns errors into statuses', async () => {
  const { api } = makeApi();
  const onRequest = createRouter(api);
  const call = async (method, url, body) => {
    const req = new EventEmitter();
    req.method = method;
    req.url = url;
    const res = { writeHead(status, headers) { this.status = status; this.headers = headers; }, end(b) { this.body = JSON.parse(b); } };
    const p = onRequest(req, res);
    if (body !== undefined) req.emit('data', Buffer.from(body));
    req.emit('end');
    await p;
    return res;
  };
  let res = await call('GET', '/api/init?x=1');
  assert.equal(res.status, 200);
  assert.equal(res.body.username, 'jimothy_fan');
  res = await call('POST', '/api/score', JSON.stringify({ score: 120, items: 2 }));
  assert.equal(res.status, 200);
  assert.equal(res.body.best, 120);
  res = await call('POST', '/api/score', '{not json');
  assert.equal(res.status, 400);
  res = await call('POST', '/api/score', JSON.stringify({ score: -5 }));
  assert.equal(res.status, 400);
  res = await call('GET', '/api/score');
  assert.equal(res.status, 404);
  res = await call('POST', '/internal/menu/new-post');
  assert.equal(res.status, 200);
  assert.match(res.body.navigateTo, /reddit\.com/);
  res = await call('POST', '/internal/on/app/install');
  assert.equal(res.status, 200);
  assert.equal(res.headers['Cache-Control'], 'no-store');
});
