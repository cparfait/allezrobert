/**
 * SequencePlayer — joue les séquences HyperFrames par-dessus le canvas du jeu.
 *
 * Un calque (div, pointer-events: none) est ajouté au conteneur ; chaque `play()` y monte un
 * <hyperframes-player> chargé en `srcdoc` avec la composition assemblée (voir assemble.ts),
 * le lance, puis le retire à la fin. Hors lecture, aucun élément n'existe : coût nul pour le rendu
 * du jeu.
 */
import type { HyperframesPlayer } from '@hyperframes/player';
import { assembleComposition } from './assemble.ts';
import {
  SEQUENCES,
  SEQUENCE_NAMES,
  serializeVariables,
  type SequenceMeta,
  type SequenceName,
  type SequenceVariablesMap,
  type TvLiveData,
} from './catalog.ts';
import { loadCompositionHtml, loadPlayerElement, loadSharedAssets } from './loaders.ts';
import type { Lang } from './strings.ts';

/** Marges (px CSS) laissées libres autour de la zone de lecture, ex. pour le HUD. */
export interface Insets {
  top?: number;
  right?: number;
  bottom?: number;
  left?: number;
}

export interface SequencePlayerOptions {
  /** Langue par défaut des séquences (défaut : 'fr'). */
  lang?: Lang;
  /**
   * Marges appliquées aux séquences « overlay » (pas au résumé plein cadre). La composition
   * 1920×1080 est mise à l'échelle (contain) dans la zone restante : utile quand le HUD, à taille
   * fixe en px, occupe proportionnellement plus de place dans une petite fenêtre.
   */
  insets?: Insets;
  /** z-index du calque (défaut : 20 — au-dessus du canvas, sous les menus). */
  zIndex?: number;
  /** Délai max de chargement d'une composition (défaut : 8000 ms). */
  readyTimeoutMs?: number;
}

export interface PlayOptions {
  lang?: Lang;
  /**
   * Maintien (habillage TV) : après l'entrée, la séquence boucle sur sa plage de maintien
   * (SEQUENCES.tv.hold) jusqu'à `release()` ; la promesse se résout après la sortie.
   */
  hold?: boolean;
  /** Repères temporels (ex. intro : 'countdown', 'go' = départ réel). */
  onCue?: (cue: string, time: number) => void;
  /** Annulation (équivaut à stop()). */
  signal?: AbortSignal;
  /** Marges spécifiques à cette lecture (sinon celles du lecteur). */
  insets?: Insets;
}

export interface PlayResult {
  name: SequenceName;
  /** true si la séquence est allée jusqu'au bout. */
  completed: boolean;
  reason: 'ended' | 'stopped' | 'interrupted' | 'aborted' | 'error';
  error?: string;
}

interface Running {
  token: number;
  name: SequenceName;
  meta: SequenceMeta;
  el: HyperframesPlayer;
  resolve: (r: PlayResult) => void;
  holdPhase: 'none' | 'intro' | 'loop' | 'outro';
  cueTimers: ReturnType<typeof setTimeout>[];
  firedCues: Set<string>;
  readyTimer: ReturnType<typeof setTimeout> | null;
  onCue?: PlayOptions['onCue'];
  abort?: () => void;
  signal?: AbortSignal;
}

export class SequencePlayer {
  readonly layer: HTMLDivElement;
  private lang: Lang;
  private insets: Insets;
  private readyTimeoutMs: number;
  private running: Running | null = null;
  private token = 0;

  constructor(container: HTMLElement, options: SequencePlayerOptions = {}) {
    this.lang = options.lang ?? 'fr';
    this.insets = options.insets ?? {};
    this.readyTimeoutMs = options.readyTimeoutMs ?? 8000;
    const layer = document.createElement('div');
    layer.className = 'ar-sequence-layer';
    layer.setAttribute('aria-hidden', 'true');
    layer.style.cssText = [
      'position:absolute',
      'inset:0',
      'pointer-events:none',
      'display:none',
      'overflow:hidden',
      'contain:strict',
      `z-index:${options.zIndex ?? 20}`,
    ].join(';');
    container.appendChild(layer);
    this.layer = layer;
  }

  /** Séquence en cours, ou null. */
  get current(): SequenceName | null {
    return this.running?.name ?? null;
  }

  /** true pendant la boucle de maintien (play(…, { hold: true })). */
  get holding(): boolean {
    return this.running?.holdPhase === 'loop';
  }

  setLang(lang: Lang): void {
    this.lang = lang;
  }

  setInsets(insets: Insets): void {
    this.insets = insets;
    if (this.running && this.running.meta.kind === 'overlay') this.applyInsets(insets);
  }

  /**
   * Précharge le code (runtime HyperFrames, GSAP, CSS, polices, HTML des compositions) pour que
   * le premier `play()` ne déclenche aucun téléchargement. À appeler pendant un écran de
   * chargement.
   */
  async preload(names: SequenceName[] = SEQUENCE_NAMES): Promise<void> {
    const files = [...new Set(names.map((n) => SEQUENCES[n].file))];
    await Promise.all([loadPlayerElement(), loadSharedAssets(), ...files.map((f) => loadCompositionHtml(f))]);
    // Polices : on les décode une fois dans la page hôte pour qu'elles soient en cache HTTP.
    const shared = await loadSharedAssets();
    if (typeof FontFace !== 'undefined') {
      await Promise.all(
        Object.values(shared.fontUrls).map((url) =>
          fetch(url)
            .then((r) => r.arrayBuffer())
            .catch(() => undefined)
        )
      );
    }
  }

  /**
   * Joue une séquence. La promesse se résout à la fin (ou à l'interruption) — elle ne rejette
   * jamais : vérifier `completed` / `reason`.
   */
  async play<N extends SequenceName>(
    name: N,
    variables: Partial<SequenceVariablesMap[N]> = {},
    options: PlayOptions = {}
  ): Promise<PlayResult> {
    this.stop('interrupted');
    const token = ++this.token;
    const meta = SEQUENCES[name];
    if (!meta) return { name, completed: false, reason: 'error', error: `Séquence inconnue : ${String(name)}` };
    if (options.signal?.aborted) return { name, completed: false, reason: 'aborted' };

    let doc: string;
    try {
      const [html, shared] = await Promise.all([
        loadCompositionHtml(meta.file),
        loadSharedAssets(),
        loadPlayerElement(),
      ]);
      const lang = options.lang ?? this.lang;
      doc = assembleComposition(html, shared, { variables: serializeVariables(name, variables, lang), lang });
    } catch (err) {
      return { name, completed: false, reason: 'error', error: String(err) };
    }
    if (token !== this.token) return { name, completed: false, reason: 'interrupted' };
    if (options.signal?.aborted) return { name, completed: false, reason: 'aborted' };

    return new Promise<PlayResult>((resolve) => {
      const el = document.createElement('hyperframes-player') as HyperframesPlayer;
      for (const [k, v] of Object.entries({
        width: '1920',
        height: '1080',
        muted: '',
        'audio-locked': '',
        'disable-click-to-play': '',
        'assets-loading-ui': 'none',
        'shader-loading': 'none',
      })) {
        el.setAttribute(k, v);
      }
      // :host du lecteur = fond noir ; un style inline l'emporte sur :host → transparent.
      el.style.cssText =
        'position:absolute;inset:0;width:100%;height:100%;display:block;background:transparent;pointer-events:none;';

      const run: Running = {
        token,
        name,
        meta,
        el,
        resolve,
        holdPhase: options.hold && meta.hold ? 'intro' : 'none',
        cueTimers: [],
        firedCues: new Set(),
        readyTimer: null,
        onCue: options.onCue,
        signal: options.signal,
      };
      this.running = run;

      if (options.signal) {
        run.abort = () => this.finish(run, { name, completed: false, reason: 'aborted' });
        options.signal.addEventListener('abort', run.abort, { once: true });
      }

      el.addEventListener('ready', () => {
        if (this.running !== run) return;
        if (run.readyTimer) clearTimeout(run.readyTimer);
        run.readyTimer = null;
        if (run.holdPhase === 'intro' && meta.hold) el.rangeEnd = meta.hold.end;
        el.play();
      });
      el.addEventListener('play', () => this.scheduleCues(run));
      el.addEventListener('pause', () => this.clearCues(run));
      el.addEventListener('ended', () => {
        if (this.running !== run) return;
        if (run.holdPhase === 'intro' && meta.hold) {
          // Fin de l'entrée : on boucle sur [hold.start, hold.end[ jusqu'à release().
          run.holdPhase = 'loop';
          el.rangeStart = meta.hold.start;
          el.loop = true;
          el.play();
          return;
        }
        this.finish(run, { name, completed: true, reason: 'ended' });
      });
      el.addEventListener('error', (e) => {
        const detail = (e as CustomEvent<{ message?: string }>).detail;
        this.finish(run, { name, completed: false, reason: 'error', error: detail?.message ?? 'erreur du lecteur' });
      });
      run.readyTimer = setTimeout(() => {
        if (this.running === run && !el.ready) {
          this.finish(run, { name, completed: false, reason: 'error', error: 'délai de chargement dépassé' });
        }
      }, this.readyTimeoutMs);

      el.setAttribute('srcdoc', doc);
      this.applyInsets(meta.kind === 'overlay' ? (options.insets ?? this.insets) : {});
      this.layer.style.display = 'block';
      this.layer.appendChild(el);
    });
  }

  /** Sort de la boucle de maintien : joue la sortie, puis résout la promesse de play(). */
  release(): void {
    const run = this.running;
    if (!run || !run.meta.hold) return;
    const { el, meta } = run;
    const wasLooping = run.holdPhase === 'loop';
    run.holdPhase = 'outro';
    el.loop = false;
    el.rangeStart = null;
    el.rangeEnd = null;
    if (wasLooping) el.seek(meta.hold!.end);
    if (el.ready) el.play();
  }

  /**
   * Données en direct (habillage TV : W/kg, puissance, position, écarts) sans recharger la
   * composition. Sans effet si la séquence courante n'écoute pas ce canal.
   */
  update(data: TvLiveData): void {
    const run = this.running;
    if (!run) return;
    try {
      run.el.setRuntimeData(run.meta.compositionId, data);
    } catch {
      /* charge utile non clonable : ignorée */
    }
  }

  /** Arrête immédiatement la séquence en cours (sa promesse se résout avec completed=false). */
  stop(reason: 'stopped' | 'interrupted' = 'stopped'): void {
    const run = this.running;
    if (run) this.finish(run, { name: run.name, completed: false, reason });
  }

  /** Arrête tout et retire le calque du DOM. */
  dispose(): void {
    this.stop();
    this.layer.remove();
  }

  private applyInsets(insets: Insets): void {
    const s = this.layer.style;
    s.top = `${insets.top ?? 0}px`;
    s.right = `${insets.right ?? 0}px`;
    s.bottom = `${insets.bottom ?? 0}px`;
    s.left = `${insets.left ?? 0}px`;
  }

  private scheduleCues(run: Running): void {
    this.clearCues(run);
    const cues = run.meta.cues;
    if (!cues || !run.onCue) return;
    const now = run.el.currentTime || 0;
    const rate = run.el.playbackRate || 1;
    for (const [cue, at] of Object.entries(cues)) {
      if (run.firedCues.has(cue)) continue;
      const delay = Math.max(0, ((at - now) / rate) * 1000);
      run.cueTimers.push(
        setTimeout(() => {
          if (this.running !== run || run.firedCues.has(cue)) return;
          run.firedCues.add(cue);
          run.onCue?.(cue, at);
        }, delay)
      );
    }
  }

  private clearCues(run: Running): void {
    for (const t of run.cueTimers) clearTimeout(t);
    run.cueTimers = [];
  }

  private finish(run: Running, result: PlayResult): void {
    if (this.running !== run) return;
    this.running = null;
    this.clearCues(run);
    if (run.readyTimer) clearTimeout(run.readyTimer);
    if (run.abort && run.signal) run.signal.removeEventListener('abort', run.abort);
    try {
      run.el.pause();
    } catch {
      /* lecteur pas encore prêt */
    }
    run.el.remove();
    if (!this.layer.childElementCount) this.layer.style.display = 'none';
    run.resolve(result);
  }
}
