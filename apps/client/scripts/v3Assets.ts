import { createReadStream, existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const run = promisify(execFile);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as T;
type Scheme = { Name?: string; TexturePath?: string; NormalsPath?: string; HueShiftable?: string; HueOffset?: string; preview?: string };
type Gear = {
  i: number; type: string; cat: string; nom: string; sexe: string; sport: string; fiche: string;
  source?: string; pairSource?: string; texture?: string; normale?: string; normale_f?: string; geomgroup?: number; thumbnail?: string;
  os?: string; os_paire?: string; cheveux_override?: string | null; offset: [number, number, number]; rotation: [number, number, number];
  offset_paire?: [number, number, number]; rotation_paire?: [number, number, number]; colors: Scheme[];
};
const hueOf = (color: Scheme) => /^true$/i.test(color.HueShiftable ?? '') ? Number.parseFloat(color.HueOffset ?? '') || 0 : undefined;
function gearSchemes(row: Gear): Scheme[] {
  const base = { Name: 'D’origine', TexturePath: row.texture, NormalsPath: row.normale, preview: row.thumbnail };
  return row.colors.length ? (row.texture ? [base, ...row.colors] : row.colors) : [base];
}

function* models(folder: string): Generator<string> {
  if (!existsSync(folder)) return;
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    const path = resolve(folder, entry.name);
    if (entry.isDirectory()) yield* models(path);
    else if (entry.isFile() && /\.gde$/i.test(entry.name)) yield path;
  }
}

function isLoopback(address = ''): boolean {
  return address === '::1' || address === '127.0.0.1' || address === '::ffff:127.0.0.1';
}

/** Distribue les fichiers du poste de test par identifiants, uniquement sur localhost en développement. */
export function v3Assets(): Plugin {
  const workspace = resolve(import.meta.dirname, '../../..');
  const study = resolve(process.env.AR_V3_STUDY ?? 'D:/zzCACHE_ALLEZROBERT/zwift-etude');
  const data = resolve(process.env.AR_V3_DATA ?? 'D:/Zwift/data');
  const tools = resolve(process.env.AR_V3_TOOLS ?? 'C:/Users/chris/AppData/Local/Temp/claude/d83c06b7f9a69396/4f613a66-5d01-40bb-90fd-3343a29947d1/scratchpad/assets-etude/tools');
  const cache = resolve(workspace, 'out/v3');
  const clipPath = resolve(process.env.AR_V3_CLIPS ?? resolve(workspace, 'out/essai-zwift/clips-garage.json'));
  const pipeline = resolve(workspace, 'tools/v3_assets.py');
  type Bike = { id: string; nom: string; marque: string; type: string; statut: string };
  function index() {
    const files = new Map<string, string>();
    const frames = resolve(data, 'UI/WhiteOrangeTheme/Customization/Frames');
    const previews = new Map<string, string>();
    if (existsSync(frames)) {
      for (const name of readdirSync(frames)) {
        const match = /^frame_(.+)\.(ztx|tgax)$/i.exec(name);
        if (match?.[1]) previews.set(match[1].toLowerCase(), resolve(frames, name));
      }
    }
    // Vélos réassemblés avec les fiches complètes (guidons, pédaliers et dérailleurs Campagnolo…) s'ils existent.
    const bikeDir = existsSync(resolve(study, 'v3/velos/index.json')) ? resolve(study, 'v3/velos') : resolve(study, 'velos');
    const bikes = readJson<Bike[]>(resolve(bikeDir, 'index.json')).flatMap(bike => {
      const path = resolve(bikeDir, bike.id + '.glb');
      if (!/^[a-z0-9-]+$/.test(bike.id) || !existsSync(path)) return [];
      files.set('bike/' + bike.id, path);
      const preview = previews.get(bike.id);
      if (preview) files.set('bike-thumbnail/' + bike.id, preview);
      return [{ id: bike.id, name: bike.nom, brand: bike.marque, type: bike.type, preview: !!preview }];
    });
    const objects = ['Environment', 'Worlds', 'Misc', 'Pickups'].flatMap(category =>
      Array.from(models(resolve(data, category)), path => {
        const key = relative(data, path).replaceAll('\\', '/');
        const id = createHash('sha256').update(key).digest('hex').slice(0, 20);
        files.set('object/' + id, path);
        return { id, name: basename(path, extname(path)), category, path: key };
      }));
    for (const [key, path] of Object.entries({
      'rider/homme': 'perso/corps/MaleMaster.glb', 'rider/femme': 'perso/corps/FemaleMaster.glb',
      // Autres corps Zwift (même squelette et mêmes groupes de géométrie) : mince, fort (coureur seulement).
      'rider/homme-mince': 'perso/corps/MaleMasterSkinny.glb', 'rider/homme-fort': 'perso/corps/MaleMasterBig.glb',
      'rider/femme-mince': 'perso/corps/FemaleMasterSkinny.glb',
      'helmet/homme': 'perso/casque.glb', 'helmet/femme': 'femmes/casque_zwift.glb',
    })) files.set(key, resolve(study, path));
    return { files, bikes, objects };
  }
  let catalog: ReturnType<typeof index> | undefined;
  let gear: Promise<Gear[]> | undefined;
  const pending = new Map<string, Promise<void>>();
  const thumbnailWorkers = Array.from({ length: 4 }, () => Promise.resolve());
  let nextThumbnailWorker = 0;
  function prepare(kind: string, id: string, source: string, variant = 0, hue?: number): Promise<string> {
    if (kind === 'helmet') return Promise.resolve(source);
    const stamp = kind === 'bike' ? statSync(source.replace(/\.glb$/i, '.json')).mtimeMs : 0;
    const fingerprint = createHash('sha256').update([source, kind === 'map' ? 0 : statSync(source).mtimeMs, statSync(pipeline).mtimeMs, stamp, hue].join(':')).digest('hex').slice(0, 12);
    const extension = kind === 'map' || kind === 'thumb' ? '.png' : kind === 'gear-catalogue' ? '.json' : '.glb';
    const target = resolve(cache, kind, id + '-' + variant + '-' + fingerprint + extension);
    if (existsSync(target)) return Promise.resolve(target);
    let job = pending.get(target);
    if (!job) {
      const build = () => run(process.env.AR_V3_PYTHON ?? 'python', [
        pipeline, tools, study, data, source, target, kind, String(variant), ...(hue === undefined ? [] : [String(hue)]),
      ], { windowsHide: true, timeout: 120_000 }).then(() => {});
      if (kind === 'thumb') {
        const worker = nextThumbnailWorker++ % thumbnailWorkers.length;
        job = thumbnailWorkers[worker]!.then(build);
        thumbnailWorkers[worker] = job.catch(() => {});
      } else job = build();
      job = job.finally(() => pending.delete(target));
      pending.set(target, job);
    }
    return job.then(() => target);
  }
  function loadGear() {
    return gear ??= prepare('gear-catalogue', 'catalogue', resolve(study, 'tenues-catalogue.json'))
      .then(file => readJson<Gear[]>(file)).catch(error => { gear = undefined; throw error; });
  }
  return {
    name: 'ar-v3-assets',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__v3', (req, res) => {
        const json = (status: number, value: unknown) => {
          const body = JSON.stringify(value);
          res.writeHead(status, {
            'Content-Type': 'application/json; charset=utf-8', 'Content-Length': Buffer.byteLength(body), 'Cache-Control': 'no-store',
          }).end(body);
        };
        const sendFile = (file: string, contentType = 'model/gltf-binary') => {
          if (res.destroyed) return;
          res.writeHead(200, { 'Content-Type': contentType, 'Content-Length': statSync(file).size, 'Cache-Control': 'private, max-age=3600' });
          createReadStream(file).on('error', () => res.destroy()).pipe(res);
        };
        if (!isLoopback(req.socket.remoteAddress) || !/^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '') || req.method !== 'GET') {
          json(404, { error: 'Ressources V3 réservées au poste local.' });
          return;
        }
        void (async () => {
          const url = new URL(req.url ?? '/', 'http://localhost');
          const variant = Number(url.searchParams.get('color') ?? 0);
          const hue = url.searchParams.has('hue') ? Number(url.searchParams.get('hue')) : undefined;
          if (!Number.isInteger(variant) || variant < 0 || variant > 999 || (hue !== undefined && (!Number.isFinite(hue) || hue < 0 || hue > 1))) {
            return json(400, { error: 'Coloris invalide.' });
          }
          if (url.pathname === '/gear') {
            return json(200, (await loadGear()).map(row => ({
              id: row.i, type: row.type, category: row.cat, name: row.nom,
              variant: basename(row.fiche.replaceAll('\\', '/'), '.xml'), sex: row.sexe, sport: row.sport, group: row.geomgroup,
              model: !!row.source, pair: !!row.pairSource,
              bone: row.os, pairBone: row.os_paire, offset: row.offset, rotation: row.rotation,
              pairOffset: row.offset_paire, pairRotation: row.rotation_paire,
              // Géométrie de coiffure imposée par le couvre-chef (Accessories.xml, hairGeomOverride) : 1, 2 ou 3.
              hairGeom: row.cheveux_override ? Number(row.cheveux_override) : undefined,
              colors: gearSchemes(row).map(color => ({
                name: color.Name, hue: hueOf(color), diffuse: !!color.TexturePath, normal: !!color.NormalsPath,
                femaleNormal: !!(color.Name === 'D’origine' && row.normale_f), preview: !!(color.preview || row.thumbnail),
                // Vraie icône de l'interface Zwift (dossier UI) ; sinon la vignette n'est que la texture dépliée.
                icon: /[\\/]UI[\\/]/i.test(color.preview || row.thumbnail || ''),
              })),
            })));
          }
          // Planches de texture des coiffures (6 couleurs) : les modèles de cheveux convertis n'en ont pas.
          const hairMatch = /^\/hair\/(male01|male02|female01)\/(diffuse|normal)\.png$/.exec(url.pathname);
          if (hairMatch) {
            const files: Record<string, [string, string]> = {
              male01: ['MaleHair01', 'MaleHair01Nml'], male02: ['MaleHair02D', 'MaleHair02N'], female01: ['FemaleHair01', 'FemaleHair01Nml'],
            };
            const [diffuse, normal] = files[hairMatch[1]!]!;
            const source = resolve(study, 'outils/wadsrc/Humans/Accessories/Hair/Textures', (hairMatch[2] === 'diffuse' ? diffuse : normal) + '.tgax');
            if (!existsSync(source)) return json(404, { error: 'Planche de cheveux introuvable.' });
            return sendFile(await prepare('map', 'hair-' + hairMatch[1] + '-' + hairMatch[2], source), 'image/png');
          }
          const gearMatch = /^\/gear\/(\d{1,5})\/(model|pair|diffuse|normal|female-normal|thumb)\.(?:glb|png)$/.exec(url.pathname);
          if (gearMatch) {
            const row = (await loadGear()).find(item => item.i === Number(gearMatch[1]));
            if (!row) return json(404, { error: 'Accessoire introuvable.' });
            const color = gearSchemes(row)[variant];
            if (!color) return json(400, { error: 'Coloris indisponible.' });
            const part = gearMatch[2];
            if (part === 'thumb') {
              const source = color.preview || row.thumbnail;
              if (!source) return json(404, { error: 'Vignette de l’accessoire indisponible.' });
              return sendFile(await prepare('thumb', 'gear-' + row.i, source, variant), 'image/png');
            }
            if (part === 'model' || part === 'pair') {
              const source = part === 'model' ? row.source : row.pairSource;
              if (!source) return json(404, { error: 'Maillage de l’accessoire introuvable.' });
              return sendFile(await prepare('gear', row.i + '-' + part, source));
            }
            const source = part === 'diffuse' ? color.TexturePath : part === 'female-normal' ? row.normale_f : color.NormalsPath;
            if (!source) return json(404, { error: 'Texture de l’accessoire introuvable.' });
            const shift = part === 'diffuse' && hueOf(color) !== undefined ? hue ?? hueOf(color) : undefined;
            return sendFile(await prepare('map', row.i + '-' + part, source, variant, shift), 'image/png');
          }
          catalog ??= index();
          if (url.pathname === '/catalogue') return json(200, { bikes: catalog.bikes, objects: catalog.objects });
          if (url.pathname === '/clips') {
            // Clips du garage (format compact), complétés par les clips décodés de l'étude (version 24 comprise :
            // vélo couché, handbike, clips masculins assis), au format à clés explicites. Ni « BW » ni clignements.
            const garage = readJson<{ name: string; rig: string }[]>(clipPath);
            const known = new Set(garage.map(clip => clip.name + '|' + clip.rig));
            const extra: unknown[] = [];
            for (const [folder, rig] of [['homme', 'Male'], ['femme', 'Female']] as const) {
              const dir = resolve(study, 'animations/clips', folder);
              if (!existsSync(dir)) continue;
              for (const file of readdirSync(dir)) {
                const name = basename(file, '.json');
                if (!/^cyclist/i.test(name) || /BW$|Blink$/i.test(name) || known.has(name + '|' + rig)) continue;
                const clip = readJson<{ duree: number; pistes: unknown[] }>(resolve(dir, file));
                extra.push({ name, rig, duration: clip.duree, keys: clip.pistes });
              }
            }
            return json(200, [...garage, ...extra]);
          }
          const match = /^\/(bike|object|rider|helmet)\/([a-z0-9-]+)(?:\.(glb|json|png))$/.exec(url.pathname);
          if (!match) return json(404, { error: 'Ressource V3 introuvable.' });
          const kind = match[1]!;
          const id = match[2]!;
          const format = match[3];
          const source = catalog.files.get((kind === 'bike' && format === 'png' ? 'bike-thumbnail' : kind) + '/' + id);
          if (!source || !existsSync(source)) return json(404, { error: 'Fichier source V3 introuvable.' });
          if (kind === 'object' && variant !== 0 && variant !== 2) return json(400, { error: 'Niveau de détail invalide.' });
          if (kind === 'bike' && format === 'png') return sendFile(await prepare('thumb', 'bike-' + id, source), 'image/png');
          if (format === 'json' && kind === 'bike') {
            const info = readJson<{ coloris?: Scheme[] }>(resolve(dirname(source), id + '.json'));
            return json(200, { colors: (info.coloris ?? []).map(color => ({ name: color.Name, hue: hueOf(color) })) });
          }
          if (format !== 'glb') return json(404, { error: 'Format V3 introuvable.' });
          return sendFile(await prepare(kind, id, source, variant, kind === 'bike' ? hue : undefined));
        })().catch((error: unknown) => {
          server.config.logger.warn('V3 · ' + (error instanceof Error ? error.message : String(error)));
          if (!res.headersSent && !res.destroyed) json(503, { error: 'Ressource V3 indisponible sur ce poste.' });
        });
      });
    },
  };
}
