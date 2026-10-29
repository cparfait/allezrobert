import { BIKES, BIKE_FAMILIES, type AvatarLook } from '@allezrobert/shared';
import { createEngine } from './engine/renderer.ts';
import { QUALITY_PRESETS } from './engine/quality.ts';
import { GltfRiderAvatar } from './rider/gltfAvatar.ts';
import { OWN_MODEL_TYPES, loadBikeFamily } from './rider/bikes.ts';
import { studioEnvironment } from './ui/atelier.ts';
import { BikeShooter, commonFrame, type BikeBounds } from './ui/bikeShot.ts';

/**
 * Fabrique les miniatures des vélos du garage (développement) : /bike-thumbs.html rend chaque vélo du catalogue, avec son vrai
 * modèle 3D et sa vraie livrée (voir ui/bikeShot.ts), et enregistre une image WebP 320 × 200 par vélo dans out/bike-thumbs/
 * (via POST /__save du serveur de développement). À copier ensuite dans apps/client/public/bike-thumbs/ :
 *
 *   cp out/bike-thumbs/*.webp apps/client/public/bike-thumbs/
 *
 * À refaire quand un vélo, sa livrée ou un modèle de cadre change. `?only=id1,id2` : seulement ces vélos ; `?noshot` : juste regarder.
 * `plain` est le vélo sans marque, rendu en cadre blanc : le garage le teinte de la couleur choisie (ui/bikeThumb.ts).
 */
const canvas = document.getElementById('scene') as HTMLCanvasElement;
const sheet = document.getElementById('sheet') as HTMLElement;
const log = document.getElementById('log') as HTMLElement;
const params = new URLSearchParams(location.search);
/** Image finale et facteur de suréchantillonnage (rendu 2× puis réduction : bords lisses). */
const K = Number(params.get('k') ?? 1); // ?k=3 : image agrandie pour l'examen à l'œil (avec ?noshot)
const W = 320 * K;
const H = 200 * K;
const SS = 2;

async function save(name: string, c: HTMLCanvasElement): Promise<void> {
  if (params.has('noshot')) return;
  const blob = await new Promise<Blob>((res, rej) => c.toBlob((b) => (b ? res(b) : rej(new Error('webp indisponible'))), 'image/webp', 0.88));
  await fetch(`/__save?name=${encodeURIComponent(name)}&dir=bike-thumbs`, { method: 'POST', body: blob });
}

async function main(): Promise<void> {
  const engine = await createEngine(canvas, { ...QUALITY_PRESETS.high, taa: false, pixelRatio: 1 });
  engine.renderer.setPixelRatio(1);
  log.textContent = 'chargement des modèles…';
  await GltfRiderAvatar.load([...BIKE_FAMILIES]);
  await Promise.all([...BIKE_FAMILIES, ...OWN_MODEL_TYPES].map((f) => loadBikeFamily(f)));
  const shooter = new BikeShooter(engine.renderer, studioEnvironment(engine.renderer));
  const only = params.get('only')?.split(',');
  // Le vélo sans marque : cadre blanc, teinté au garage. Les autres : un cliché par modèle du catalogue.
  const jobs: Array<{ id: string; look: Partial<AvatarLook> }> = [
    { id: 'plain', look: { bikeModel: undefined, bike: '#ffffff', bikeType: 'road' as const } },
    ...BIKES.map((b) => ({ id: b.id, look: { bikeModel: b.id } })),
    // VTT et gravel : modèles propres (hors catalogue des cadres), aux couleurs de leur fiche du garage.
    { id: 'bike-vtt', look: { bikeModel: undefined, bikeType: 'mtb' as const, bike: '#2f6b3a' } },
    { id: 'bike-gravel', look: { bikeModel: undefined, bikeType: 'gravel' as const, bike: '#6b7d4f' } },
  ].filter((j) => !only || only.includes(j.id));
  // Première passe : emprises, pour un cadre commun (même échelle partout).
  const mounted: Array<{ id: string; avatar: Awaited<ReturnType<BikeShooter['mount']>>['avatar']; bounds: BikeBounds }> = [];
  for (const j of jobs) {
    const m = await shooter.mount(j.look);
    mounted.push({ id: j.id, ...m });
  }
  const frame = commonFrame(mounted.map((m) => m.bounds), W / H);
  console.info('[bike-thumbs] cadre', frame, 'vélos', mounted.length);
  for (const [i, m] of mounted.entries()) {
    const big = await shooter.shoot(m.avatar, m.bounds, frame, W * SS, H * SS);
    const c = document.createElement('canvas');
    c.width = W;
    c.height = H;
    const g = c.getContext('2d') as CanvasRenderingContext2D;
    g.imageSmoothingQuality = 'high';
    g.drawImage(big, 0, 0, W, H);
    await save(`${m.id}.webp`, c);
    const fig = document.createElement('figure');
    fig.append(c, Object.assign(document.createElement('figcaption'), { textContent: m.id }));
    sheet.append(fig);
    log.textContent = `${i + 1} / ${mounted.length} — ${m.id}`;
  }
  log.textContent = `terminé : ${mounted.length} miniatures`;
  (window as unknown as { __bikeThumbsDone: boolean }).__bikeThumbsDone = true;
}

void main();
