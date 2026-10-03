// Devvit Web server entry: wires the real Reddit runtime into the request handler.
import { context, createServer, getServerPort, reddit, redis } from '@devvit/web/server';
import { createApi } from './leaderboard.js';
import { createRouter } from './routes.js';

const api = createApi({ context, reddit, redis });
const onRequest = createRouter(api);

const server = createServer(onRequest);
server.on('error', (err) => console.error(`server error; ${err.stack}`));
server.listen(getServerPort(), () => console.log(`Jimothy server listening on ${getServerPort()}`));
