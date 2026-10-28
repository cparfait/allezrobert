//! Fichiers du jeu : le code et les petites images sont dans l'exe ; les ressources lourdes (vidéos du
//! menu, modèles, musique, voix, mondes, textures) sont dans `<données>/media/`, téléchargées et mises à
//! jour à part (packs.rs, `media_sync`). La page les demande à la même adresse qu'avant
//! (`/menu/loop-winter.mp4`…) : ce fournisseur cherche dans l'exe, puis sur le disque.

use std::borrow::Cow;

use tauri::utils::assets::{AssetKey, AssetsIter, CspHash};
use tauri::{Assets, Runtime};

use crate::packs::media_dir;
use crate::storage::safe_join;

pub struct DiskBackedAssets<R: Runtime> {
    pub embedded: Box<dyn Assets<R>>,
}

impl<R: Runtime> Assets<R> for DiskBackedAssets<R> {
    fn get(&self, key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        self.embedded.get(key).or_else(|| {
            let path = safe_join(&media_dir(), key.as_ref())?;
            // `.manifest.json` et les dossiers cachés ne se servent pas.
            if key.as_ref().split('/').any(|c| c.starts_with('.')) {
                return None;
            }
            std::fs::read(path).ok().map(Cow::Owned)
        })
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        self.embedded.iter()
    }

    fn csp_hashes(&self, html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        self.embedded.csp_hashes(html_path)
    }
}

/// Fournisseur vide, le temps de reprendre celui de l'exe pour l'envelopper.
pub struct NoAssets;

impl<R: Runtime> Assets<R> for NoAssets {
    fn get(&self, _key: &AssetKey) -> Option<Cow<'_, [u8]>> {
        None
    }

    fn iter(&self) -> Box<AssetsIter<'_>> {
        Box::new(std::iter::empty())
    }

    fn csp_hashes(&self, _html_path: &AssetKey) -> Box<dyn Iterator<Item = CspHash<'_>> + '_> {
        Box::new(std::iter::empty())
    }
}
