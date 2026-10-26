/**
 * Source de la musique : musique du jeu ou Spotify (compte connecté). Le choix est mémorisé ;
 * Spotify qui se met à jouer (jeu, téléphone) en fait la source active, et revenir à la musique
 * du jeu met Spotify en pause.
 */
import { music } from './music.ts';
import { spotify } from './spotify.ts';

export type MusicSource = 'game' | 'spotify';

const KEY = 'ar.music.source';

/** Source active : toujours le jeu sans compte Spotify ; Spotify par défaut une fois connecté. */
export function musicSource(): MusicSource {
  return spotify.connected && localStorage.getItem(KEY) !== 'game' ? 'spotify' : 'game';
}

export function noteSpotifyPlaying(): void {
  localStorage.setItem(KEY, 'spotify');
}

/** Bascule la source : le jeu coupe Spotify et reprend la musique ; Spotify cède la place à la lecture. */
export async function setMusicSource(to: MusicSource): Promise<void> {
  if (to === 'game') {
    localStorage.setItem(KEY, 'game');
    await spotify.pause();
    music.setEnabled(true);
    return;
  }
  if (!spotify.connected) return;
  localStorage.setItem(KEY, 'spotify');
  music.yieldToExternal(true);
  const np = await spotify.nowPlaying();
  if (!np?.isPlaying) await spotify.toggleSmart();
}
