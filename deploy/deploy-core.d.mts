export interface DeployConfig {
  host: string;
  port: number;
  key: string;
  repo: string;
  url: string;
}
export type RemoteState = { ok: true; branch: string; head: string; zones: Record<string, string>; menu: number } | { ok: false; error: string };
export interface LocalZone {
  id: string;
  version: string;
  bytes: number;
}
export interface LocalGit {
  branch: string;
  last: string;
  dirty: number;
  worldsDirty: number;
  ahead: number | null;
}
export const configFile: string;
export const DRY: boolean;
export function loadConfig(): DeployConfig;
export function validConfig(c: DeployConfig): boolean;
export function saveConfig(b: Record<string, unknown>): { ok: boolean; error?: string };
export function localZones(): LocalZone[];
export function localGit(): Promise<LocalGit>;
export function remoteState(c: DeployConfig): Promise<RemoteState>;
export function job(action: string, body: Record<string, unknown>, emit: (line: string) => void): Promise<number>;
