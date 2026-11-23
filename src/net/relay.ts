// A connection to the family relay that reconnects by itself. Netlify closes long connections
// (and restarts the relay now and then), so a dropped connection is normal and quietly retried.

export type Role = 'host' | 'guest';
export type LinkState = 'connecting' | 'open' | 'retrying' | 'closed';

/** Close codes from server/relay.mjs. */
export const CLOSE = { bad: 4000, taken: 4001, replaced: 4002, hostGone: 4003, noRoom: 4004, full: 4008, slowDown: 4029 } as const;

const FATAL: Record<number, string> = {
  [CLOSE.bad]: 'Something went wrong connecting.',
  [CLOSE.taken]: 'That game code is already being used.',
  [CLOSE.replaced]: 'This game was opened somewhere else.',
  [CLOSE.hostGone]: 'The host device stopped the game.',
  [CLOSE.full]: 'That game is full.',
  [CLOSE.slowDown]: 'Too many tries. Wait a minute and try again.',
};

export interface LinkOptions {
  room: string;
  role: Role;
  peer: string;
  onMessage: (text: string) => void;
  onState: (state: LinkState, why?: string) => void;
  /** For guests: how long to keep retrying a code with no game behind it. */
  noRoomRetryMs?: number;
  url?: string;
}

export function relayUrl(): string {
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${proto}//${location.host}/relay`;
}

/** A random id for this device, kept so the host recognises it next time. */
export function deviceId(): string {
  const key = 'mylife-device-id';
  try {
    const have = localStorage.getItem(key);
    if (have && /^[A-Za-z0-9_-]{8,40}$/.test(have)) return have;
  } catch { /* private mode */ }
  const id = randomCode(16, 'abcdefghijkmnpqrstuvwxyz23456789');
  try { localStorage.setItem(key, id); } catch { /* ignore */ }
  return id;
}

/** Codes avoid letters and numbers that look alike (0/O, 1/I/L). */
export const CODE_LETTERS = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';

export function randomCode(n = 6, alphabet = CODE_LETTERS): string {
  const bytes = new Uint8Array(n);
  crypto.getRandomValues(bytes);
  return [...bytes].map((b) => alphabet[b % alphabet.length]).join('');
}

export function cleanCode(text: string): string {
  return text.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

export class RelayLink {
  private ws: WebSocket | null = null;
  private stopped = false;
  private tries = 0;
  private timer = 0;
  private ping = 0;
  private firstOpen = 0;
  private noRoomSince = 0;
  state: LinkState = 'connecting';

  constructor(public opts: LinkOptions) {
    this.connect();
  }

  private set(state: LinkState, why?: string) {
    this.state = state;
    this.opts.onState(state, why);
  }

  private connect() {
    if (this.stopped) return;
    const { room, role, peer } = this.opts;
    const url = `${this.opts.url ?? relayUrl()}?room=${encodeURIComponent(room)}&role=${role}&peer=${encodeURIComponent(peer)}`;
    let ws: WebSocket;
    try { ws = new WebSocket(url); } catch { this.retry(); return; }
    this.ws = ws;
    ws.onopen = () => {
      this.tries = 0;
      this.firstOpen ||= Date.now();
      this.set('open');
      clearInterval(this.ping);
      // A little traffic every 20s stops idle connections being dropped along the way.
      this.ping = window.setInterval(() => this.sendRaw(role === 'host' ? 'ping\n' : '{"t":"ping"}'), 20_000);
    };
    ws.onmessage = (e) => { if (typeof e.data === 'string') this.opts.onMessage(e.data); };
    ws.onclose = (e) => {
      clearInterval(this.ping);
      if (this.ws !== ws) return;
      this.ws = null;
      if (this.stopped) return;
      if (e.code === CLOSE.noRoom) {
        // The host may be reconnecting at the same moment; give it a little while.
        this.noRoomSince ||= Date.now();
        if (Date.now() - this.noRoomSince > (this.opts.noRoomRetryMs ?? 0)) { this.stop(); this.set('closed', 'No game with that code is running. Check the code, and that the host device has the game open.'); return; }
      } else this.noRoomSince = 0;
      if (FATAL[e.code]) { this.stop(); this.set('closed', FATAL[e.code]); return; }
      this.retry(e.code === 1012 ? 0 : undefined);
    };
  }

  private retry(delay?: number) {
    if (this.stopped) return;
    this.set('retrying');
    const wait = delay ?? Math.min(10_000, 500 * 2 ** this.tries++);
    clearTimeout(this.timer);
    this.timer = window.setTimeout(() => this.connect(), wait + Math.random() * 300);
  }

  private sendRaw(text: string): boolean {
    if (this.ws?.readyState !== WebSocket.OPEN) return false;
    this.ws.send(text);
    return true;
  }

  /** Host: send to every guest ("*") or to some. Guest: send to the host. */
  send(payload: string, to: string | string[] = '*'): boolean {
    if (this.opts.role === 'host') return this.sendRaw(`${Array.isArray(to) ? to.join(',') : to}\n${payload}`);
    return this.sendRaw(payload);
  }

  get open(): boolean { return this.ws?.readyState === WebSocket.OPEN; }

  stop() {
    this.stopped = true;
    clearTimeout(this.timer);
    clearInterval(this.ping);
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= WebSocket.OPEN) ws.close(1000, 'Bye');
  }
}
