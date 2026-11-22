// Minimal DOM helpers. No framework: the HUD is small and updated a few times a second.
type Child = Node | string | number | null | undefined | false;
type Attrs = Record<string, unknown> & { class?: string; style?: string };

export function h<K extends keyof HTMLElementTagNameMap>(tag: K, attrs: Attrs | null = null, ...children: (Child | Child[])[]): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2).toLowerCase(), v as EventListener);
      else if (k === 'class') el.className = String(v);
      else if (k === 'style') el.setAttribute('style', String(v));
      else if (k in el && typeof v !== 'string') (el as unknown as Record<string, unknown>)[k] = v;
      else el.setAttribute(k, v === true ? '' : String(v));
    }
  }
  append(el, children);
  return el;
}

function append(el: HTMLElement, children: (Child | Child[])[]) {
  for (const c of children) {
    if (Array.isArray(c)) append(el, c);
    else if (c === null || c === undefined || c === false) continue;
    else el.append(c instanceof Node ? c : String(c));
  }
}

export function clear(el: HTMLElement) { while (el.firstChild) el.firstChild.remove(); }

export function money(n: number): string {
  return (n < 0 ? '-£' : '£') + Math.abs(Math.round(n)).toLocaleString('en-GB');
}

export function initials(name: string): string {
  return name.split(' ').map((p) => p[0]).join('').slice(0, 2).toUpperCase();
}

export function bar(value: number, color?: string): HTMLElement {
  const v = Math.max(0, Math.min(100, value));
  const c = color ?? needColor(v);
  return h('div', { class: 'bar' }, h('div', { class: 'bar-fill', style: `width:${v}%;background:${c}` }));
}

export function needColor(v: number): string {
  if (v >= 60) return 'var(--good)';
  if (v >= 35) return 'var(--ok)';
  if (v >= 15) return 'var(--warn)';
  return 'var(--bad)';
}

export function chip(text: string, cls = ''): HTMLElement { return h('span', { class: `chip ${cls}` }, text); }
