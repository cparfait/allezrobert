import { afterEach, describe, expect, it, vi } from 'vitest';
import { v3RidePaths, type V3Catalog, type V3Gear } from '../src/v3/visuals.ts';

const catalog: V3Catalog = {
  bikes: [{ id: 'route', name: 'Route', brand: 'Test', type: 'route', wheels: { id: 'origine', weightG: 2500, cdaBias: 0 } }],
  objects: [],
  wheels: [{ id: 'zipp-808', name: 'Zipp 808', brand: 'Zipp', kind: 'route', weightG: 2495, cdaBias: -0.013 }],
};
const item = (id: number, type: string, variant: string, sex: string, extra: Partial<V3Gear> = {}): V3Gear => ({
  id, type, category: type, name: variant, variant, sex, model: true, pair: false, offset: [0, 0, 0], rotation: [0, 0, 0],
  colors: [{ name: 'a', diffuse: true, normal: true, femaleNormal: true }], ...extra,
});
const gear: V3Gear[] = [
  item(1, 'CYCLING_JERSEY', 'Maillot', 'tous', { model: false }),
  item(2, 'HAIR', 'Curly', 'male', { colors: [{ name: 'a' }] }),
  item(3, 'CYCLING_SHOES', 'SworksSpSevenL', 'tous', { pair: true, colors: [{ name: 'a' }] }),
  item(4, 'GLOVES', 'None', 'tous'),
  item(5, 'HEAD_GEAR', 'Femmes', 'female'),
];

describe('copie hors ligne du style V3', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('liste les fichiers que la sortie charge, avec les mêmes règles que le garage', async () => {
    vi.stubGlobal('fetch', vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith('catalogue') ? catalog : gear))));
    const kit = { CYCLING_JERSEY: { id: 1, color: 0, hue: 30 }, HAIR: { id: 2, color: 0 }, GLOVES: { id: 4, color: 0 }, HEAD_GEAR: { id: 5, color: 0 } };
    const paths = await v3RidePaths([{ equipment: { bike: 'route', color: 2, wheels: 'zipp-808', body: 'skinny', kit }, sex: 'male' }]);
    expect(paths.sort()).toEqual([
      '/__v3/bike/route.glb?color=2',
      '/__v3/catalogue',
      '/__v3/clips',
      '/__v3/gear',
      // Maillot sans modèle : texture et relief de la couleur choisie.
      '/__v3/gear/1/diffuse.png?color=0&hue=30',
      '/__v3/gear/1/normal.png?color=0&hue=30',
      '/__v3/gear/2/model.glb?color=0',
      // Chaussures de route d'office, en paire.
      '/__v3/gear/3/model.glb?color=0',
      '/__v3/gear/3/pair.glb?color=0',
      // Coiffure bouclée : planche male02 ; gants « None » et casque féminin : rien.
      '/__v3/hair/male02/diffuse.png',
      '/__v3/hair/male02/normal.png',
      '/__v3/helmet/homme-mince.glb',
      '/__v3/rider/homme-mince.glb',
      '/__v3/wheel/zipp-808-ar.glb',
      '/__v3/wheel/zipp-808-av.glb',
    ]);
  });
});
