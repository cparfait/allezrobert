/**
 * Adaptateurs OPTIONNELS et EXPÉRIMENTAUX : protocoles propriétaires décodés par la communauté.
 * Tous désactivés par défaut ; à activer explicitement dans les réglages (DeviceManager → experimental).
 * Risques : peuvent casser à une mise à jour de firmware, pas de garantie constructeur.
 */
export * from './protobuf.ts';
export * from './aes.ts';
export * from './zwift-controllers.ts';
export * from './zwift-zap.ts';
export * from './headwind.ts';
export * from './shimano-dfly.ts';
export * from './sram-axs.ts';
export * from './ant-controls.ts';

export interface ExperimentalAdapters {
  /** Zwift Click v1/v2, Play, Ride (boutons uniquement). */
  zwiftControllers: boolean;
  /** Wahoo KICKR HEADWIND en Bluetooth. */
  headwind: boolean;
  /** Shimano Di2 D-Fly en Bluetooth. */
  shimanoDfly: boolean;
  /** SRAM AXS : rapport engagé après appairage SRAMBond (bouton AXS maintenu), sinon clics anonymes. */
  sramAxs: boolean;
  /** Télécommandes ANT+ Controls (page 73). */
  antControls: boolean;
}

export const EXPERIMENTAL_ADAPTERS_DEFAULT: Readonly<ExperimentalAdapters> = Object.freeze({
  zwiftControllers: false,
  headwind: false,
  shimanoDfly: false,
  sramAxs: false,
  antControls: false,
});
