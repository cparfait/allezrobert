# Allez Robert : pièges TSL vérifiés sur notre three.js

Le projet utilise **three 0.186.1 patché** (`patches/three@0.186.1.patch`, déclaré dans `pnpm-workspace.yaml`). Ce qui suit prime sur le reste de la skill quand les deux divergent. Chaque point a été constaté dans le jeu, pas seulement lu.

## `hash()` tronque son entrée en entier

`hash(seed)` commence par `seed.toUint()` (`three/src/nodes/math/Hash.js`). Une graine dans [0, 1] donne donc toujours 0, et tous les éléments se ressemblent (bug des pièces et vitrines identiques). Multiplier la graine avant :

```ts
const rnd = (seed: F, k: number): F => hash(seed.mul(65521).add(k)) as F; // facadeDepth.ts
```

## Brancher pour de vrai avec `Fn` + `If` (contrairement au conseil « évitez les branches »)

Un `mix`/`step` calcule les deux côtés. Pour un calcul coûteux qui ne sert que sur une partie de l'écran (intérieurs de pièces, vitrines), un vrai `If` dans un `Fn` a fait passer les façades de 77–90 à 106–108 fps. Modèle (`buildings.ts`) :

```ts
Fn(() => {
  const o = { x: gx.toVar(), seed: roomSeed.toVar() /* … */ }; // entrées en .toVar() AVANT le If
  const out = vec3(far).toVar();
  If(cond, () => { out.assign(roomInterior(o)); });
  return out;
})();
```

- Les nœuds utilisés dans la branche doivent être `.toVar()` hors du `If`, sinon le calcul est remonté avant la branche et rien n'est gagné.
- **Interdit dans une branche non uniforme** (qui varie d'un pixel à l'autre) : les dérivées (`fwidth`, `dFdx`) et l'échantillonnage de texture avec mip implicite. Les calculer avant le `If` et passer le résultat en variable.

## SSR (`SSRNode`) en r186

- Signature : `ssr(color, depth, normal, { metalnessNode, roughnessNode, camera, binaryRefine })`. La caméra est dans les options, pas en 4ᵉ argument.
- Sortie : **rgb est déjà pondéré** par la metalness ; **alpha est la distance du point touché en mètres, pas une opacité**. Multiplier par alpha a blanchi l'écran. On fait `chain.rgb.add(ssrNode.getTextureNode().rgb)`.
- Masque sans cible de rendu supplémentaire : le matériau écrit `1 − masque` dans l'alpha de l'attache `normal` via `mrtNode`, et `metalnessNode = 1 − normal.a` (`network.ts`, `renderer.ts`).
- Coût mesuré : environ +1 ms sur RTX 4090, contre +3 à 9 ms pour un miroir plan. Uniquement sous la pluie et en qualité haute/ultra.

## Modifier l'éclairage d'un seul matériau

Surcharger un modèle d'éclairage plutôt que bricoler `outputNode` :

```ts
class RoadLightingModel extends THREE.PhysicalLightingModel {
  override indirectSpecular(builder) { super.indirectSpecular(builder); builder.context.reflectedLight.indirectSpecular.mulAssign(skySpec); }
}
(m as unknown as { setupLightingModel: () => unknown }).setupLightingModel = () => new RoadLightingModel(/* … */);
```

Même principe pour les ombres projetées dans les fenêtres en retrait (`FacadeLightingModel.direct()`, qui multiplie `lightColor` par un masque).

## Divers constatés

- **NaN = écran noir** dans toute la passe (TRAA et bloom propagent). Toute division par une dimension issue de la géométrie doit être bornée (`max(facade.x, 0.01)`, hauteur minimale des vitrines).
- **Normales de détail** : `normalMap(vec3 en [0,1], échelle)` dans l'espace tangent fonctionne pour des ondulations procédurales (pluie) sans texture.
- **Mesurer en A/B alterné** (`pnpm --filter @allezrobert/perf measure`) : d'autres processus peuvent occuper le GPU et faire varier les fps absolus de 30 %.
- **Désactivation** : chaque nouvel effet garde un drapeau d'URL pour comparer (`?facade=0`, `?routefx=0`, `?ssr=0`).
