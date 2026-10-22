/**
 * Tampons audio synthétisés au démarrage (tableaux de nombres, sans WebAudio : testés sous Node).
 * Tous bouclent sans raccord audible et restent sous ±1.
 */

/** Générateur pseudo-aléatoire reproductible (mulberry32). */
export function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function normalize(d: Float32Array, peak: number): Float32Array {
  let m = 0;
  for (const x of d) m = Math.max(m, Math.abs(x));
  if (m > 0) for (let i = 0; i < d.length; i++) d[i] = ((d[i] as number) / m) * peak;
  return d;
}

/** Bruit blanc ou rose (filtre de Paul Kellet), amplitude crête ~0,5. */
export function noise(sampleRate: number, seconds: number, pink: boolean, rnd: () => number): Float32Array {
  const d = new Float32Array(Math.floor(sampleRate * seconds));
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  for (let i = 0; i < d.length; i++) {
    const w = rnd() * 2 - 1;
    if (pink) {
      b0 = 0.99765 * b0 + w * 0.099046;
      b1 = 0.963 * b1 + w * 0.2965164;
      b2 = 0.57 * b2 + w * 1.0526913;
      d[i] = (b0 + b1 + b2 + w * 0.1848) * 0.18;
    } else d[i] = w * 0.5;
  }
  // Raccord de boucle : fondu de 20 ms vers le début.
  const f = Math.min(d.length >> 2, Math.floor(sampleRate * 0.02));
  for (let i = 0; i < f; i++) {
    const t = i / f;
    const j = d.length - f + i;
    d[j] = (d[j] as number) * (1 - t) + (d[i] as number) * t;
  }
  return d;
}

/**
 * Crépitement : grains très courts à instants aléatoires (processus de Poisson, `density` par
 * seconde), amplitudes à queue longue (quelques gros cailloux parmi beaucoup de petits).
 * Sert aux gravillons (lu plus ou moins vite selon la vitesse) et aux gouttes de pluie.
 */
export function crackle(sampleRate: number, seconds: number, density: number, rnd: () => number): Float32Array {
  const d = new Float32Array(Math.floor(sampleRate * seconds));
  let t = 0;
  for (;;) {
    t += -Math.log(1 - rnd()) / density;
    const i0 = Math.floor(t * sampleRate);
    if (i0 >= d.length) break;
    const amp = 0.15 + 0.85 * rnd() ** 3;
    const len = Math.floor(sampleRate * (0.0004 + rnd() * 0.0025));
    const sign = rnd() < 0.5 ? -1 : 1;
    for (let k = 0; k < len * 4; k++) {
      const idx = (i0 + k) % d.length; // la queue d'un grain repasse au début : boucle continue
      d[idx] = (d[idx] as number) + sign * amp * (rnd() * 2 - 1) * Math.exp(-k / len);
    }
  }
  return normalize(d, 0.9);
}

/** Impacts par seconde de référence du tampon de pavés (lecture accélérée selon la vitesse). */
export const COBBLE_BUFFER_RATE = 40;

/**
 * Pavés : impacts irréguliers (±30 % d'espacement) à 40 par seconde, chacun un choc grave
 * (90–140 Hz amorti) plus un claquement bref et un peu de vibration du cadre.
 */
export function cobbles(sampleRate: number, seconds: number, rnd: () => number): Float32Array {
  const d = new Float32Array(Math.floor(sampleRate * seconds));
  const n = Math.round(seconds * COBBLE_BUFFER_RATE);
  for (let k = 0; k < n; k++) {
    const t0 = (k + (rnd() - 0.5) * 0.6) / COBBLE_BUFFER_RATE;
    const i0 = Math.floor((((t0 % seconds) + seconds) % seconds) * sampleRate);
    const amp = 0.5 + rnd() * 0.5;
    const f = 90 + rnd() * 50;
    const len = Math.floor(sampleRate * 0.045);
    for (let j = 0; j < len; j++) {
      const t = j / sampleRate;
      const thump = Math.sin(2 * Math.PI * f * t) * Math.exp(-t / 0.012);
      const click = (rnd() * 2 - 1) * Math.exp(-t / 0.0015) * 0.5;
      const rattle = (rnd() * 2 - 1) * Math.exp(-t / 0.02) * 0.12;
      const idx = (i0 + j) % d.length;
      d[idx] = (d[idx] as number) + amp * (thump + click + rattle);
    }
  }
  return normalize(d, 0.9);
}

/**
 * Chœur de grillons, stéréo : chaque grillon émet des trilles de 3–4 impulsions (porteuse
 * 4,2–5,2 kHz, impulsions de 18 ms) à une période qui divise la durée du tampon (boucle exacte).
 */
export function cricketChorus(sampleRate: number, seconds: number, count: number, rnd: () => number): [Float32Array, Float32Array] {
  const n = Math.floor(sampleRate * seconds);
  const L = new Float32Array(n);
  const R = new Float32Array(n);
  for (let c = 0; c < count; c++) {
    const f = 4200 + rnd() * 1000;
    const period = seconds / (7 + Math.floor(rnd() * 7));
    const pulses = 3 + Math.floor(rnd() * 2);
    const amp = 0.25 + rnd() * 0.75;
    const pan = rnd() * 2 - 1;
    const gl = amp * Math.sqrt((1 - pan) / 2);
    const gr = amp * Math.sqrt((1 + pan) / 2);
    const offset = rnd() * period;
    const pulseLen = 0.018;
    const pulseGap = 0.034;
    for (let i = 0; i < n; i++) {
      const t = (i / sampleRate + offset) % period;
      const k = Math.floor(t / pulseGap);
      if (k >= pulses) continue;
      const u = (t - k * pulseGap) / pulseLen;
      if (u >= 1) continue;
      // Porteuse calée sur un nombre entier de cycles par tampon (boucle sans saut de phase).
      const cycles = Math.round(f * seconds);
      const s = Math.sin((2 * Math.PI * cycles * i) / n) * Math.sin(Math.PI * u) ** 2;
      L[i] = (L[i] as number) + s * gl;
      R[i] = (R[i] as number) + s * gr;
    }
  }
  let m = 0;
  for (let i = 0; i < n; i++) m = Math.max(m, Math.abs(L[i] as number), Math.abs(R[i] as number));
  if (m > 0)
    for (let i = 0; i < n; i++) {
      L[i] = ((L[i] as number) / m) * 0.7;
      R[i] = ((R[i] as number) / m) * 0.7;
    }
  return [L, R];
}

/** Cliquet de moyeu : impulsion métallique de 12 ms (deux variantes pour éviter la répétition). */
export function hubClick(sampleRate: number, variant: number, rnd: () => number): Float32Array {
  const len = Math.floor(sampleRate * 0.012);
  const d = new Float32Array(len);
  const ring = variant ? 1.15 : 0.9;
  for (let i = 0; i < len; i++) {
    d[i] = (rnd() * 2 - 1) * Math.exp(-i / (len * 0.1)) * 0.9 + Math.sin(((i * ring * 2 * Math.PI) / sampleRate) * 6000) * Math.exp(-i / (len * 0.18)) * 0.5;
  }
  return normalize(d, 0.9);
}
