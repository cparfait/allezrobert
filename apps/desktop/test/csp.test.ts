import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
// @ts-expect-error module JavaScript sans déclarations (script de build du bureau)
import { CONF_FILE, DEFAULT_DOMAIN, check, covers, directives, policy, scanOrigins, tauriOverride } from '../scripts/csp.mjs';

describe('CSP de l’application de bureau', () => {
  it('fichier de surcharge à jour et origines du code toutes déclarées', () => {
    expect(check()).toEqual([]);
  });

  it('reste fermée : pas de joker, pas de schéma entier, pas d’eval', () => {
    const d = directives() as Record<string, string[]>;
    expect(d['default-src']).toEqual(["'self'"]);
    expect(d['object-src']).toEqual(["'none'"]);
    expect(d['frame-ancestors']).toEqual(["'none'"]);
    expect(d['base-uri']).toEqual(["'self'"]);
    expect(d['form-action']).toEqual(["'self'"]);
    for (const list of Object.values(d)) {
      expect(list).not.toContain('*');
      expect(list).not.toContain('https:');
      expect(list).not.toContain('http:');
      expect(list).not.toContain("'unsafe-eval'");
    }
    // 'unsafe-inline' n'est toléré que pour les scripts des séquences et les styles en ligne.
    expect(Object.entries(d).filter(([, l]) => l.includes("'unsafe-inline'")).map(([k]) => k).sort()).toEqual(['script-src', 'style-src']);
  });

  it('laisse passer ce dont l’application a besoin', () => {
    const d = directives() as Record<string, string[]>;
    const connect = d['connect-src'] as string[];
    // Commandes Tauri : jamais ajoutées par Tauri lui-même.
    expect(connect).toEqual(expect.arrayContaining(['ipc:', 'http://ipc.localhost', 'http://worlds.localhost', 'worlds:', 'http://arv3.localhost', 'arv3:']));
    expect(covers(connect, `https://${DEFAULT_DOMAIN}`)).toBe(true);
    expect(covers(connect, `wss://${DEFAULT_DOMAIN}`)).toBe(true);
    expect(covers(connect, `wss://livekit.${DEFAULT_DOMAIN}`)).toBe(true);
    expect(covers(connect, 'https://api.open-meteo.com')).toBe(true);
    expect(covers(connect, 'https://exemple-inconnu.fr')).toBe(false);
    expect(covers(connect, `https://faux${DEFAULT_DOMAIN}`)).toBe(false);
    expect(d['script-src']).toEqual(expect.arrayContaining(["'wasm-unsafe-eval'", 'blob:', 'https://sdk.scdn.co']));
    expect(d['worker-src']).toContain('blob:');
    expect(covers(d['img-src'] as string[], 'https://data.geopf.fr')).toBe(true);
  });

  it('suit le domaine et les adresses du build', () => {
    const p = policy('jeu.exemple.fr', { VITE_SERVER_URL: 'https://salles.autre.fr/colyseus', VITE_WORLDS_URL: 'https://cartes.autre.fr' }) as string;
    expect(p).toContain('wss://jeu.exemple.fr');
    expect(p).toContain('https://*.jeu.exemple.fr');
    expect(p).toContain('wss://salles.autre.fr');
    expect(p).toContain('https://cartes.autre.fr');
    expect(p).not.toContain(DEFAULT_DOMAIN);
  });

  it('désactive les nonces de Tauri, qui annuleraient « unsafe-inline »', () => {
    const o = tauriOverride() as { app: { security: { csp: string; dangerousDisableAssetCspModification: string[] } } };
    expect(o.app.security.dangerousDisableAssetCspModification).toEqual(['script-src', 'style-src']);
    expect(JSON.parse(readFileSync(CONF_FILE, 'utf8'))).toEqual(o);
  });

  it('le recensement trouve bien les origines écrites dans le code', () => {
    const origins = new Set((scanOrigins() as Array<{ origin: string }>).map((f) => f.origin));
    expect(origins.has('https://data.geopf.fr')).toBe(true);
    expect(origins.has('https://api.spotify.com')).toBe(true);
  });

  it('la configuration par défaut reste sans CSP', () => {
    const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8')) as { app: { security: { csp: unknown } } };
    expect(conf.app.security.csp).toBeNull();
  });
});
