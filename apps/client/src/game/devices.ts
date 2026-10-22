import {
  DeviceManager,
  WebBluetoothTransport,
  NativeBleTransport,
  DirconTransport,
  AntTransport,
  SimulatorTransport,
  FanController,
  GamepadShifter,
  KeyboardShifter,
  DEFAULT_HID_REMOTE_BINDINGS,
  isTauri,
  type CalibrationEvent,
  type DeviceSummary,
  type DiscoveredDevice,
  type DeviceWarning,
  type Role,
  type Transport,
} from '@allezrobert/devices';
import { parseAntNetworkKey, type ExperimentalAdapters } from '@allezrobert/protocols';
import type { DeviceKind, ShiftAction, TrainerCommand, TransportKind } from '@allezrobert/shared';
import type { DevicePanel } from '../ui/menu.ts';
import { renderHardwarePanel } from '../ui/hardware-panel.ts';
import { loadSettings } from '../ui/settings.ts';
import type { InputSource, RideInputs } from './inputs.ts';
import { loadHardwarePrefs, onHardwarePrefs, updateHardwarePrefs, type HardwarePrefs } from './hardware.ts';
import { t } from '../i18n/index.ts';

export interface DeviceLayer {
  panel: DevicePanel;
  manager: DeviceManager;
  /** Source d'entrées pour la sortie : capteurs appairés et/ou simulateur. */
  source(): InputSource;
}

/** Réglages avancés du matériel, affichés sous les tuiles de l'onglet Capteurs (ui/hardware-panel.ts). */
export interface HardwareApi {
  manager: DeviceManager;
  prefs(): HardwarePrefs;
  update(change: (p: HardwarePrefs) => void): void;
  experimental(): ExperimentalAdapters;
  setExperimental(flags: Partial<ExperimentalAdapters>): void;
  /** Spin-down du trainer assigné : déroulé dans `calibration()`. */
  calibrate(): Promise<void>;
  calibration(): CalibrationEvent | undefined;
  calibrationSupport(): 'supported' | 'unsupported' | 'unknown';
  /** Appareils avec leur transport, état, firmware et batterie. */
  details(): Array<DeviceSummary & { firmware?: string; model?: string; manufacturer?: string }>;
  reconnect(id: string): void;
  /** Web Bluetooth : afficher tous les appareils dans le sélecteur (Di2, HEADWIND qui n'annoncent pas leur service). */
  showAllDevices: boolean;
  /** Ajoute un trainer Direct Connect par adresse IP (app Windows). */
  addDirconHost(host: string): void;
  isDesktop: boolean;
  /** Journal matériel (horodaté) à copier dans un signalement de problème. */
  log(): string;
  /** Essai du ventilateur : envoie une consigne tout de suite. */
  testFan(percent: number): Promise<void>;
  onChange(cb: () => void): void;
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

/** Rôles qui exigent un adaptateur expérimental : on prévient plutôt que d'ouvrir un sélecteur vide. */
const ROLE_ADAPTERS: Partial<Record<Role, Array<keyof ExperimentalAdapters>>> = {
  shifter: ['zwiftControllers', 'shimanoDfly', 'sramAxs', 'antControls'],
  fan: ['headwind'],
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

/** Manette : seulement les changements de vitesse (A/B/Start restent libres pour l'interface). */
const GAMEPAD_SHIFT_BINDINGS: Record<number, ShiftAction> = { 5: 'up', 4: 'down', 12: 'up', 13: 'down', 7: 'frontUp', 6: 'frontDown' };

/**
 * Couche matériel du jeu : un DeviceManager unique, des transports selon la plateforme
 * (Web Bluetooth dans Chrome/Edge ; Bluetooth natif, Direct Connect et ANT+ dans l'app Windows),
 * et le simulateur de capteurs pour rouler sans matériel.
 */
export function createDeviceLayer(): DeviceLayer {
  const prefs = loadHardwarePrefs();
  const sim = new SimulatorTransport({ rider: { powerW: 210, cadenceRpm: 88 }, seed: 7, devices: ['trainer', 'pedals', 'heartRate', 'click', 'headwind', 'dfly'] });
  const transports: Transport[] = [sim];
  if ((navigator as Navigator & { bluetooth?: unknown }).bluetooth) transports.push(new WebBluetoothTransport());
  let dircon: DirconTransport | undefined;
  if (isTauri()) {
    let networkKey: Uint8Array | undefined;
    try {
      if (prefs.antNetworkKey.trim()) networkKey = parseAntNetworkKey(prefs.antNetworkKey);
    } catch {
      networkKey = undefined; // clé mal saisie : l'app desktop se rabat sur sa propre configuration
    }
    dircon = new DirconTransport();
    for (const h of prefs.dirconHosts) dircon.addManualDevice(h);
    transports.push(new NativeBleTransport(), dircon, new AntTransport(networkKey ? { networkKey } : {}));
  }
  const manager = new DeviceManager({
    transports,
    storage: { load: () => localStorage.getItem('ar.devices'), save: (d) => localStorage.setItem('ar.devices', d) },
  });

  // Journal matériel : ce que le coureur copie pour signaler un problème (docs/HARDWARE_TEST.md).
  const journal: string[] = [];
  const log = (line: string) => {
    const d = new Date();
    journal.push(`${d.toLocaleTimeString('fr-FR')}.${String(d.getMilliseconds()).padStart(3, '0')} ${line}`);
    if (journal.length > 600) journal.splice(0, journal.length - 600);
  };
  log(`Démarrage · ${navigator.userAgent} · ${isTauri() ? 'app Windows' : 'navigateur'}`);
  manager.on('log', (m) => log(m));
  manager.on('deviceState', (e) => log(`${e.deviceId} → ${e.state}`));
  manager.on('powerSource', (s) => log(`source de puissance : ${s}`));
  manager.on('calibration', (c) => log(`calibration ${c.deviceId} : ${c.status}${c.targetSpeedLowKmh !== undefined ? ` (${c.targetSpeedLowKmh}–${c.targetSpeedHighKmh} km/h)` : ''}${c.reason ? ` — ${c.reason}` : ''}`));
  manager.on('shift', (s) => log(`vitesse ${s.action} (${s.sourceId})${s.realGear ? ` rapport réel ${s.realGear.front}/${s.realGear.rear}` : ''}`));
  (window as Window & { __arDeviceLog?: () => string }).__arDeviceLog = () => journal.join('\n');
  // Développement : simulateur accessible depuis la console (pannes, boutons) pour vérifier les parcours.
  if (import.meta.env.DEV) (window as Window & { __arSim?: SimulatorTransport }).__arSim = sim;

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
    log(`⚠ ${w.deviceId} ${w.code}${w.details ? ` ${JSON.stringify(w.details)}` : ''}`);
    if (!warnings.some((x) => x.code === w.code && x.deviceId === w.deviceId)) warnings.push(w);
    changed();
  });
  // Capteur revenu : ses alertes passagères (muet, contrôle perdu) disparaissent.
  manager.on('deviceState', ({ deviceId, state }) => {
    if (state !== 'connected') return;
    for (let i = warnings.length - 1; i >= 0; i--) {
      const w = warnings[i] as DeviceWarning;
      if (w.deviceId === deviceId && (w.code === 'sensor-silent' || w.code === 'trainer-control-lost')) warnings.splice(i, 1);
    }
    changed();
  });
  let lastCalibration: CalibrationEvent | undefined;
  manager.on('calibration', (c) => {
    // FTMS répète « requested » (réponse 0x80 avec la plage, puis statut 0x14 sans) : on garde la plage.
    const keep = lastCalibration?.status === c.status && c.targetSpeedLowKmh === undefined ? lastCalibration : undefined;
    lastCalibration = keep ? { ...keep, ...c, targetSpeedLowKmh: keep.targetSpeedLowKmh, targetSpeedHighKmh: keep.targetSpeedHighKmh } as CalibrationEvent : c;
    changed();
  });
  void manager.restore().catch(() => undefined);
  let available: TransportKind[] = ['simulator'];
  void manager.availableTransports().then((k) => {
    available = k;
    changed();
  });

  // Commandes locales : manette (API Gamepad) et télécommande HID (vue comme un clavier).
  const applyLocalShifters = (p: HardwarePrefs) => {
    if (p.gamepad) manager.addShifterSource(new GamepadShifter({ bindings: GAMEPAD_SHIFT_BINDINGS }));
    else manager.removeShifterSource('gamepad');
    const hid = { ...DEFAULT_HID_REMOTE_BINDINGS, ...p.hidBindings };
    manager.addShifterSource(new KeyboardShifter({ id: 'hid', name: 'Télécommande HID', bindings: hid }));
  };
  applyLocalShifters(prefs);
  onHardwarePrefs(applyLocalShifters);

  const connectSimulator = async () => {
    await manager.scan({ transports: ['simulator'], timeoutMs: 300 });
    const exp = manager.experimental;
    for (const d of manager.discovered.filter((x) => x.transport === 'simulator')) {
      // Ventilateur et commandes simulés seulement si l'adaptateur correspondant est activé.
      if (d.id === 'simulator:headwind' && !exp.headwind) continue;
      if (d.id === 'simulator:click' && !exp.zwiftControllers) continue;
      if (d.id === 'simulator:dfly' && !exp.shimanoDfly) continue;
      await manager.connect(d, { persist: false }).catch(() => undefined);
    }
  };

  let showAllDevices = false;
  const hardware: HardwareApi = {
    manager,
    prefs: () => loadHardwarePrefs(),
    update: (change) => {
      updateHardwarePrefs(change);
      changed();
    },
    experimental: () => manager.experimental,
    setExperimental: (flags) => {
      manager.setExperimental(flags);
      log(`adaptateurs expérimentaux : ${JSON.stringify(manager.experimental)}`);
      changed();
    },
    calibrate: async () => {
      lastCalibration = undefined;
      await manager.startCalibration();
    },
    calibration: () => lastCalibration,
    calibrationSupport: () => manager.calibrationSupport(),
    details: () =>
      manager.summaries().map((s) => {
        const info = manager.device(s.id)?.info;
        return { ...s, ...(info?.firmware ? { firmware: info.firmware } : {}), ...(info?.model ? { model: info.model } : {}), ...(info?.manufacturer ? { manufacturer: info.manufacturer } : {}) };
      }),
    reconnect: (id) => {
      log(`reconnexion demandée : ${id}`);
      manager.reconnect(id);
    },
    get showAllDevices() {
      return showAllDevices;
    },
    set showAllDevices(v: boolean) {
      showAllDevices = v;
    },
    addDirconHost: (host) => {
      const h = host.trim();
      if (!h || !dircon) return;
      dircon.addManualDevice(h);
      updateHardwarePrefs((p) => {
        if (!p.dirconHosts.includes(h)) p.dirconHosts.push(h);
      });
      log(`Direct Connect ajouté à la main : ${h}`);
      changed();
    },
    isDesktop: isTauri(),
    log: () => journal.join('\n'),
    testFan: (percent) => manager.sendFan({ kind: 'speed', percent }),
    onChange: (cb) => listeners.push(cb),
  };

  const panel: DevicePanel = {
    list: () =>
      manager.summaries().map((d) => ({
        id: d.id,
        name: d.name,
        role: d.roles.map((r) => ROLE_LABEL[r]()).join(', ') || d.kinds.join(', '),
        roleIds: [...d.roles],
        kinds: [...d.kinds],
        simulated: d.transport === 'simulator',
        state: stateLabel(d.state),
        ...(d.battery !== undefined ? { detail: `🔋 ${d.battery} %` } : {}),
        ok: d.state === 'connected',
      })),
    transports: () => available.filter((k) => k !== 'simulator').map((id) => ({ id, label: TRANSPORT_LABEL[id] })),
    async pair(role, transport) {
      const kind = ROLE_KIND[role];
      const tr = transport as TransportKind;
      const needed = ROLE_ADAPTERS[role];
      const exp = manager.experimental;
      if (needed && !needed.some((k) => exp[k])) {
        throw new Error(
          role === 'fan'
            ? 'Activez d’abord l’adaptateur expérimental « KICKR HEADWIND » (Réglages avancés, plus bas).'
            : 'Activez d’abord l’adaptateur expérimental de votre commande (Zwift Click / Play / Ride, Di2 D-Fly, SRAM AXS…) dans les réglages avancés, plus bas. Clavier, manette et télécommande HID marchent sans appairage.',
        );
      }
      log(`appairage ${role} via ${tr}${showAllDevices ? ' (tous les appareils)' : ''}`);
      if (tr === 'web-bluetooth') {
        // Web Bluetooth : le navigateur affiche son sélecteur ; un seul appareil revient.
        await manager.scan({ kinds: [kind], transports: [tr], acceptAll: showAllDevices });
      } else {
        await manager.scan({ kinds: [kind], transports: [tr], timeoutMs: 5000 });
        await new Promise((r) => setTimeout(r, 5000));
        await manager.stopScan();
      }
      const candidates = manager.discovered.filter((d) => d.transport === tr && (d.kinds.includes(kind) || (tr === 'web-bluetooth' && showAllDevices)));
      log(`trouvés : ${candidates.map((d) => `${d.name} [${d.kinds.join(',')}] ${d.rssi ?? ''}`).join(' ; ') || 'aucun'}`);
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
    warnings: () => [...new Set(warnings.map((w) => w.message))],
    adapters: async () => (isTauri() ? manager.listAdapters() : []),
    selectAdapter: (id) => manager.selectAdapter(id),
    onChange: (cb) => listeners.push(cb),
    renderExtras: (el) => renderHardwarePanel(el, hardware),
  };

  return {
    panel,
    manager,
    source: () => {
      // Lissage 3 s : réglage du coureur (Réglages → Home trainer).
      const smooth = loadSettings().smoothing3s;
      if (manager.smoothingEnabled !== smooth) manager.setSmoothing(smooth);
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
  private readonly fan = new FanController(loadHardwarePrefs().fan);
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
      manager.on('shift', (s) => {
        if (s.realGear) this.inputs.realGear = { ...s.realGear };
        this.shiftCbs.forEach((cb) => cb(s.action));
      }),
      // Changement de mode du ventilateur dans le menu : appliqué tout de suite.
      onHardwarePrefs((p) => {
        this.fan.settings = p.fan;
        this.fan.reset();
      }),
      // Ventilateur reconnecté : renvoyer la consigne.
      manager.on('deviceState', ({ deviceId, state }) => {
        if (state === 'connected' && deviceId === manager.roles.fan) this.fan.reset();
      }),
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

  /** Consigne de l'appli compagnon : le ventilateur passe en manuel à ce pourcentage. */
  setFan(percent: number): void {
    updateHardwarePrefs((p) => {
      p.fan = { ...p.fan, mode: 'manual', manualPercent: Math.round(percent) };
    });
  }

  updateFan(ctx: { speedKmh: number; gradePercent: number; heartRateBpm?: number }): void {
    if (!this.manager.roles.fan) return;
    const pct = this.fan.update(ctx, performance.now());
    if (pct === undefined) return;
    const cmd = this.fan.settings.mode === 'off' ? ({ kind: 'mode', mode: 'off' } as const) : ({ kind: 'speed', percent: pct } as const);
    void this.manager.sendFan(cmd).catch(() => this.fan.reset());
  }

  onShift(cb: (a: ShiftAction) => void): void {
    this.shiftCbs.push(cb);
  }

  onWarning(cb: (message: string) => void): void {
    this.offs.push(this.manager.on('warning', (w) => cb(w.message)));
  }

  status(): Array<{ label: string; state: 'ok' | 'warn' | 'off' }> {
    const list = this.manager.summaries().map((d) => {
      // État affiché en clair hors « connecté » : reconnexion, muet, erreur… visibles pendant la sortie.
      // En tête du libellé : la puce du HUD tronque la fin des noms longs.
      const st = d.state === 'connected' ? '' : `${stateLabel(d.state).toUpperCase()} · `;
      return {
        label: `${st}${d.transport === 'simulator' ? `${t('simulator')} · ` : ''}${d.name}${d.transport === 'simulator' && d.kinds.includes('trainer') ? ` · ${this.sim.riderPowerW} W (+/−)` : ''}`,
        state: (d.state === 'connected' ? 'ok' : d.state === 'connecting' || d.state === 'reconnecting' || d.state === 'silent' ? 'warn' : 'off') as 'ok' | 'warn' | 'off',
      };
    });
    return list.length ? list : [{ label: t('noWebBluetooth'), state: 'off' }];
  }

  dispose(): void {
    this.offs.forEach((o) => o());
    window.removeEventListener('keydown', this.onKey);
  }
}
