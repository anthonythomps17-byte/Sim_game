// Keeping other devices' copy of the world up to date. The host keeps a "mirror" (what every
// guest has) and sends only what changed since the last update, as a list of small operations.
// Numbers are rounded to 2 decimal places on the way out, so tiny need changes don't cost data.

export type Path = (string | number)[];
/** [path, value] sets a value; [path] deletes a key. */
export type Op = [Path] | [Path, unknown];

const round = (v: unknown): unknown => {
  if (typeof v === 'number') return Number.isInteger(v) ? v : Math.round(v * 100) / 100;
  if (Array.isArray(v)) return v.map(round);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v)) if (x !== undefined) o[k] = round(x);
    return o;
  }
  return v;
};

/** A rounded, plain-JSON deep copy. */
export function snapshot<T>(v: T): T {
  return round(v) as T;
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/** Operations that turn `a` (the mirror) into `b` (the live state), comparing rounded values. */
export function diff(a: unknown, b: unknown, path: Path = [], out: Op[] = []): Op[] {
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) { out.push([path, round(b)]); return out; }
    for (let i = 0; i < b.length; i++) diff(a[i], b[i], [...path, i], out);
    return out;
  }
  if (isObj(a) && isObj(b)) {
    for (const k of Object.keys(b)) {
      const bv = b[k];
      if (bv === undefined) { if (k in a) out.push([[...path, k]]); continue; }
      if (!(k in a)) { out.push([[...path, k], round(bv)]); continue; }
      diff(a[k], bv, [...path, k], out);
    }
    for (const k of Object.keys(a)) if (!(k in b)) out.push([[...path, k]]);
    return out;
  }
  const rb = typeof b === 'number' && !Number.isInteger(b) ? Math.round(b * 100) / 100 : b;
  if (a !== rb) {
    if (typeof rb === 'object' && rb !== null) out.push([path, round(rb)]);
    else out.push([path, rb === undefined ? null : rb]);
  }
  return out;
}

/** Apply operations in place. Returns the (possibly replaced) root. */
export function apply<T>(root: T, ops: Op[]): T {
  let r: unknown = root;
  for (const op of ops) {
    const [path] = op;
    if (path.length === 0) { r = op.length > 1 ? structuredClone(op[1]) : null; continue; }
    let o = r as Record<string | number, unknown>;
    for (let i = 0; i < path.length - 1; i++) {
      const next = o[path[i]];
      if (!next || typeof next !== 'object') { o[path[i]] = typeof path[i + 1] === 'number' ? [] : {}; }
      o = o[path[i]] as Record<string | number, unknown>;
    }
    const key = path[path.length - 1];
    if (op.length > 1) o[key] = structuredClone(op[1]);
    else delete o[key];
  }
  return r as T;
}
