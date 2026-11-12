# Allez Robert — règles pour les sessions Codex

## Plusieurs sessions en parallèle

Plusieurs sessions Codex travaillent souvent en même temps dans ce dossier, sur `main`, sans worktree. Pour ne pas casser le travail des autres :

1. **Lire `.Codex/SESSIONS.md` avant de modifier un fichier.** Y inscrire son chantier et les fichiers ou dossiers qu'on va toucher, et tenir l'entrée à jour.
2. **Ne jamais modifier, annuler ni « corriger » un fichier réservé par une autre session**, même s'il paraît faux : c'est peut-être un changement en cours ou déjà validé. Envoyer plutôt un message à la session concernée (`ListAgents` puis `SendMessage`) et attendre sa réponse.
3. **Un fichier modifié qu'on n'a pas touché soi-même n'est pas à soi.** Ne pas le restaurer (`git checkout`, `git restore`, `git stash`), ne pas le reformater.
4. **Commiter seulement ses propres fichiers**, nommés un par un : jamais `git add -A`, `git add .` ni `git commit -a`.
5. **Avant une opération qui touche tout le dépôt** (build qui régénère des données dans `apps/client/public/worlds`, script de migration, formatage global, `git pull`/`rebase`), prévenir les autres sessions.
6. **Mesures de performance GPU** : prévenir les autres sessions avant, car un build ou un serveur lancé ailleurs fausse les chiffres.
7. Quand on reçoit un message d'une autre session, y répondre avec `SendMessage` (champ `to` = son attribut `from`).
