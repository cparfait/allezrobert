import { createReadStream, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { basename, dirname, extname, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import type { Plugin } from 'vite';

const run = promisify(execFile);
const readJson = <T>(path: string): T => JSON.parse(readFileSync(path, 'utf8').replace(/^\uFEFF/, '')) as T;
type Scheme = { Name?: string; TexturePath?: string; NormalsPath?: string; HueShiftable?: string; HueOffset?: string; preview?: string };
type Gear = {
  i: number; type: string; cat: string; nom: string; cle?: string; poids_g?: number | null; cda?: number | null; sexe: string; sport: string; fiche: string;
  source?: string; pairSource?: string; texture?: string; normale?: string; normale_f?: string; geomgroup?: number; thumbnail?: string;
  os?: string; os_paire?: string; cheveux_override?: string | null; offset: [number, number, number]; rotation: [number, number, number];
  offset_paire?: [number, number, number]; rotation_paire?: [number, number, number]; colors: Scheme[];
};
const hueOf = (color: Scheme) => /^true$/i.test(color.HueShiftable ?? '') ? Number.parseFloat(color.HueOffset ?? '') || 0 : undefined;
function gearSchemes(row: Gear): Scheme[] {
  const base = { Name: 'D’origine', TexturePath: row.texture, NormalsPath: row.normale, preview: row.thumbnail };
  return row.colors.length ? (row.texture ? [base, ...row.colors] : row.colors) : [base];
}

/** Pièce du catalogue de l'étude (pieces-catalogue.json) : seules les roues servent ici. */
type Piece = {
  type: string; fichier: string; nom: string; cle?: string; marque?: string; modele?: string | null;
  poids?: number | null; poids_v2?: number | null; cda?: number | null; paire?: number | null;
};
/** Identifiant d'une paire de roues : dossier et fiche de la roue arrière (« …/Zipp_404_Firecrest/Rear.xml »). */
const wheelId = (sheet: string) => sheet.replace(/^.*?bikes\/Wheels\//i, '').replace(/rear\.xml$/i, '')
  .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
/**
 * Famille d'une paire de roues : route, gravel (pneus à crampons fins) ou VTT ; null pour les roues propres à un vélo
 * particulier (concept, tricycle, cruiser, BMX, handbike, couché, Brompton), jamais proposées.
 */
function wheelKind(sheet: string): 'route' | 'gravel' | 'vtt' | null {
  if (/Concept|Zwift_BW|Buffalo|Handcycle|BigSpin|Brompton|Recumbent/i.test(sheet)) return null;
  if (/ZwiftMountain/i.test(sheet)) return 'vtt';
  if (/ZwiftGravel|EnveG23|RovalTerra|Cadex_AR35|Reserve25GR|Zipp303XPLR/i.test(sheet)) return 'gravel';
  return 'route';
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
      // Poids total (grammes) et bonus de traînée (m²) de Zwift, valeurs « v2 » en priorité : pour la physique du V3.
      type Part = { role: string; xml?: string; weight_g?: number | null; weight_v2_g?: number | null; cda?: number | null; cda_v2?: number | null };
      const sheet = existsSync(resolve(bikeDir, bike.id + '.json'))
        ? readJson<{ poids_total_g?: number; poids_total_v2_g?: number; cda_bias_total?: number; cda_bias_v2_total?: number; pieces?: Part[] }>(resolve(bikeDir, bike.id + '.json'))
        : {};
      const weightG = sheet.poids_total_v2_g || sheet.poids_total_g || undefined;
      const cdaBias = sheet.cda_bias_v2_total ?? sheet.cda_bias_total;
      // Roues d'origine (poids et traînée à retrancher quand on en monte d'autres).
      const own = (sheet.pieces ?? []).filter(part => part.role === 'FrontWheel' || part.role === 'RearWheel');
      const rearSheet = own.find(part => part.role === 'RearWheel')?.xml;
      const wheels = own.length === 2 ? {
        id: rearSheet ? wheelId(rearSheet) : undefined,
        weightG: own.reduce((sum, part) => sum + (part.weight_v2_g || part.weight_g || 0), 0),
        cdaBias: own.reduce((sum, part) => sum + (part.cda_v2 ?? part.cda ?? 0), 0),
      } : undefined;
      return [{ id: bike.id, name: bike.nom, brand: bike.marque, type: bike.type, preview: !!preview, weightG, cdaBias, wheels }];
    });
    const objects = ['Environment', 'Worlds', 'Misc', 'Pickups'].flatMap(category =>
      Array.from(models(resolve(data, category)), path => {
        const key = relative(data, path).replaceAll('\\', '/');
        const id = createHash('sha256').update(key).digest('hex').slice(0, 20);
        files.set('object/' + id, path);
        return { id, name: basename(path, extname(path)), category, path: key };
      }));
    // Roues de Zwift (paires avant / arrière du catalogue des pièces) : modèles .gde de l'installation locale.
    const pieces = existsSync(resolve(study, 'pieces-catalogue.json')) ? readJson<{ pieces: Piece[] }>(resolve(study, 'pieces-catalogue.json')).pieces : [];
    const seenWheels = new Set<string>();
    // Vignettes des roues de Zwift (UI/…/Customization/Wheels/Wheel_<nom>.ztx), rapprochées du dossier de la roue.
    const wheelIcons = resolve(data, 'UI/WhiteOrangeTheme/Customization/Wheels');
    const icons = existsSync(wheelIcons) ? readdirSync(wheelIcons).flatMap(name => {
      const match = /^Wheel_(.+)\.(ztx|tgax)$/i.exec(name);
      return match?.[1] ? [{ key: match[1].toLowerCase().replace(/[^a-z0-9]/g, ''), path: resolve(wheelIcons, name) }] : [];
    }).sort((a, b) => b.key.length - a.key.length) : [];
    const iconOf = (sheet: string) => {
      const folder = dirname(sheet).replace(/^.*?bikes\/Wheels\//i, '').toLowerCase().replace(/[^a-z0-9/]/g, '');
      const last = folder.split('/').pop() ?? '';
      // Noms d'icônes parfois sans « SES » ni « Disc » (Wheel_Enve35 pour EnveSES_3.5, PinarelloEspadaDisc…).
      const bare = (key: string) => key.replace(/ses|disc/g, '');
      return (icons.find(icon => icon.key === last) ?? icons.find(icon => bare(icon.key) === bare(last))
        ?? icons.find(icon => folder.replaceAll('/', '').includes(icon.key)))?.path;
    };
    const wheels = pieces.flatMap(rear => {
      const front = typeof rear.paire === 'number' ? pieces[rear.paire] : undefined;
      if (rear.type !== 'REAR_WHEEL' || front?.type !== 'FRONT_WHEEL' || !rear.modele || !front.modele) return [];
      const kind = wheelKind(rear.fichier);
      const id = wheelId(rear.fichier);
      const rearPath = resolve(data, dirname(rear.fichier), rear.modele);
      const frontPath = resolve(data, dirname(front.fichier), front.modele);
      if (!kind || !id || seenWheels.has(id) || !existsSync(rearPath) || !existsSync(frontPath)) return [];
      seenWheels.add(id);
      files.set('wheel/' + id + '-av', frontPath);
      files.set('wheel/' + id + '-ar', rearPath);
      const icon = iconOf(rear.fichier);
      if (icon) files.set('wheel-thumbnail/' + id, icon);
      return [{ preview: !!icon,
        id, name: nameOf({ cle: rear.cle, nom: rear.nom } as Gear), brand: rear.marque ?? 'Zwift', kind,
        weightG: (front.poids_v2 || front.poids || 0) + (rear.poids_v2 || rear.poids || 0),
        cdaBias: (front.cda ?? 0) + (rear.cda ?? 0),
      }];
    });
    for (const [key, path] of Object.entries({
      'rider/homme': 'perso/corps/MaleMaster.glb', 'rider/femme': 'perso/corps/FemaleMaster.glb',
      // Autres corps Zwift (même squelette et mêmes groupes de géométrie) : mince, fort (coureur seulement).
      'rider/homme-mince': 'perso/corps/MaleMasterSkinny.glb', 'rider/homme-fort': 'perso/corps/MaleMasterBig.glb',
      'rider/femme-mince': 'perso/corps/FemaleMasterSkinny.glb',
      // Casques par défaut lissés (tools/v3_smooth_glb.py) s'ils existent, sinon ceux de l'étude (en facettes).
      'helmet/homme': existsSync(resolve(study, 'v3/perso/casque_homme.glb')) ? 'v3/perso/casque_homme.glb' : 'perso/casque.glb',
      'helmet/femme': existsSync(resolve(study, 'v3/perso/casque_femme.glb')) ? 'v3/perso/casque_femme.glb' : 'femmes/casque_zwift.glb',
    })) files.set(key, resolve(study, path));
    return { files, bikes, objects, wheels };
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
  /** Noms français de Zwift (clés LOC_…, extraites par tools/v3_loc.py), sinon anglais, sinon le nom de l'étude. */
  let names: { fr: Record<string, string>; en: Record<string, string> } | undefined;
  function nameOf(row: Gear): string {
    names ??= {
      fr: existsSync(resolve(study, 'v3/loc/FR.json')) ? readJson<Record<string, string>>(resolve(study, 'v3/loc/FR.json')) : {},
      en: existsSync(resolve(study, 'v3/loc/EN.json')) ? readJson<Record<string, string>>(resolve(study, 'v3/loc/EN.json')) : {},
    };
    return (row.cle && (names.fr[row.cle] || names.en[row.cle])) || row.nom;
  }
  function loadGear() {
    return gear ??= prepare('gear-catalogue', 'catalogue', resolve(study, 'tenues-catalogue.json'))
      .then(file => readJson<Gear[]>(file)).catch(error => { gear = undefined; throw error; });
  }
  /**
   * Préchauffage, une fois par lancement du serveur, dès que le vestiaire est ouvert : textures (coloris d'origine)
   * et maillages des articles vélo, maillots d'abord, deux conversions à la fois. Les vignettes du studio n'attendent
   * plus la conversion (fichiers identiques à ceux des requêtes, déjà présents : rien n'est refait).
   */
  let warming: Promise<void> | undefined;
  function warm(log: (message: string) => void): Promise<void> {
    return warming ??= loadGear().then(async rows => {
      const order = (row: Gear) => (row.type === 'CYCLING_JERSEY' ? 0 : 1);
      const jobs: Array<() => Promise<unknown>> = [];
      for (const row of [...rows].sort((a, b) => order(a) - order(b))) {
        if (row.sport === 'running' || row.type.startsWith('RUNNING_')) continue;
        const color = gearSchemes(row)[0];
        if (!color) continue;
        if (color.TexturePath) jobs.push(() => prepare('map', row.i + '-diffuse', color.TexturePath!, 0, hueOf(color)));
        if (color.NormalsPath) jobs.push(() => prepare('map', row.i + '-normal', color.NormalsPath!, 0));
        if (row.source) jobs.push(() => prepare('gear', row.i + '-model', row.source!));
        if (row.pairSource) jobs.push(() => prepare('gear', row.i + '-pair', row.pairSource!));
      }
      let done = 0;
      const worker = async () => {
        for (let job = jobs.shift(); job; job = jobs.shift()) {
          await job().catch(() => undefined);
          if (++done % 200 === 0) log('V3 · préchauffage des articles : ' + done + ' fichiers prêts');
        }
      };
      await Promise.all([worker(), worker()]);
      log('V3 · préchauffage des articles terminé (' + done + ' fichiers)');
    });
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
        // Photos du studio (vignettes) : lues et déposées par le garage, une fois pour toutes, dans out/v3/studio/<version>/.
        const studioMatch = /^\/studio\/(v\d{1,3})\/(index|[a-z0-9-]{1,80}\.png)$/.exec((req.url ?? '').split('?')[0] ?? '');
        const local = isLoopback(req.socket.remoteAddress) && /^(localhost|127\.0\.0\.1|\[::1\])(?::\d+)?$/i.test(req.headers.host ?? '');
        if (local && studioMatch && req.method === 'POST' && studioMatch[2] !== 'index') {
          const chunks: Buffer[] = [];
          let size = 0;
          req.on('data', (chunk: Buffer) => {
            size += chunk.length;
            if (size > 2_000_000) { req.destroy(); return; }
            chunks.push(chunk);
          });
          req.on('end', () => {
            const body = Buffer.concat(chunks);
            if (body.length < 8 || body.readUInt32BE(0) !== 0x89504e47) return json(400, { error: 'Image PNG attendue.' });
            const dir = resolve(cache, 'studio', studioMatch[1]!);
            mkdirSync(dir, { recursive: true });
            const file = resolve(dir, studioMatch[2]!);
            writeFileSync(file + '.part', body);
            renameSync(file + '.part', file);
            json(200, { ok: true });
          });
          return;
        }
        if (local && studioMatch && req.method === 'GET') {
          const dir = resolve(cache, 'studio', studioMatch[1]!);
          if (studioMatch[2] === 'index') {
            return json(200, existsSync(dir) ? readdirSync(dir).filter(name => name.endsWith('.png')).map(name => name.slice(0, -4)) : []);
          }
          const file = resolve(dir, studioMatch[2]!);
          if (!existsSync(file)) return json(404, { error: 'Vignette absente.' });
          if (res.destroyed) return;
          res.writeHead(200, { 'Content-Type': 'image/png', 'Content-Length': statSync(file).size, 'Cache-Control': 'private, max-age=86400' });
          createReadStream(file).on('error', () => res.destroy()).pipe(res);
          return;
        }
        if (!local || req.method !== 'GET') {
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
            void warm(message => server.config.logger.info(message));
            return json(200, (await loadGear()).map(row => ({
              id: row.i, type: row.type, category: row.cat, name: nameOf(row),
              variant: basename(row.fiche.replaceAll('\\', '/'), '.xml'), sex: row.sexe, sport: row.sport, group: row.geomgroup,
              model: !!row.source, pair: !!row.pairSource,
              bone: row.os, pairBone: row.os_paire, offset: row.offset, rotation: row.rotation,
              pairOffset: row.offset_paire, pairRotation: row.rotation_paire,
              // Poids (grammes) et bonus de traînée (m²) de l'accessoire selon Zwift (casques, lunettes, chaussures…).
              weightG: row.poids_g || undefined, cdaBias: row.cda || undefined,
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
          if (url.pathname === '/catalogue') return json(200, { bikes: catalog.bikes, objects: catalog.objects, wheels: catalog.wheels });
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
          const match = /^\/(bike|object|rider|helmet|wheel)\/([a-z0-9-]+)(?:\.(glb|json|png))$/.exec(url.pathname);
          if (!match) return json(404, { error: 'Ressource V3 introuvable.' });
          const kind = match[1]!;
          const id = match[2]!;
          const format = match[3];
          const source = catalog.files.get(((kind === 'bike' || kind === 'wheel') && format === 'png' ? kind + '-thumbnail' : kind) + '/' + id);
          if (!source || !existsSync(source)) return json(404, { error: 'Fichier source V3 introuvable.' });
          if (kind === 'object' && variant !== 0 && variant !== 2) return json(400, { error: 'Niveau de détail invalide.' });
          if ((kind === 'bike' || kind === 'wheel') && format === 'png') return sendFile(await prepare('thumb', kind + '-' + id, source), 'image/png');
          if (format === 'json' && kind === 'bike') {
            const info = readJson<{ coloris?: Scheme[] }>(resolve(dirname(source), id + '.json'));
            return json(200, { colors: (info.coloris ?? []).map(color => ({ name: color.Name, hue: hueOf(color) })) });
          }
          if (format !== 'glb') return json(404, { error: 'Format V3 introuvable.' });
          // Roue : modèle .gde converti comme un objet (premier niveau de détail, textures de Zwift).
          if (kind === 'wheel') return sendFile(await prepare('object', 'wheel-' + id, source, 0));
          return sendFile(await prepare(kind, id, source, variant, kind === 'bike' ? hue : undefined));
        })().catch((error: unknown) => {
          server.config.logger.warn('V3 · ' + (error instanceof Error ? error.message : String(error)));
          if (!res.headersSent && !res.destroyed) json(503, { error: 'Ressource V3 indisponible sur ce poste.' });
        });
      });
    },
  };
}
