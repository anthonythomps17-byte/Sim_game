// Netlify Server entry: the family relay for playing on several devices. The game itself is
// static files; only /relay reaches this server.
import { createServer } from 'node:http';
import { onShutdown } from '@netlify/server';
import { createRelay } from '../../server/relay.mjs';

const relay = createRelay();

const server = createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' });
  res.end('My Life family relay. Open the game to play together.\n');
});
server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));

onShutdown(async ({ drained }) => {
  // Devices reconnect straight away when they see code 1012.
  relay.closeAll(1012, 'Server restarting');
  await drained;
});

export const config = { path: '/relay', region: 'fra' };

export default server;
