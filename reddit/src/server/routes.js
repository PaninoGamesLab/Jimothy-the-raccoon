// Minimal HTTP routing over Node's request/response objects (no framework).
import { once } from 'node:events';
import { ApiError } from './leaderboard.js';

const MAX_BODY = 64 * 1024;

async function readJson(req) {
  const chunks = [];
  let size = 0;
  req.on('data', (chunk) => {
    size += chunk.length;
    if (size <= MAX_BODY) chunks.push(chunk);
  });
  await once(req, 'end');
  if (size > MAX_BODY) throw new ApiError(413, 'body too large');
  if (!chunks.length) return {};
  try {
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } catch (_) {
    throw new ApiError(400, 'invalid JSON body');
  }
}

export function writeJson(res, status, value) {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

/**
 * Builds the request handler. Routes:
 *   GET  /api/init                  -> player + leaderboard
 *   POST /api/score                 -> submit a run
 *   POST /internal/menu/new-post    -> moderator menu action
 *   POST /internal/on/app/install   -> install trigger
 */
export function createRouter(api) {
  const routes = {
    'GET /api/init': () => api.init(),
    'POST /api/score': async (req) => api.submitScore(await readJson(req)),
    'POST /internal/menu/new-post': () => api.newPost(),
    'POST /internal/on/app/install': () => api.appInstall(),
  };

  return async function onRequest(req, res) {
    const path = (req.url || '/').split('?')[0];
    const handler = routes[`${req.method} ${path}`];
    if (!handler) {
      writeJson(res, 404, { error: 'not found', status: 404 });
      return;
    }
    try {
      writeJson(res, 200, await handler(req));
    } catch (err) {
      const status = err instanceof ApiError ? err.status : 500;
      if (status === 500) console.error(`server error; ${err && err.stack ? err.stack : err}`);
      writeJson(res, status, { error: status === 500 ? 'server error' : err.message, status });
    }
  };
}
