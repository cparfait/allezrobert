/** Régénère `tiles/pack.json` de chaque monde et le catalogue `worlds/index.json` (voir packs.ts). */
import { writeCatalogue } from './packs.ts';

console.log('Packs de cartes et catalogue des zones');
writeCatalogue();
