import type { DevicePanel } from '../ui/menu.ts';
import { getLang, strings } from '../i18n/index.ts';
import { deviceTilesHtml } from '../ui/hardware-panel.ts';
import { ICONS } from '../ui/startCheck.ts';

const S = strings(
  {
    reconnect: 'Reconnecter',
    simulated: 'simulé',
    companion: 'Appli compagnon',
    phone: 'téléphone',
    phoneOne: '{n} connecté',
    phoneMany: '{n} connectés',
    notConnected: 'non connectée',
    noSensor: 'Aucun capteur : ouvre l’onglet Capteurs du menu pour en associer, ou roule avec le simulateur.',
    equipment: 'Équipements',
  },
  {
    reconnect: 'Reconnect',
    simulated: 'simulated',
    companion: 'Companion app',
    phone: 'phone',
    phoneOne: '{n} connected',
    phoneMany: '{n} connected',
    notConnected: 'not connected',
    noSensor: 'No sensor: pair one from the Sensors tab, or ride with the simulator.',
    equipment: 'Equipment',
  },
);

const esc = (s: string): string => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

/** Équipements du poste vus de la salle d'attente : ce qui est branché, synchronisé, et ce qu'on peut relancer. */
export interface GearSource {
  panel: DevicePanel;
  /** Appli compagnon (téléphone appairé) : nombre de téléphones connectés, null si l'appli n'est pas utilisée. */
  phones?: () => number | null;
}

/** Signature de l'état du matériel : le salon ne se redessine que si elle change. */
export function gearKey(g: GearSource): string {
  return `${g.panel.list().map((d) => `${d.id}${d.ok ? 1 : 0}${d.state}`).join(',')}|${g.phones?.() ?? ''}`;
}

/** Mesure en direct d'un rôle (« 215 W ») pour les blocs. */
function liveText(g: GearSource, kind: 'watts' | 'cadence' | 'hr' | 'gear'): string {
  const live = g.panel.live?.();
  if (kind === 'gear') return live?.gear ?? '—';
  const v = live?.[kind];
  return `${v === undefined ? '—' : Math.round(v)} ${kind === 'watts' ? 'W' : kind === 'hr' ? 'bpm' : 'tr/min'}`;
}

/**
 * Rubrique « Équipements » du salon : les mêmes gros blocs que l'onglet Capteurs et l'écran « Prêt à rouler ? »
 * (un bloc par rôle, état en toutes lettres, Associer / Reconnecter), plus l'appli compagnon. Avant : une ligne par
 * appareil et par rôle, où un même home trainer revenait cinq fois. `_fr` gardé pour les appelants existants.
 */
export function gearHtml(g: GearSource, _fr?: boolean): string {
  const list = g.panel.list();
  const tiles = deviceTilesHtml({
    devices: list,
    live: g.panel.live?.(),
    simulatorOn: g.panel.simulatorOn(),
    icons: ICONS,
    liveText: (k) => liveText(g, k),
    canReconnect: !!g.panel.reconnect,
    roadFeel: false,
    lang: getLang(),
  });
  const phones = g.phones?.();
  const phone =
    phones !== null && phones !== undefined
      ? `<p class="mp-gear-phone"><span class="mp-gear-dot ${phones ? 'ok' : 'off'}"></span><b>${S('companion')}</b> · ${phones ? S(phones > 1 ? 'phoneMany' : 'phoneOne').replace('{n}', String(phones)) : S('notConnected')}</p>`
      : '';
  return `<div class="mp-gear"><h3 class="ab-section">${S('equipment')}</h3>${tiles}${phone}</div>`;
}

/** Boutons des blocs dessinés par `gearHtml` : Reconnecter, Associer (premier transport), Oublier. */
export function bindGear(root: ParentNode, g: GearSource): void {
  root.querySelectorAll<HTMLElement>('.mp-gear [data-reconnect]').forEach((b) =>
    b.addEventListener('click', () => {
      b.textContent = '…';
      g.panel.reconnect?.(b.dataset.reconnect as string);
    }),
  );
  root.querySelectorAll<HTMLElement>('.mp-gear [data-pair]').forEach((b) =>
    b.addEventListener('click', () => {
      const transport = g.panel.transports()[0]?.id ?? '';
      void g.panel.pair(b.dataset.pair as Parameters<DevicePanel['pair']>[0], transport).catch(() => undefined);
    }),
  );
  root.querySelectorAll<HTMLElement>('.mp-gear [data-forget]').forEach((b) =>
    b.addEventListener('click', () => g.panel.forget(b.dataset.forget as string)),
  );
}
