# EZ-Tree (copie partielle)

Générateur procédural d'arbres de Daniel Greenheck, version 1.1.0 du paquet npm `@dgreenheck/ez-tree`
(<https://github.com/dgreenheck/ez-tree>), sous licence MIT (voir `LICENSE`).

Copié ici sans modification de la génération (`tree.js`, `branch.js`, `options.js`, `enums.js`, `rng.js`,
`trellis.js`, cinq préréglages). Changements :

- `textures.js` remplacé par un bouchon : les textures d'écorce et de feuilles du paquet ne sont pas reprises (les
  feuilles n'ont pas de source connue). Le jeu ne garde que la géométrie et pose ses propres matériaux
  (`../ezTreeNear.ts`) ;
- `presets/index.js` réduit aux préréglages utilisés.
