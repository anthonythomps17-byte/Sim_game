// The family relay, run for real on a local port with real WebSocket clients.
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:http';
import { WebSocket } from 'ws';
// @ts-expect-error plain JS module
import { createRelay, CLOSE } from '../server/relay.mjs';

let server: Server;
let port = 0;
const relay = createRelay({ hostGraceMs: 300, failedJoinsPerMinute: 3 });

beforeAll(async () => {
  server = createServer();
  server.on('upgrade', (req, socket, head) => relay.handleUpgrade(req, socket, head));
  await new Promise<void>((r) => server.listen(0, () => r()));
  port = (server.address() as { port: number }).port;
});
afterAll(() => { relay.closeAll(); server.close(); });

interface Client { ws: WebSocket; msgs: string[]; closed: Promise<number>; next: () => Promise<string> }
function connect(room: string, role: string, peer: string): Promise<Client> {
  const ws = new WebSocket(`ws://localhost:${port}/relay?room=${room}&role=${role}&peer=${peer}`);
  const msgs: string[] = [];
  const waiters: ((m: string) => void)[] = [];
  ws.on('message', (d) => { const m = d.toString(); const w = waiters.shift(); if (w) w(m); else msgs.push(m); });
  const closed = new Promise<number>((r) => ws.on('close', (code) => r(code)));
  const next = () => (msgs.length ? Promise.resolve(msgs.shift()!) : new Promise<string>((r) => waiters.push(r)));
  return new Promise((resolve) => {
    ws.on('open', () => resolve({ ws, msgs, closed, next }));
    ws.on('close', () => resolve({ ws, msgs, closed, next }));
  });
}

describe('family relay', () => {
  it('passes messages between the host and its guests only', async () => {
    const host = await connect('ABC234', 'host', 'hostdevice1');
    expect(JSON.parse(await host.next())).toEqual({ sys: 'hello', guests: [] });
    const guest = await connect('ABC234', 'guest', 'guestdevice1');
    expect(JSON.parse(await host.next())).toEqual({ sys: 'join', peer: 'guestdevice1' });
    guest.ws.send(JSON.stringify({ t: 'hello', name: 'Phone' }));
    expect(JSON.parse(await host.next())).toEqual({ from: 'guestdevice1', d: { t: 'hello', name: 'Phone' } });
    host.ws.send('guestdevice1\n{"t":"full"}');
    expect(await guest.next()).toBe('{"t":"full"}');
    // Another game can't see this one.
    const other = await connect('ZZZ999', 'host', 'hostdevice2');
    await other.next();
    host.ws.send('*\n{"t":"diff"}');
    expect(await guest.next()).toBe('{"t":"diff"}');
    expect(other.msgs).toEqual([]);
    // Junk from a guest isn't passed on.
    guest.ws.send('not json');
    guest.ws.send('{"t":"ok"}');
    expect(JSON.parse(await host.next()).d).toEqual({ t: 'ok' });
    for (const c of [host, guest, other]) c.ws.close();
  });

  it('a second host cannot take over a code that is in use', async () => {
    const host = await connect('HHH222', 'host', 'hostdevice3');
    await host.next();
    expect(await (await connect('HHH222', 'host', 'intruder01')).closed).toBe(CLOSE.taken);
    host.ws.close();
  });

  it('guests wait for a host that drops out, then are told it has gone', async () => {
    const host = await connect('GGG222', 'host', 'hostdevice4');
    await host.next();
    const guest = await connect('GGG222', 'guest', 'guestdevice4');
    await host.next();
    host.ws.close();
    expect(JSON.parse(await guest.next())).toEqual({ sys: 'hostgone' });
    const back = await connect('GGG222', 'host', 'hostdevice4');
    expect(JSON.parse(await back.next())).toEqual({ sys: 'hello', guests: ['guestdevice4'] });
    expect(JSON.parse(await guest.next())).toEqual({ sys: 'hostback' });
    back.ws.close();
    await guest.next();
    expect(await guest.closed).toBe(CLOSE.hostGone);
    expect(relay.stats().rooms).toBe(0);
  });
  // Last, because it uses up this address's tries.
  it('turns away bad requests, unknown codes, and anyone guessing codes', async () => {
    expect(await (await connect('abc', 'guest', 'guestdevice2')).closed).toBe(CLOSE.bad);
    expect(await (await connect('QQQ222', 'guest', 'guestdevice2')).closed).toBe(CLOSE.noRoom);
    await (await connect('QQQ223', 'guest', 'guestdevice2')).closed;
    await (await connect('QQQ224', 'guest', 'guestdevice2')).closed;
    expect(await (await connect('QQQ225', 'guest', 'guestdevice2')).closed).toBe(CLOSE.slowDown);
  });
});
