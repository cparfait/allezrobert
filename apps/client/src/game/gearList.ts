import type { DevicePanel } from '../ui/menu.ts';

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

/** Rubrique « Équipements » : une ligne par appareil (état, rôle), « Reconnecter » si pas synchronisé. */
export function gearHtml(g: GearSource, fr: boolean): string {
  const list = g.panel.list();
  const rows = list.map((d) => {
    const cls = d.ok ? 'ok' : d.state === '' ? 'off' : 'warn';
    const retry = d.ok || d.simulated || !g.panel.reconnect ? '' : `<button class="mp-btn" data-gear-retry="${esc(d.id)}">${fr ? 'Reconnecter' : 'Reconnect'}</button>`;
    return `<span class="mp-gear-dot ${cls}"></span><span class="mp-gear-name"><b>${esc(d.name)}</b><small>${esc(d.role)}${d.detail ? ` · ${esc(d.detail)}` : ''}</small></span><span class="mp-gear-state ${cls}">${d.simulated ? (fr ? 'simulé' : 'simulated') : esc(d.state)}</span>${retry || '<span></span>'}`;
  });
  const phones = g.phones?.();
  if (phones !== null && phones !== undefined)
    rows.push(`<span class="mp-gear-dot ${phones ? 'ok' : 'off'}"></span><span class="mp-gear-name"><b>${fr ? 'Appli compagnon' : 'Companion app'}</b><small>${fr ? 'téléphone' : 'phone'}</small></span><span class="mp-gear-state ${phones ? 'ok' : 'off'}">${phones ? (fr ? `${phones} connecté${phones > 1 ? 's' : ''}` : `${phones} connected`) : fr ? 'non connectée' : 'not connected'}</span><span></span>`);
  const none = !list.length ? `<p class="sub" style="margin:4px 0">${fr ? 'Aucun capteur : ouvre l’onglet Capteurs du menu pour en associer, ou roule avec le simulateur.' : 'No sensor: pair one from the Sensors tab, or ride with the simulator.'}</p>` : '';
  return `<div class="mp-gear"><h3>${fr ? 'Équipements' : 'Equipment'}</h3>${none}<div class="mp-gear-grid">${rows.join('')}</div></div>`;
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
