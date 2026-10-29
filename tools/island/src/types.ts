import type { Vec2 } from './design.ts';

export interface Building {
  id: string;
  kind: string;
  height: number;
  levels: number;
  roof: { shape: string; height: number; material?: string; colour?: string };
  pts: Vec2[];
  y: number;
  name?: string;
  colour?: string;
  material?: string;
}

export interface Area {
  id: string;
  kind: string;
  layer: 'forests' | 'fields' | 'landuse';
  ring: Vec2[];
  name?: string;
}

export interface Place {
  name: string;
  kind: string;
  x: number;
  z: number;
}
