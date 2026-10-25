# Coureurs : reste à faire (24/10/2026)

État au 24/10/2026. Rien n'est commité. Les vidéos du menu sont revenues aux versions d'origine.

## Ce qui est en place (non commité)

- **Avatar par défaut : MPFB** (`?avatar=mpfb` implicite). Le modèle acheté sert seulement aux
  tests : `?avatar=boutique`. L'ancien coureur reste disponible avec `?avatar=classic`.
- **Posture MPFB corrigée** (`tools/blender/avatars/build_avatar.py`, reprise du modèle acheté) :
  - cou à 42° (au lieu de 28°) ;
  - épaules plus avancées et plus basses (24° et −6°) ;
  - coudes orientés vers l'arrière (`ELBOW_POLE`).
  Modèles reconstruits et installés dans `apps/client/public/models/avatar/`. Anciens fichiers
  sauvegardés dans `out/mpfb-ancien/`.
- **Modèle acheté (tests)** : `tools/blender/avatars/build_boutique.py` construit
  `apps/client/public/models/avatar/boutique/` à partir de `zzModel3D/NORMAL RIG.fbx` (pack hors
  dépôt). Corrigés : pivot des hanches, cuisses, bras, épaules, mains, coudes, assise (recul de
  9 cm), peau sous les manches, textures (îlots prolongés). Recoloration : maillot (dessin, uni,
  bandes), casque et chaussures.
- **Taille des coureurs** (`look.heightCm`, de 160 à 195 cm, vélo à la taille) : **ne s'applique
  qu'au modèle acheté** pour l'instant (`sizeOf` dans `gltfAvatar.ts`).
- **Plusieurs types d'avatar chargeables ensemble** : `GltfRiderAvatar.load(familles, url, ['mpfb', 'boutique'])`,
  puis `createAvatar(look, 'boutique')`.
- **Packs de maillots** : 28 maillots ajoutés dans `packages/shared/src/cosmetics.json` (champions
  nationaux et du monde, maillots distinctifs, couleurs d'équipes sans nom ni logo), avec un
  nouveau champ `jersey` (accent, style, bandes) et le champ `pack`. **Les styles « uni » et
  « bandes » ne sont rendus que par le modèle acheté** : sur l'avatar MPFB, seule la couleur
  s'applique.
- **Tenues du film** (`apps/client/src/ui/cinematic.ts`, `OUTFITS`) : maillots surtout unis,
  casques noirs, blancs, jaunes, rouges ou bleus, chaussures blanches ou noires ; Robert en tête
  avec son visage de « papi » à moustache.

## À faire

1. **Fait (banc d'essai, 24/10)** : avatar MPFB corrigé vérifié sur route, chrono (prolongateurs),
   gravel, VTT, danseuse et peloton (`atelier-test.html?peloton`). Mains exactement sur les cibles à
   moins de 0,1 mm, gauche/droite symétriques, sur les 102 vélos du catalogue. Défaut trouvé et
   corrigé : sur le VTT les mains restaient sur les cocottes du cintre route (caché désormais, mains
   sur les poignées du cintre plat). Reste à vérifier **en sortie réelle** (caméra, roulis).
2. **Fait** : la taille (1,60 à 1,95 m) s'applique aussi à l'avatar MPFB (stature de référence
   175 cm, `MPFB_HEIGHT_CM` dans `gltfAvatar.ts`) ; `avatar-test.html?tailles`.
3. **Fait** : styles de maillot sur MPFB. « Uni » : bande de poitrine et poignets prennent la couleur
   du maillot. « Bandes » : bandes de champion tracées dans le shader (`cloth.ts`), sur la poitrine
   (`avatar-test.html?pack=pays&torso&show`).
4. **Fait** : garage, maillots regroupés par `pack` (en-têtes), vignette à bandes (`menu.ts`).
5. **Régénérer les vidéos du menu** avec l'avatar MPFB et les nouvelles tenues :
   ```bash
   pnpm --filter @allezrobert/menu-loop capture
   ```
   Durée ≈ 1 h à 1 h 30. Ne pas lancer deux captures à la fois (port 5199) ; après un arrêt
   forcé, attendre que le Chrome dédié se ferme (sinon code 21). Ensuite, augmenter
   `MENU_MEDIA_VERSION` dans `apps/client/src/main.ts` et copier les vidéos sur le serveur
   (`docs/DEPLOY.md`, § 12 bis).
   Vidéos d'origine sauvegardées dans `out/menu-anciennes-2026-10-23/`.
6. **Commiter**, en séparant :
   - le code (client, serveur, partagé, scripts Blender, banc d'essai) ;
   - l'avatar MPFB reconstruit (`apps/client/public/models/avatar/*.glb`, `*.webp`) ;
   - **pas** les fichiers dérivés du modèle acheté (`apps/client/public/models/avatar/boutique/`)
     tant que la licence n'est pas vérifiée (dépôt public). `zzModel3D/` et
     `cyclist-male-rigged.zip` sont déjà dans `.gitignore`.
   Attention : d'autres sessions ont modifié des fichiers voisins (`gltfAvatar.ts`, `atelier.ts`,
   `skin.ts`, `world/*`) ; relire le diff avant de commiter.
7. Supprimer à la main le dossier vide `C:\out\zz-analyse` créé par erreur.

## Bancs d'essai utiles

- `avatar-test.html` : pédalage, danseuse, LOD.
- `avatar-test.html?tailles` : 1,60 / 1,75 / 1,95 m (MPFB ; `&female` : modèle féminin).
- `avatar-test.html?maillots` et `?pack=pays|distinctifs|equipes|pro|tour` : maillots (MPFB par défaut ; `&female`, `&long`, `&bottles` ; le modèle acheté seulement avec `&avatar=boutique`). Anciennes planches du modèle acheté : `docs/screenshots/ancien-boutique/`.
- `atelier-test.html?rendu=<nom>` : trois quarts, profil et buste dans l'atelier.
- Ajouter `&avatar=boutique` ou `&avatar=mpfb` pour choisir le modèle.
