// A short first-play walkthrough. Tips can be replayed from the menu.
import type { App } from './app';
import { h } from './dom';

const STEPS = [
  { icon: '👋', text: 'Welcome to Ashton! These are your Sims. Tap a portrait on the left to choose who to control.' },
  { icon: '🍎', text: 'Tap the fridge, then "Grab a snack". Your Sim walks over and eats. Tap furniture to see what it can do.' },
  { icon: '📊', text: 'The panel at the bottom shows needs. Green is good. Red means your Sim needs help. Moods change how fast they learn and work.' },
  { icon: '⏩', text: 'Use the speed buttons at the top to pause or speed up time. When everyone is asleep the game skips ahead.' },
  { icon: '💼', text: 'Open the Job tab to find a job. Sims go to work on their own and come home with money.' },
  { icon: '🛋️', text: 'Buy mode lets you add furniture. Drag to move things. Better objects fill needs faster and train skills.' },
  { icon: '🔨', text: 'Build mode lets you draw rooms, add doors and windows, lay floors and paint walls.' },
  { icon: '⭐', text: 'Every Sim has a life goal on the Goal tab. Complete steps for reward points. Have fun!' },
];

export class Tutorial {
  el: HTMLElement;
  private step = 0;
  constructor(private app: App) {
    this.el = h('div', { class: 'panel tutorial', style: 'display:none' });
  }

  start() {
    this.step = 0;
    this.render();
  }

  private render() {
    const s = STEPS[this.step];
    if (!s) { this.finish(); return; }
    this.el.style.display = '';
    this.el.replaceChildren(
      h('div', { class: 'tx' }, `${s.icon}  ${s.text}`),
      h('div', { class: 'foot' },
        h('span', { class: 'muted' }, `${this.step + 1} / ${STEPS.length}`),
        h('div', { style: 'display:flex;gap:8px' },
          h('button', { class: 'btn small ghost', onclick: () => this.finish() }, 'Skip'),
          h('button', { class: 'btn small primary', onclick: () => { this.step++; this.render(); } }, this.step === STEPS.length - 1 ? 'Let’s play' : 'Next'))),
    );
  }

  finish() {
    this.el.style.display = 'none';
    this.app.settings.seenTutorial = true;
    this.app.applySettings();
    if (this.app.game) this.app.game.state.tutorialDone = true;
  }
}
