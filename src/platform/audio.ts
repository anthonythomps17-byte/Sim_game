// Tiny synthesised sound effects and a gentle generative music loop (no audio files needed offline).
export class Audio {
  private ctx: AudioContext | null = null;
  private sfxGain: GainNode | null = null;
  private musicGain: GainNode | null = null;
  private musicTimer: number | null = null;
  private step = 0;
  sfxVolume = 0.7;
  musicVolume = 0.4;

  /** Must be called from a user gesture (browsers block audio until then). */
  unlock(): void {
    if (this.ctx) { void this.ctx.resume(); return; }
    try {
      this.ctx = new AudioContext();
    } catch {
      return;
    }
    this.sfxGain = this.ctx.createGain();
    this.sfxGain.gain.value = this.sfxVolume;
    this.sfxGain.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = this.musicVolume * 0.25;
    this.musicGain.connect(this.ctx.destination);
    this.startMusic();
  }

  setVolumes(sfx: number, music: number): void {
    this.sfxVolume = sfx;
    this.musicVolume = music;
    if (this.sfxGain) this.sfxGain.gain.value = sfx;
    if (this.musicGain) this.musicGain.gain.value = music * 0.25;
  }

  private tone(freq: number, start: number, dur: number, type: OscillatorType, vol: number, out: GainNode) {
    const ctx = this.ctx!;
    const o = ctx.createOscillator();
    const g = ctx.createGain();
    o.type = type;
    o.frequency.value = freq;
    g.gain.setValueAtTime(0, start);
    g.gain.linearRampToValueAtTime(vol, start + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
    o.connect(g);
    g.connect(out);
    o.start(start);
    o.stop(start + dur + 0.05);
  }

  play(name: string): void {
    if (!this.ctx || !this.sfxGain || this.sfxVolume <= 0) return;
    const t = this.ctx.currentTime;
    const out = this.sfxGain;
    switch (name) {
      case 'tap': this.tone(660, t, 0.08, 'sine', 0.15, out); break;
      case 'open': this.tone(520, t, 0.1, 'triangle', 0.12, out); this.tone(780, t + 0.05, 0.12, 'triangle', 0.1, out); break;
      case 'cash': this.tone(1320, t, 0.12, 'square', 0.05, out); this.tone(1760, t + 0.07, 0.2, 'square', 0.05, out); break;
      case 'levelup': [523, 659, 784, 1046].forEach((f, i) => this.tone(f, t + i * 0.09, 0.25, 'triangle', 0.13, out)); break;
      case 'notify': this.tone(880, t, 0.15, 'sine', 0.12, out); this.tone(660, t + 0.12, 0.2, 'sine', 0.1, out); break;
      case 'doorbell': this.tone(784, t, 0.4, 'sine', 0.15, out); this.tone(622, t + 0.35, 0.6, 'sine', 0.15, out); break;
      case 'place': this.tone(220, t, 0.12, 'triangle', 0.2, out); this.tone(330, t + 0.04, 0.1, 'triangle', 0.12, out); break;
      case 'build': this.tone(180, t, 0.1, 'square', 0.06, out); this.tone(240, t + 0.05, 0.08, 'square', 0.05, out); break;
      case 'erase': this.tone(300, t, 0.15, 'sawtooth', 0.04, out); break;
      case 'fireworks':
      case 'firework': {
        const ctx = this.ctx!;
        const len = 0.6;
        const buf = ctx.createBuffer(1, Math.floor(ctx.sampleRate * len), ctx.sampleRate);
        const d = buf.getChannelData(0);
        for (let i = 0; i < d.length; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / d.length, 3);
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        g.gain.value = 0.25;
        src.buffer = buf;
        src.connect(g);
        g.connect(out);
        src.start(t);
        break;
      }
      case 'error': this.tone(200, t, 0.2, 'square', 0.06, out); break;
    }
  }

  private startMusic(): void {
    if (this.musicTimer !== null) return;
    // A slow I–vi–IV–V pad with a soft plucked melody.
    const chords = [[261.6, 329.6, 392.0], [220.0, 261.6, 329.6], [174.6, 220.0, 261.6], [196.0, 246.9, 293.7]];
    const scale = [523.3, 587.3, 659.3, 784.0, 880.0, 784.0, 659.3, 587.3];
    const beat = 0.6;
    this.musicTimer = window.setInterval(() => {
      if (!this.ctx || !this.musicGain || this.musicVolume <= 0 || this.ctx.state !== 'running') return;
      const t = this.ctx.currentTime + 0.05;
      const bar = Math.floor(this.step / 8) % chords.length;
      if (this.step % 8 === 0) for (const f of chords[bar]) this.tone(f / 2, t, beat * 8, 'sine', 0.12, this.musicGain);
      if (this.step % 2 === 0 || Math.random() < 0.3) {
        const n = scale[(this.step * 3 + bar * 2 + (Math.random() < 0.3 ? 1 : 0)) % scale.length];
        this.tone(n, t, beat * 1.6, 'triangle', 0.07, this.musicGain);
      }
      this.step++;
    }, beat * 1000);
  }
}
