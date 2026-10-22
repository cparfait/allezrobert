import {
  DeviceManager,
  WebBluetoothTransport,
  NativeBleTransport,
  DirconTransport,
  AntTransport,
  SimulatorTransport,
  isTauri,
  type DeviceSummary,
  type DiscoveredDevice,
  type DeviceWarning,
  type Role,
  type Transport,
} from '@allezrobert/devices';
import type { DeviceKind, ShiftAction, TrainerCommand, TransportKind } from '@allezrobert/shared';
import type { DevicePanel } from '../ui/menu.ts';
import type { InputSource, RideInputs } from './inputs.ts';
import { t } from '../i18n/index.ts';

export interface DeviceLayer {
  panel: DevicePanel;
  manager: DeviceManager;
  /** Source d'entrées pour la sortie : capteurs appairés et/ou simulateur. */
  source(): InputSource;
}

const TRANSPORT_LABEL: Record<TransportKind, string> = {
  'web-bluetooth': 'Bluetooth (navigateur)',
  'native-ble': 'Bluetooth (app Windows)',
  dircon: 'Wahoo Direct Connect',
  'ant-usb': 'ANT+ (clé USB)',
  simulator: 'Simulateur',
  keyboard: 'Clavier',
  gamepad: 'Manette',
  companion: 'Appli compagnon',
};

const ROLE_KIND: Record<Role, DeviceKind> = { trainer: 'trainer', power: 'power', heartRate: 'heartRate', cadence: 'cadence', shifter: 'shifter', fan: 'fan' };

const ROLE_LABEL: Record<Role, () => string> = {
  trainer: () => t('trainer'),
  power: () => t('powerMeter'),
  heartRate: () => t('hrm'),
  cadence: () => t('cadence'),
  shifter: () => t('shifter'),
  fan: () => t('fan'),
};

function stateLabel(s: DeviceSummary['state']): string {
  switch (s) {
    case 'connected':
      return t('connected');
    case 'connecting':
      return t('connecting');
    case 'reconnecting':
      return t('reconnecting');
    case 'silent':
      return t('silent');
    case 'error':
      return 'erreur';
    default:
      return t('disconnected');
  }
}

/**
 * Couche matériel du jeu : un DeviceManager unique, des transports selon la plateforme
 * (Web Bluetooth dans Chrome/Edge ; Bluetooth natif, Direct Connect et ANT+ dans l'app Windows),
 * et le simulateur de capteurs pour rouler sans matériel.
 */
export function createDeviceLayer(): DeviceLayer {
  const sim = new SimulatorTransport({ rider: { powerW: 210, cadenceRpm: 88 }, seed: 7 });
  const transports: Transport[] = [sim];
  if ((navigator as Navigator & { bluetooth?: unknown }).bluetooth) transports.push(new WebBluetoothTransport());
  if (isTauri()) transports.push(new NativeBleTransport(), new DirconTransport(), new AntTransport());
  const manager = new DeviceManager({
    transports,
    storage: { load: () => localStorage.getItem('ar.devices'), save: (d) => localStorage.setItem('ar.devices', d) },
  });
  const warnings: DeviceWarning[] = [];
  const listeners: Array<() => void> = [];
  const changed = () => listeners.forEach((l) => l());
  manager.on('devices', changed);
  // Un vrai home trainer ou capteur de puissance connecté : le simulateur s'efface aussitôt
  // (sinon il continuerait à « pédaler » à 210 W à la place du coureur).
  manager.on('devices', (list) => {
    const real = list.some((d) => d.transport !== 'simulator' && d.state === 'connected' && (d.kinds.includes('trainer') || d.kinds.includes('power')));
    if (real) for (const d of list.filter((x) => x.transport === 'simulator')) void manager.disconnect(d.id);
  });
  manager.on('roles', changed);
  manager.on('warning', (w) => {
    if (!warnings.some((x) => x.code === w.code && x.deviceId === w.deviceId)) warnings.push(w);
    changed();
  });
  void manager.restore().catch(() => undefined);
  let available: TransportKind[] = ['simulator'];
  void manager.availableTransports().then((k) => {
    available = k;
    changed();
  });

  const connectSimulator = async () => {
    const found: DiscoveredDevice[] = [];
    await manager.scan({ transports: ['simulator'], timeoutMs: 300 });
    for (const d of manager.discovered.filter((x) => x.transport === 'simulator')) found.push(d);
    for (const d of found) if (!d.kinds.includes('fan') && !d.kinds.includes('shifter')) await manager.connect(d, { persist: false }).catch(() => undefined);
  };

  const panel: DevicePanel = {
    list: () =>
      manager.summaries().map((d) => ({
        id: d.id,
        name: d.name,
        role: d.roles.map((r) => ROLE_LABEL[r]()).join(', ') || d.kinds.join(', '),
        state: stateLabel(d.state),
        ...(d.battery !== undefined ? { detail: `🔋 ${d.battery} %` } : {}),
        ok: d.state === 'connected',
      })),
    transports: () => available.filter((k) => k !== 'simulator').map((id) => ({ id, label: TRANSPORT_LABEL[id] })),
    async pair(role, transport) {
      const kind = ROLE_KIND[role];
      const tr = transport as TransportKind;
      if (tr === 'web-bluetooth') {
        // Web Bluetooth : le navigateur affiche son sélecteur ; un seul appareil revient.
        await manager.scan({ kinds: [kind], transports: [tr] });
      } else {
        await manager.scan({ kinds: [kind], transports: [tr], timeoutMs: 5000 });
        await new Promise((r) => setTimeout(r, 5000));
        await manager.stopScan();
      }
      const candidates = manager.discovered.filter((d) => d.transport === tr && d.kinds.includes(kind));
      const best = candidates[0];
      if (!best) throw new Error(`Aucun ${ROLE_LABEL[role]().toLowerCase()} trouvé. Vérifiez qu'il est réveillé et libre (une seule appli à la fois).`);
      await manager.connect(best, { roles: [role] });
      changed();
    },
    forget: (id) => {
      void manager.forget(id).then(changed);
    },
    useSimulator: (on) => {
      // Choix mémorisé : décoché, le simulateur ne se relance plus tout seul au départ.
      localStorage.setItem('ar.sim', on ? 'on' : 'off');
      if (on) void connectSimulator().then(changed);
      else for (const d of manager.summaries().filter((x) => x.transport === 'simulator')) void manager.disconnect(d.id).then(changed);
    },
    // Case cochée = simulateur autorisé (il ne roule que s'il n'y a aucun vrai capteur).
    simulatorOn: () => localStorage.getItem('ar.sim') !== 'off',
    warnings: () => warnings.map((w) => w.message),
    adapters: async () => (isTauri() ? manager.listAdapters() : []),
    selectAdapter: (id) => manager.selectAdapter(id),
    onChange: (cb) => listeners.push(cb),
  };

  return {
    panel,
    manager,
    source: () => {
      // Sans aucun capteur : simulateur automatique (rouler tout de suite sans matériel).
      if (localStorage.getItem('ar.sim') !== 'off' && !manager.summaries().some((d) => d.state === 'connected' || d.state === 'connecting')) void connectSimulator().then(changed);
      return new ManagerInputSource(manager, sim);
    },
  };
}

/** Entrées de jeu lues sur le DeviceManager (puissance de référence, cadence, FC, vitesses). */
class ManagerInputSource implements InputSource {
  private readonly manager: DeviceManager;
  private readonly sim: SimulatorTransport;
  private readonly offs: Array<() => void> = [];
  private readonly shiftCbs: Array<(a: ShiftAction) => void> = [];
  private inputs: RideInputs = { watts: 0, cadence: 0, steer: 0 };
  private lastPowerT = 0;
  private lastFan = -1;
  private readonly onKey = (e: KeyboardEvent) => {
    // Simulateur : + / − règlent la puissance du coureur virtuel.
    if (e.key === '+' || e.key === '=') this.sim.riderPowerW = Math.min(this.sim.riderPowerW + 10, 1500);
    if (e.key === '-') this.sim.riderPowerW = Math.max(this.sim.riderPowerW - 10, 0);
    if (e.key === '0') this.sim.riderCadenceRpm = this.sim.riderCadenceRpm > 0 ? 0 : 88;
  };

  constructor(manager: DeviceManager, sim: SimulatorTransport) {
    this.manager = manager;
    this.sim = sim;
    this.offs.push(
      manager.on('power', (p) => {
        this.lastPowerT = performance.now();
        const i = this.inputs;
        i.watts = p.watts;
        if (p.cadence !== undefined) i.cadence = p.cadence;
        if (p.balanceLeft !== undefined) i.balanceLeft = p.balanceLeft;
        if (p.teLeft !== undefined) {
          i.teLeft = p.teLeft;
          i.teRight = p.teRight;
        }
        if (p.psLeft !== undefined) {
          i.psLeft = p.psLeft;
          i.psRight = p.psRight;
        }
      }),
      manager.on('cadence', (c) => (this.inputs.cadence = c.cadence)),
      manager.on('heartRate', (h) => (this.inputs.hr = h.bpm)),
      manager.on('shift', (s) => this.shiftCbs.forEach((cb) => cb(s.action))),
    );
    window.addEventListener('keydown', this.onKey);
  }

  read(): RideInputs {
    // Plus de puissance depuis 3 s : on considère que le coureur ne pédale plus.
    if (performance.now() - this.lastPowerT > 3000) {
      this.inputs.watts = 0;
      this.inputs.cadence = 0;
    }
    return this.inputs;
  }

  sendTrainer(cmd: TrainerCommand): void {
    void this.manager.sendTrainer(cmd).catch(() => undefined);
  }

  setFan(percent: number): void {
    const p = Math.round(percent / 5) * 5;
    if (p === this.lastFan) return;
    this.lastFan = p;
    void this.manager.sendFan({ kind: 'speed', percent: p }).catch(() => undefined);
  }

  onShift(cb: (a: ShiftAction) => void): void {
    this.shiftCbs.push(cb);
  }

  onWarning(cb: (message: string) => void): void {
    this.offs.push(this.manager.on('warning', (w) => cb(w.message)));
  }

  status(): Array<{ label: string; state: 'ok' | 'warn' | 'off' }> {
    const list = this.manager.summaries().map((d) => ({
      label: `${d.transport === 'simulator' ? `${t('simulator')} · ` : ''}${d.name}${d.transport === 'simulator' && d.kinds.includes('trainer') ? ` · ${this.sim.riderPowerW} W (+/−)` : ''}`,
      state: (d.state === 'connected' ? 'ok' : d.state === 'connecting' || d.state === 'reconnecting' || d.state === 'silent' ? 'warn' : 'off') as 'ok' | 'warn' | 'off',
    }));
    return list.length ? list : [{ label: t('noWebBluetooth'), state: 'off' }];
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    window.removeEventListener('keydown', this.onKey);
  }
}
