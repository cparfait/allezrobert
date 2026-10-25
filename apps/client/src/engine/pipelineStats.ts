/**
 * Compte les pipelines de rendu créés par le moteur WebGPU. Un pipeline créé « en direct »
 * (`createRenderPipeline`) fait compiler son shader par le processus GPU pendant la partie : l'image
 * suivante attend, de 60 ms à 2 s (voir docs/ETUDE_PERFORMANCE.md). En sortie, ce nombre doit
 * rester à 0 : tout est compilé à l'avance (`createRenderPipelineAsync`, sur des fils à part).
 */
export const pipelineStats = {
  /** Pipelines compilés en direct (bloquants) depuis le lancement. */
  sync: 0,
  /** Pipelines compilés à l'avance, sans bloquer l'affichage. */
  async: 0,
  /** Pipelines en direct depuis le départ de la sortie (objectif : 0). */
  syncInRide: 0,
  /** Pipelines en direct pendant l'image en cours (étiquette des saccades du panneau F3). */
  frameSync: 0,
  inRide: false,
  /** Objets mis en attente de compilation / compilés avant leur premier affichage. */
  prepared: 0,
  pending: 0,
};

/** Branche les compteurs sur le device WebGPU (sans effet sur le rendu). */
export function instrumentDevice(device: GPUDevice): void {
  // Méthodes du prototype relues à chaque appel : les outils de mesure qui l'enveloppent restent branchés.
  const proto = Object.getPrototypeOf(device) as GPUDevice;
  device.createRenderPipeline = (d: GPURenderPipelineDescriptor) => {
    pipelineStats.sync++;
    pipelineStats.frameSync++;
    if (pipelineStats.inRide) pipelineStats.syncInRide++;
    return proto.createRenderPipeline.call(device, d);
  };
  device.createRenderPipelineAsync = (d: GPURenderPipelineDescriptor) => {
    pipelineStats.async++;
    return proto.createRenderPipelineAsync.call(device, d);
  };
}
