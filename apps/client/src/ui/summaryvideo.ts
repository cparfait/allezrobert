import { SequencePlayer, summaryVariablesFromRide, type RideSummaryInput } from '@allezrobert/sequences';
import { getLang } from '../i18n/index.ts';
import { apiBase } from './account.ts';
import type { RideSession } from '../game/ride.ts';

/** Réponse de `GET /api/renders/capabilities`. */
interface RenderCaps {
  available: boolean;
  engine: 'hyperframes' | 'ffmpeg' | null;
}

interface RenderJobView {
  id: string;
  status: 'queued' | 'running' | 'done' | 'failed';
  error: string | null;
  fileUrl: string | null;
}

/** Photo du sommet réduite (1280 px, JPEG) pour rester sous ~250 Ko dans la requête de rendu. */
async function shrinkPhoto(src: string): Promise<string | null> {
  try {
    const bmp = await createImageBitmap(await (await fetch(src)).blob());
    const k = Math.min(1, 1280 / bmp.width);
    const c = new OffscreenCanvas(Math.round(bmp.width * k), Math.round(bmp.height * k));
    c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
    for (const q of [0.78, 0.6, 0.45]) {
      const blob = await c.convertToBlob({ type: 'image/jpeg', quality: q });
      if (blob.size <= 200_000) {
        const bytes = new Uint8Array(await blob.arrayBuffer());
        let bin = '';
        for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
        return `data:image/jpeg;base64,${btoa(bin)}`;
      }
    }
  } catch {
    /* photo ignorée */
  }
  return null;
}

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Entrée du résumé animé à partir de la sortie locale (aucune FC). */
export function rideSummaryFromSession(ride: RideSession, riderName: string): RideSummaryInput {
  const recs = ride.records as Array<{ t: number; distanceM: number; altitudeM: number; watts?: number; x?: number; z?: number }>;
  const last = recs.at(-1);
  const trace = recs.filter((r, i) => i % Math.max(1, Math.ceil(recs.length / 400)) === 0 && r.x !== undefined && r.z !== undefined).map((r) => [r.x!, -r.z!] as [number, number]);
  return {
    lang: getLang(),
    title: `Allez Robert ! — ${ride.route.name}`,
    date: ride.startT,
    routeName: ride.route.name,
    riderName,
    ...(trace.length > 1 ? { trace, traceProjection: 'xy' as const } : {}),
    stats: {
      distanceKm: Math.round((last?.distanceM ?? 0) / 100) / 10,
      durationS: Math.round(ride.elapsedS),
      elevationM: Math.round(ride.elevationGainM),
      avgPowerW: Math.round(ride.avgWatts()),
      npW: Math.round(ride.normalizedPower()),
    },
    records: recs.map((r) => ({ t: r.t, distanceM: r.distanceM, altitudeM: r.altitudeM, ...(r.watts !== undefined ? { watts: r.watts } : {}) })),
  };
}

/**
 * Vidéo résumé dans l'écran de fin de sortie :
 * - serveur avec rendu vidéo (conteneur renderer ou RENDER_INLINE) : une fois la sortie
 *   enregistrée sur le compte, « Créer la vidéo (MP4) » met le rendu en file, suit son état,
 *   puis affiche la vidéo et le lien de téléchargement ;
 * - sinon (pas de compte, pas de FFmpeg sur le serveur, rendu en échec) : « Voir le résumé
 *   animé » joue la même composition directement dans le navigateur.
 */
export class SummaryVideoPanel {
  private readonly box: HTMLElement;
  private readonly ride: RideSession;
  private readonly riderName: string;
  private caps: RenderCaps | null = null;
  private activityId: string | null = null;
  private loggedIn = false;
  private state: 'idle' | 'queued' | 'running' | 'done' | 'failed' = 'idle';
  private job: RenderJobView | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private player: SequencePlayer | null = null;

  constructor(box: HTMLElement, ride: RideSession, riderName: string) {
    this.box = box;
    this.ride = ride;
    this.riderName = riderName;
    box.addEventListener('click', (e) => {
      const act = (e.target as HTMLElement).closest<HTMLElement>('[data-video]')?.dataset.video;
      if (act === 'render') void this.startRender();
      else if (act === 'preview') void this.preview();
    });
    void fetch(`${apiBase()}/renders/capabilities`, { credentials: 'include' })
      .then((r) => (r.ok ? (r.json() as Promise<RenderCaps>) : null))
      .catch(() => null)
      .then((c) => {
        this.caps = c;
        this.draw();
      });
    this.draw();
  }

  /** Compte connecté (le rendu MP4 est rattaché à une sortie enregistrée). */
  setLoggedIn(v: boolean): void {
    this.loggedIn = v;
    this.draw();
  }

  /** Sortie enregistrée : le rendu MP4 devient possible. */
  setActivity(id: string): void {
    this.activityId = id;
    this.loggedIn = true;
    this.draw();
  }

  private draw(): void {
    const fr = getLang() === 'fr';
    const available = !!this.caps?.available;
    let meta: string;
    let action = '';
    const preview = `<button class="btn small" data-video="preview">${fr ? 'Voir le résumé animé' : 'Play animated summary'}</button>`;
    if (this.state === 'done' && this.job?.fileUrl) {
      const url = `${apiBase()}${this.job.fileUrl.replace(/^\/api/, '')}`;
      this.box.innerHTML = `<h2>${fr ? 'Vidéo résumé' : 'Summary video'}</h2>
        <video controls playsinline src="${esc(url)}" style="width:100%;border-radius:12px;background:#000;max-height:44vh"></video>
        <div class="row" style="justify-content:flex-end;margin-top:8px"><a class="btn small" href="${esc(url)}" download="allez-robert-resume.mp4">${fr ? 'Télécharger le MP4' : 'Download MP4'}</a></div>`;
      return;
    }
    if (this.state === 'queued' || this.state === 'running') {
      meta = this.state === 'queued' ? (fr ? 'En file d’attente sur le serveur…' : 'Queued on the server…') : fr ? 'Rendu en cours (1 à 3 min)…' : 'Rendering (1–3 min)…';
    } else if (this.state === 'failed') {
      meta = `${fr ? 'Rendu impossible' : 'Rendering failed'}${this.job?.error ? ` : ${esc(this.job.error.slice(0, 160))}` : ''}`;
      action = preview;
    } else if (!this.caps) {
      meta = fr ? 'Vérification du rendu vidéo…' : 'Checking video rendering…';
      action = preview;
    } else if (!available) {
      meta = fr ? 'Rendu MP4 indisponible sur le serveur (FFmpeg absent ou worker arrêté) : résumé animé dans le navigateur.' : 'MP4 rendering unavailable on the server: animated summary in the browser.';
      action = preview;
    } else if (!this.loggedIn) {
      meta = fr ? 'Connecte-toi pour obtenir la vidéo MP4 de ta sortie.' : 'Sign in to get an MP4 of your ride.';
      action = preview;
    } else if (!this.activityId) {
      meta = fr ? 'Enregistre d’abord la sortie sur ton compte (ci-dessous), puis crée la vidéo.' : 'Save the ride to your account first, then create the video.';
      action = `${preview}<button class="btn small" disabled>${fr ? 'Créer la vidéo (MP4)' : 'Create video (MP4)'}</button>`;
    } else {
      meta = this.caps.engine === 'ffmpeg' ? (fr ? 'Rendu simplifié (FFmpeg) sur le serveur, ~15 s.' : 'Simplified render (FFmpeg) on the server, ~15 s.') : fr ? 'Rendu HyperFrames sur le serveur, 1 à 3 min.' : 'HyperFrames render on the server, 1–3 min.';
      action = `${preview}<button class="btn small primary" data-video="render">${fr ? 'Créer la vidéo (MP4)' : 'Create video (MP4)'}</button>`;
    }
    this.box.innerHTML = `<h2>${fr ? 'Vidéo résumé' : 'Summary video'}</h2><div class="device-list"><div class="device"><div><b>${fr ? 'Ta sortie en 30 secondes' : 'Your ride in 30 seconds'}</b><div class="meta">${meta}</div></div><div class="row" style="gap:6px">${action}</div></div></div>`;
  }

  private async startRender(): Promise<void> {
    if (!this.activityId) return;
    this.state = 'queued';
    this.draw();
    const photos = (await Promise.all(this.ride.summitPhotos.slice(0, 3).map(shrinkPhoto))).filter((p): p is string => !!p);
    const r = await fetch(`${apiBase()}/renders`, {
      method: 'POST',
      credentials: 'include',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ composition: 'summary', activityId: this.activityId, lang: getLang(), photos }),
    }).catch(() => null);
    if (!r?.ok) {
      this.state = 'failed';
      this.job = { id: '', status: 'failed', error: r ? `HTTP ${r.status}` : 'serveur injoignable', fileUrl: null };
      this.draw();
      return;
    }
    const { id } = (await r.json()) as { id: string };
    this.poll(id);
  }

  private poll(id: string): void {
    this.timer = setTimeout(async () => {
      const r = await fetch(`${apiBase()}/renders/${encodeURIComponent(id)}`, { credentials: 'include' }).catch(() => null);
      if (r?.ok) {
        this.job = (await r.json()) as RenderJobView;
        this.state = this.job.status;
        this.draw();
      }
      if (this.state === 'queued' || this.state === 'running') this.poll(id);
    }, 2500);
  }

  /** Résumé animé joué dans le navigateur (même composition que le MP4). */
  private async preview(): Promise<void> {
    const app = document.getElementById('app') ?? document.body;
    this.player?.dispose();
    this.player = new SequencePlayer(app, { lang: getLang(), zIndex: 60 });
    const vars = summaryVariablesFromRide({ ...rideSummaryFromSession(this.ride, this.riderName), photos: this.ride.summitPhotos.slice(0, 3) });
    await this.player.play('summary', vars).catch(() => undefined);
    this.player?.dispose();
    this.player = null;
  }

  dispose(): void {
    if (this.timer) clearTimeout(this.timer);
    this.player?.dispose();
  }
}
