/**
 * Voix ponctuelles synthétisées (WebAudio, aucun fichier) : oiseaux, hulotte, corneille, chien,
 * cloches, vache, public (applaudissements, sifflets, « Allez ! », cloches de vache),
 * dérailleur. Chaque fonction crée ses nœuds, les programme à l'instant `at` et les arrête
 * elle-même ; `out` est le bus de la catégorie.
 */

const r = Math.random;
const between = (a: number, b: number): number => a + r() * (b - a);

/** Panoramique + passe-bas de distance, branchés sur `out`. */
function placed(ctx: BaseAudioContext, out: AudioNode, pan: number, lowpass = 20000): AudioNode {
  const p = ctx.createStereoPanner();
  p.pan.value = Math.max(-1, Math.min(1, pan));
  p.connect(out);
  if (lowpass >= 20000) return p;
  const f = ctx.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = lowpass;
  f.connect(p);
  return f;
}

/** Oscillateur à enveloppe : la fonction `shape` programme fréquence et gain. */
function tone(ctx: BaseAudioContext, out: AudioNode, at: number, dur: number, type: OscillatorType, shape: (f: AudioParam, g: AudioParam) => void): void {
  const o = ctx.createOscillator();
  o.type = type;
  const g = ctx.createGain();
  g.gain.value = 0;
  shape(o.frequency, g.gain);
  o.connect(g).connect(out);
  o.start(at);
  o.stop(at + dur + 0.05);
}

/** Bouffée de bruit filtré (claquement, souffle, frottement). */
function burst(ctx: BaseAudioContext, noise: AudioBuffer, out: AudioNode, at: number, dur: number, type: BiquadFilterType, freq: number, q: number, gain: number, attack = 0.002): void {
  const s = ctx.createBufferSource();
  s.buffer = noise;
  const f = ctx.createBiquadFilter();
  f.type = type;
  f.frequency.value = freq;
  f.Q.value = q;
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain, at + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, at + dur);
  s.connect(f).connect(g).connect(out);
  s.start(at, r() * Math.max(0, noise.duration - dur - 0.1));
  s.stop(at + dur + 0.02);
}

// ————————————————————————————————————————————— Oiseaux

export type BirdKind = 'warble' | 'tit' | 'chiff' | 'chip' | 'skylark' | 'cuckoo' | 'pigeon' | 'woodpecker' | 'crow' | 'owl';

/** Note sifflée : glissando et petite enveloppe. */
function whistleNote(ctx: BaseAudioContext, out: AudioNode, t0: number, f0: number, f1: number, dur: number, gain: number): void {
  tone(ctx, out, t0, dur, 'sine', (f, g) => {
    f.setValueAtTime(f0, t0);
    f.exponentialRampToValueAtTime(Math.max(50, f1), t0 + dur);
    g.setValueAtTime(0, t0);
    g.linearRampToValueAtTime(gain, t0 + Math.min(0.02, dur * 0.3));
    g.linearRampToValueAtTime(0, t0 + dur);
  });
}

/**
 * Chant ou cri d'oiseau. `gain` ≈ 1 pour un oiseau proche ; la distance est rendue par `lowpass`.
 * Retourne la durée approximative (pour espacer les événements).
 */
export function bird(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number, kind: BirdKind, gain: number, pan: number, lowpass = 20000): number {
  const o = placed(ctx, out, pan, lowpass);
  const g = gain * 0.09;
  switch (kind) {
    case 'warble': {
      // Merle : phrase flûtée de 4 à 8 notes, 1,6–3,2 kHz.
      const n = 4 + Math.floor(r() * 5);
      let t = at;
      for (let i = 0; i < n; i++) {
        const f = between(1600, 3200);
        const d = between(0.08, 0.22);
        whistleNote(ctx, o, t, f, f * between(0.8, 1.25), d, g * between(0.6, 1));
        t += d + between(0.02, 0.08);
      }
      return t - at;
    }
    case 'tit': {
      // Mésange : « ti-tu ti-tu ti-tu ».
      const n = 3 + Math.floor(r() * 3);
      const hi = between(5200, 6400);
      for (let i = 0; i < n; i++) {
        whistleNote(ctx, o, at + i * 0.24, hi, hi * 0.97, 0.07, g * 0.7);
        whistleNote(ctx, o, at + i * 0.24 + 0.1, hi * 0.72, hi * 0.7, 0.09, g * 0.7);
      }
      return n * 0.24;
    }
    case 'chiff': {
      // Pouillot véloce : deux notes alternées, « tsip-tsap ».
      const n = 6 + Math.floor(r() * 5);
      const a = between(5600, 6200);
      for (let i = 0; i < n; i++) whistleNote(ctx, o, at + i * 0.33, i % 2 ? a * 0.82 : a, (i % 2 ? a * 0.82 : a) * 0.9, 0.08, g * 0.6);
      return n * 0.33;
    }
    case 'chip': {
      // Cri de contact (rouge-gorge, mésange l'hiver) : « tsit » bref, une ou deux fois.
      const n = 1 + Math.floor(r() * 2);
      for (let i = 0; i < n; i++) whistleNote(ctx, o, at + i * 0.18, between(6500, 7500), 5500, 0.04, g * 0.6);
      return 0.4;
    }
    case 'skylark': {
      // Alouette des champs : trilles rapides et continues, haut dans le ciel (atténuée).
      const dur = between(3, 6);
      let t = at;
      while (t < at + dur) {
        const f = between(2500, 5200);
        whistleNote(ctx, o, t, f, f * between(0.85, 1.2), 0.03, g * 0.35);
        t += between(0.035, 0.07);
      }
      return dur;
    }
    case 'cuckoo': {
      // Coucou : tierce descendante, 2 à 4 fois.
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = at + i * 0.9;
        whistleNote(ctx, o, t, 670, 650, 0.22, g * 1.2);
        whistleNote(ctx, o, t + 0.32, 555, 535, 0.3, g * 1.2);
      }
      return n * 0.9;
    }
    case 'pigeon': {
      // Pigeon ramier : « hou-hou, hou hou hou » feutré.
      const rhythm = [0, 0.55, 0.85, 1.45, 1.75];
      for (const dt of rhythm) whistleNote(ctx, o, at + dt, 430, 390, 0.26, g * 0.9);
      return 2.1;
    }
    case 'woodpecker': {
      // Pic : tambourinage de 15 à 25 coups à ~18 Hz, qui s'éteint.
      const n = 15 + Math.floor(r() * 11);
      for (let i = 0; i < n; i++) burst(ctx, noise, o, at + i / 18, 0.012, 'bandpass', 1300, 4, gain * 0.09 * (1 - i / (n + 4)), 0.0005);
      return n / 18;
    }
    case 'crow': {
      // Corneille : 2 à 4 « kraa » rauques (dent de scie + bruit filtrés).
      const n = 2 + Math.floor(r() * 3);
      for (let i = 0; i < n; i++) {
        const t = at + i * between(0.45, 0.6);
        const f = ctx.createBiquadFilter();
        f.type = 'bandpass';
        f.frequency.value = 1300;
        f.Q.value = 1.5;
        f.connect(o);
        tone(ctx, f, t, 0.32, 'sawtooth', (fr, gg) => {
          fr.setValueAtTime(between(560, 640), t);
          fr.linearRampToValueAtTime(480, t + 0.3);
          gg.setValueAtTime(0, t);
          gg.linearRampToValueAtTime(g * 1.6, t + 0.03);
          gg.linearRampToValueAtTime(g * 1.2, t + 0.22);
          gg.linearRampToValueAtTime(0, t + 0.32);
        });
        burst(ctx, noise, o, t, 0.3, 'bandpass', 1800, 2, gain * 0.012, 0.03);
      }
      return n * 0.6;
    }
    case 'owl': {
      // Chouette hulotte : « houuu… » puis « hou, hou-hou-houuuu » avec vibrato.
      const hoot = (t: number, d: number, f0: number) =>
        tone(ctx, o, t, d, 'sine', (fr, gg) => {
          fr.setValueAtTime(f0, t);
          fr.linearRampToValueAtTime(f0 * 0.93, t + d);
          gg.setValueAtTime(0, t);
          gg.linearRampToValueAtTime(g * 1.3, t + 0.05);
          gg.linearRampToValueAtTime(0, t + d);
        });
      hoot(at, 0.7, 470);
      const t2 = at + 3.2;
      hoot(t2, 0.12, 450);
      hoot(t2 + 0.3, 0.12, 455);
      hoot(t2 + 0.5, 0.12, 460);
      // Final chevrotant : trémolo par petites notes.
      for (let i = 0; i < 8; i++) hoot(t2 + 0.75 + i * 0.09, 0.08, 470 - i * 3);
      return 4.8;
    }
  }
}

/** Aboiement lointain : 1 à 3 « ouaf » (bruit et dent de scie à formant). */
export function dogBark(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number, gain: number, pan: number): void {
  const o = placed(ctx, out, pan, 2500);
  const n = 1 + Math.floor(r() * 3);
  const f0 = between(280, 420);
  for (let i = 0; i < n; i++) {
    const t = at + i * between(0.3, 0.45);
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 800;
    f.Q.value = 2;
    f.connect(o);
    tone(ctx, f, t, 0.16, 'sawtooth', (fr, g) => {
      fr.setValueAtTime(f0 * 1.2, t);
      fr.exponentialRampToValueAtTime(f0 * 0.8, t + 0.15);
      g.setValueAtTime(0, t);
      g.linearRampToValueAtTime(gain * 0.05, t + 0.015);
      g.exponentialRampToValueAtTime(0.0001, t + 0.16);
    });
    burst(ctx, noise, o, t, 0.12, 'bandpass', 1200, 1.5, gain * 0.03);
  }
}

// ————————————————————————————————————————————— Village, prés

/** Cloche : partiels inharmoniques à décroissance lente (volée de 3 à 6 coups). */
export function bells(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number, pan: number): void {
  const p = placed(ctx, out, pan, 6000);
  const strikes = 3 + Math.floor(r() * 4);
  for (let k = 0; k < strikes; k++) {
    const t0 = at + k * 1.4;
    for (const [ratio, amp] of [
      [0.5, 0.5],
      [1, 1],
      [1.19, 0.4],
      [1.5, 0.35],
      [2, 0.3],
      [2.51, 0.15],
    ] as const) {
      tone(ctx, p, t0, 4, 'sine', (f, g) => {
        f.value = 392 * ratio;
        g.setValueAtTime(gain * amp * 0.06, t0);
        g.exponentialRampToValueAtTime(0.0001, t0 + 4 / Math.sqrt(ratio));
      });
    }
  }
}

/** Meuglement : dent de scie grave, formant filtré, glissando descendant. */
export function moo(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number, pan: number): void {
  const f = ctx.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = 520;
  f.Q.value = 3;
  f.connect(placed(ctx, out, pan, 3000));
  const base = between(110, 140);
  tone(ctx, f, at, 1.7, 'sawtooth', (fr, g) => {
    fr.setValueAtTime(base * 1.2, at);
    fr.linearRampToValueAtTime(base, at + 0.4);
    fr.linearRampToValueAtTime(base * 0.85, at + 1.4);
    g.setValueAtTime(0, at);
    g.linearRampToValueAtTime(gain * 0.12, at + 0.25);
    g.linearRampToValueAtTime(gain * 0.08, at + 1.1);
    g.linearRampToValueAtTime(0, at + 1.6);
  });
}

// ————————————————————————————————————————————— Public

/** Un applaudissement (claquement de mains). */
export function clap(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number, gain: number, pan: number): void {
  burst(ctx, noise, placed(ctx, out, pan), at, between(0.03, 0.06), 'bandpass', between(1100, 2200), 1.2, gain * 0.12, 0.001);
}

/** Sifflet aux doigts : montée puis tenue, ou deux tons. */
export function fanWhistle(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number, pan: number): void {
  const o = placed(ctx, out, pan);
  const f = between(2400, 3200);
  if (r() < 0.5) whistleNote(ctx, o, at, f * 0.7, f, 0.5, gain * 0.06);
  else {
    whistleNote(ctx, o, at, f * 0.8, f * 1.1, 0.25, gain * 0.06);
    whistleNote(ctx, o, at + 0.32, f * 1.05, f * 0.6, 0.45, gain * 0.06);
  }
}

/**
 * Cri d'encouragement « Al-lez ! » : voix (dent de scie, hauteur d'homme ou de femme) à travers
 * deux formants qui passent de /a/ (800, 1200 Hz) à /e/ (450, 1900 Hz), hauteur montante.
 */
export function shout(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number, pan: number): void {
  const o = placed(ctx, out, pan, 4500);
  const f0 = r() < 0.6 ? between(150, 230) : between(260, 360);
  const dur = between(0.4, 0.6);
  const mid = at + dur * 0.35;
  const formant = (fa: number, fe: number, q: number, amp: number) => {
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = q;
    f.frequency.setValueAtTime(fa, at);
    f.frequency.linearRampToValueAtTime(fa, mid);
    f.frequency.linearRampToValueAtTime(fe, mid + 0.06);
    const g = ctx.createGain();
    g.gain.value = amp;
    f.connect(g).connect(o);
    return f;
  };
  const f1 = formant(800, 450, 5, 1);
  const f2 = formant(1200, 1900, 7, 0.6);
  const src = ctx.createOscillator();
  src.type = 'sawtooth';
  src.frequency.setValueAtTime(f0, at);
  src.frequency.linearRampToValueAtTime(f0 * 1.05, mid);
  src.frequency.linearRampToValueAtTime(f0 * 1.3, mid + 0.08);
  src.frequency.linearRampToValueAtTime(f0 * 1.15, at + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(0, at);
  g.gain.linearRampToValueAtTime(gain * 0.12, at + 0.04);
  g.gain.linearRampToValueAtTime(gain * 0.06, mid);
  g.gain.linearRampToValueAtTime(gain * 0.14, mid + 0.08);
  g.gain.linearRampToValueAtTime(0, at + dur);
  src.connect(g);
  g.connect(f1);
  g.connect(f2);
  src.start(at);
  src.stop(at + dur + 0.05);
}

/** Cloche de vache secouée (montées alpines) : 6 à 10 coups, deux partiels inharmoniques. */
export function cowbell(ctx: BaseAudioContext, out: AudioNode, at: number, gain: number, pan: number): void {
  const o = placed(ctx, out, pan);
  const n = 6 + Math.floor(r() * 5);
  const base = between(520, 620);
  for (let i = 0; i < n; i++) {
    const t = at + i * between(0.11, 0.16);
    for (const [ratio, amp] of [
      [1, 1],
      [1.5, 0.6],
      [2.6, 0.25],
    ] as const)
      tone(ctx, o, t, 0.35, 'square', (f, g) => {
        f.value = base * ratio;
        g.setValueAtTime(gain * 0.02 * amp, t);
        g.exponentialRampToValueAtTime(0.0001, t + 0.3);
      });
  }
}

// ————————————————————————————————————————————— Transmission

/**
 * Changement de vitesse : clic du levier, puis (si l'on pédale) la chaîne qui grimpe sur le
 * pignon — petits cliquetis — et le « clonc » quand elle s'engrène. Plateau : plus lent et plus
 * grave.
 */
export function shiftSound(ctx: BaseAudioContext, out: AudioNode, noise: AudioBuffer, at: number, front: boolean, engaged: boolean, gain: number): void {
  // Levier (cocotte) : déclic sec.
  burst(ctx, noise, out, at, 0.012, 'highpass', 3500, 0.7, gain * 0.05, 0.0005);
  tone(ctx, out, at, 0.03, 'sine', (f, g) => {
    f.value = 3100;
    g.setValueAtTime(gain * 0.012, at);
    g.exponentialRampToValueAtTime(0.0001, at + 0.025);
  });
  if (!engaged) return;
  const delay = front ? 0.12 : 0.06;
  const travel = front ? 0.22 : 0.1;
  const n = front ? 6 : 3;
  for (let i = 0; i < n; i++) burst(ctx, noise, out, at + delay + (i / n) * travel + r() * 0.01, 0.015, 'bandpass', between(2200, 3600), 3, gain * 0.03, 0.0005);
  const tc = at + delay + travel;
  tone(ctx, out, tc, 0.08, 'triangle', (f, g) => {
    f.setValueAtTime(front ? 170 : 290, tc);
    f.exponentialRampToValueAtTime(front ? 120 : 210, tc + 0.06);
    g.setValueAtTime(gain * (front ? 0.06 : 0.04), tc);
    g.exponentialRampToValueAtTime(0.0001, tc + 0.07);
  });
  burst(ctx, noise, out, tc, 0.04, 'bandpass', 1500, 1.5, gain * (front ? 0.05 : 0.035), 0.001);
}
