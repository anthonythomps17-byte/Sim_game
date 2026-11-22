// Radial action menu shown where the player tapped.
import { h } from './dom';

export interface RadialOption { icon: string; label: string; disabled?: boolean; why?: string; onPick: () => void }

export function showRadial(root: HTMLElement, x: number, y: number, title: string, options: RadialOption[], onClose?: () => void): () => void {
  const bg = h('div', { class: 'radial-bg' });
  const close = () => { bg.remove(); onClose?.(); };
  bg.addEventListener('pointerdown', (e) => { if (e.target === bg) close(); });
  const W = window.innerWidth, H = window.innerHeight;
  const many = options.length > 7;
  const radius = options.length <= 3 ? 95 : options.length <= 5 ? 115 : 135;
  const cx = Math.max(150, Math.min(W - 150, x));
  const cy = many ? Math.max(90, Math.min(H - options.length * 27 - 60, y - (options.length * 27) / 2)) : Math.max(radius + 40, Math.min(H - radius - 40, y));
  const wrap = h('div', { class: 'radial', style: `left:${cx}px;top:${cy}px` });
  wrap.append(h('div', { class: 'title', style: many ? 'top:-34px' : '' }, title));
  options.forEach((opt, i) => {
    let ox: number, oy: number;
    if (many) {
      const col = i % 2, row = Math.floor(i / 2);
      ox = col === 0 ? -95 : 95;
      oy = 26 + row * 56;
    } else {
      const a = -Math.PI / 2 + (i / options.length) * Math.PI * 2;
      ox = Math.cos(a) * radius * 1.15;
      oy = Math.sin(a) * radius;
      if (options.length === 1) { ox = 0; oy = 56; }
    }
    const b = h('button', {
      class: `ropt ${opt.disabled ? 'dis' : ''}`,
      style: `left:${ox}px;top:${oy}px;animation-delay:${i * 18}ms`,
      onclick: () => { if (opt.disabled) return; close(); opt.onPick(); },
    }, h('span', { class: 'ic' }, opt.icon), h('span', null, opt.label, opt.why ? h('span', { class: 'why' }, opt.why) : null));
    wrap.append(b);
  });
  bg.append(wrap);
  root.append(bg);
  return close;
}
