import type { DevicePanel } from '../ui/menu.ts';
import { strings } from '../i18n/index.ts';

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

/**
 * Rubrique « Équipements » : une ligne par appareil (état, rôle), « Reconnecter » si pas synchronisé.
 * Textes dans la langue de l'interface (`_fr` gardé pour les appelants existants).
 */
export function gearHtml(g: GearSource, _fr?: boolean): string {
  const list = g.panel.list();
  const rows = list.map((d) => {
    const cls = d.ok ? 'ok' : d.state === '' ? 'off' : 'warn';
    const retry = d.ok || d.simulated || !g.panel.reconnect ? '' : `<button class="mp-btn" data-gear-retry="${esc(d.id)}">${S('reconnect')}</button>`;
    return `<span class="mp-gear-dot ${cls}"></span><span class="mp-gear-name"><b>${esc(d.name)}</b><small>${esc(d.role)}${d.detail ? ` · ${esc(d.detail)}` : ''}</small></span><span class="mp-gear-state ${cls}">${d.simulated ? S('simulated') : esc(d.state)}</span>${retry || '<span></span>'}`;
  });
  const phones = g.phones?.();
  if (phones !== null && phones !== undefined)
    rows.push(`<span class="mp-gear-dot ${phones ? 'ok' : 'off'}"></span><span class="mp-gear-name"><b>${S('companion')}</b><small>${S('phone')}</small></span><span class="mp-gear-state ${phones ? 'ok' : 'off'}">${phones ? S(phones > 1 ? 'phoneMany' : 'phoneOne').replace('{n}', String(phones)) : S('notConnected')}</span><span></span>`);
  const none = !list.length ? `<p class="sub" style="margin:4px 0">${S('noSensor')}</p>` : '';
  return `<div class="mp-gear"><h3>${S('equipment')}</h3>${none}<div class="mp-gear-grid">${rows.join('')}</div></div>`;
}

/** Boutons « Reconnecter » d'un bloc dessiné par `gearHtml`. */
export function bindGear(root: ParentNode, g: GearSource): void {
  root.querySelectorAll<HTMLElement>('[data-gear-retry]').forEach((b) =>
    b.addEventListener('click', () => {
      b.textContent = '…';
      g.panel.reconnect?.(b.dataset.gearRetry as string);
    }),
  );
}
