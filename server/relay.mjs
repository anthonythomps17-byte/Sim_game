// The family relay: passes messages between the device that runs the world (the host) and the
// other devices in the same family game (guests). It keeps nothing: no accounts, no saves, no
// chat. A room exists only while its devices are connected, and the host device lets each new
// device in before it sees anything.
//
// Wire format (text frames):
//   host  → relay  "<to>\n<payload>"  where <to> is "*" (every guest), "ping", or guest ids
//   relay → host   {"sys":"join"|"leave","peer":id} or {"from":id,"d":<guest message>}
//   guest → relay  any JSON message (forwarded to the host)
//   relay → guest  the host's payload, or {"sys":"hostgone"|"hostback"}
import { WebSocketServer, WebSocket } from 'ws';

export const CLOSE = {
  bad: 4000, taken: 4001, replaced: 4002, hostGone: 4003, noRoom: 4004, full: 4008, slowDown: 4029,
};

const ROOM = /^[A-HJ-NP-Z2-9]{6}$/;
const PEER = /^[A-Za-z0-9_-]{8,40}$/;

export function createRelay(options = {}) {
  const limits = {
    maxRooms: 300,
    maxGuests: 8,
    hostGraceMs: 5 * 60_000,
    maxHostMessage: 4_000_000,
    maxGuestMessage: 64_000,
    failedJoinsPerMinute: 20,
    guestMessagesPerSecond: 40,
    ...options,
  };
  /** @type {Map<string, {host: {peer: string, ws: WebSocket} | null, guests: Map<string, WebSocket>, timer: any}>} */
  const rooms = new Map();
  /** Failed joins per address, to stop anyone guessing room codes. */
  const failures = new Map();
  const wss = new WebSocketServer({ noServer: true, maxPayload: limits.maxHostMessage, perMessageDeflate: { threshold: 1024 } });

  const send = (ws, text) => { if (ws && ws.readyState === WebSocket.OPEN) ws.send(text); };
  const blocked = (ip) => {
    const f = failures.get(ip);
    if (!f || f.until < Date.now()) return false;
    return f.n >= limits.failedJoinsPerMinute;
  };
  const failed = (ip) => {
    const now = Date.now();
    const f = failures.get(ip);
    if (!f || f.until < now) failures.set(ip, { n: 1, until: now + 60_000 });
    else f.n++;
    if (failures.size > 5000) for (const [k, v] of failures) if (v.until < now) failures.delete(k);
  };

  function dropRoom(code) {
    const room = rooms.get(code);
    if (!room) return;
    clearTimeout(room.timer);
    rooms.delete(code);
  }

  function attachHost(ws, code, peer) {
    let room = rooms.get(code);
    if (room?.host && room.host.peer !== peer && room.host.ws.readyState === WebSocket.OPEN) {
      ws.close(CLOSE.taken, 'Room code in use');
      return;
    }
    if (!room) {
      if (rooms.size >= limits.maxRooms) { ws.close(CLOSE.full, 'Too many games right now'); return; }
      room = { host: null, guests: new Map(), timer: null };
      rooms.set(code, room);
    }
    const old = room.host?.ws;
    room.host = { peer, ws };
    if (old && old !== ws) old.close(CLOSE.replaced, 'Replaced');
    clearTimeout(room.timer);
    room.timer = null;
    send(ws, JSON.stringify({ sys: 'hello', guests: [...room.guests.keys()] }));
    for (const g of room.guests.values()) send(g, '{"sys":"hostback"}');

    ws.on('message', (data, isBinary) => {
      if (isBinary) return;
      const text = data.toString();
      const nl = text.indexOf('\n');
      if (nl < 0) return;
      const to = text.slice(0, nl);
      if (to === 'ping') return;
      const payload = text.slice(nl + 1);
      if (to === '*') { for (const g of room.guests.values()) send(g, payload); return; }
      for (const id of to.split(',')) send(room.guests.get(id), payload);
    });
    ws.on('close', () => {
      if (room.host?.ws !== ws) return;
      room.host = null;
      if (!room.guests.size) { dropRoom(code); return; }
      for (const g of room.guests.values()) send(g, '{"sys":"hostgone"}');
      room.timer = setTimeout(() => {
        for (const g of room.guests.values()) g.close(CLOSE.hostGone, 'The host device left');
        dropRoom(code);
      }, limits.hostGraceMs);
    });
  }

  function attachGuest(ws, code, peer, ip) {
    const room = rooms.get(code);
    if (!room) { failed(ip); ws.close(CLOSE.noRoom, 'No game with that code'); return; }
    if (room.guests.size >= limits.maxGuests && !room.guests.has(peer)) { ws.close(CLOSE.full, 'That game is full'); return; }
    const old = room.guests.get(peer);
    room.guests.set(peer, ws);
    if (old && old !== ws) old.close(CLOSE.replaced, 'Replaced');
    if (room.host) send(room.host.ws, JSON.stringify({ sys: 'join', peer }));
    else send(ws, '{"sys":"hostgone"}');

    let tokens = limits.guestMessagesPerSecond;
    let refill = Date.now();
    ws.on('message', (data, isBinary) => {
      if (isBinary || data.length > limits.maxGuestMessage) return;
      const now = Date.now();
      tokens = Math.min(limits.guestMessagesPerSecond, tokens + ((now - refill) / 1000) * limits.guestMessagesPerSecond);
      refill = now;
      if (tokens < 1) return;
      tokens--;
      const text = data.toString();
      if (text === '{"t":"ping"}') return;
      try { JSON.parse(text); } catch { return; }
      if (room.host) send(room.host.ws, `{"from":${JSON.stringify(peer)},"d":${text}}`);
    });
    ws.on('close', () => {
      if (room.guests.get(peer) !== ws) return;
      room.guests.delete(peer);
      if (room.host) send(room.host.ws, JSON.stringify({ sys: 'leave', peer }));
      else if (!room.guests.size) dropRoom(code);
    });
  }

  return {
    rooms,
    /** Hand an HTTP upgrade request to the relay. */
    handleUpgrade(req, socket, head) {
      const url = new URL(req.url ?? '/', 'http://relay');
      const code = (url.searchParams.get('room') ?? '').toUpperCase();
      const peer = url.searchParams.get('peer') ?? '';
      const role = url.searchParams.get('role');
      const ip = String(req.headers['x-nf-client-connection-ip'] ?? req.headers['x-forwarded-for'] ?? socket.remoteAddress ?? '').split(',')[0].trim();
      wss.handleUpgrade(req, socket, head, (ws) => {
        ws.on('error', () => {});
        if (!ROOM.test(code) || !PEER.test(peer) || (role !== 'host' && role !== 'guest')) { ws.close(CLOSE.bad, 'Bad request'); return; }
        if (role === 'guest' && blocked(ip)) { ws.close(CLOSE.slowDown, 'Too many tries. Wait a minute.'); return; }
        if (role === 'host') attachHost(ws, code, peer);
        else attachGuest(ws, code, peer, ip);
      });
    },
    /** Close every connection (server restarting); devices reconnect on their own. */
    closeAll(code = 1012, reason = 'Server restarting') {
      for (const ws of wss.clients) ws.close(code, reason);
      for (const code of [...rooms.keys()]) dropRoom(code);
    },
    stats() {
      let guests = 0;
      for (const r of rooms.values()) guests += r.guests.size;
      return { rooms: rooms.size, guests };
    },
  };
}
