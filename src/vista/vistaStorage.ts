/**
 * Storage, registration, and CRUD for custom Ember Vista configurations.
 *
 * Custom vistas are stored in a world-level setting and registered at runtime
 * via CONFIG.Canvas.managedScenes + a monkey-patch on EmberVista._loadConfig.
 */

const MODULE_ID = "macro-autocomplete";
const SETTING_KEY = "customVistas";

// ── Type Definitions ────────────────────────────────────────────────────────

export interface PlacementConfig {
  x: number;
  y: number;
  elevation?: number;
  sort?: number;
  scaleX?: number;
  scaleY?: number;
  skewX?: number;
  skewY?: number;
  angle?: number;
  alpha?: number;
  tint?: string;
  illumination?: {
    luminosity?: number;
    only?: boolean;
    blurStrength?: number;
  } | null;
  colorize?: {
    texture?: string;
    r?: string;
    g?: string;
    b?: string;
  } | null;
}

export interface SpriteConfig {
  placements: PlacementConfig[];
  grounded?: boolean;
  restrictsLight?: boolean;
  restrictsWeather?: boolean;
  cycle?: Record<string, any>;
}

export interface LightConfig {
  x: number;
  y: number;
  elevation?: number;
  dim?: number;
  bright?: number;
  color?: string;
  alpha?: number;
  attenuation?: number;
  luminosity?: number;
  coloration?: number;
  animation?: { type: string; speed: number; intensity: number };
  darkness?: { min: number; max: number };
  exactSize?: boolean;
  cycle?: Record<string, any>;
}

export interface CompositionConfig {
  id: string;
  label: string;
  sprites?: Record<string, SpriteConfig>;
  lights?: Record<string, LightConfig>;
  filters?: Record<string, any>;
  geometryMeshes?: Record<string, any>;
  particles?: Record<string, any>;
  campsite?: boolean;
  skybox?: { enabled: boolean };
}

export interface VistaConfig {
  id: string;
  label: string;
  custom?: boolean;
  managerClass: string;
  spritesheets: Record<string, string | string[]>;
  dimensions: {
    canvas: { width: number; height: number };
    view: { width: number; height: number };
    initial?: { x: number; y: number };
  };
  tokens: {
    nearest: { elevation: number; y: number; scale: number };
    farthest: { elevation: number; y: number; scale: number };
    distancePixels?: number;
  };
  compositions: Record<string, CompositionConfig>;
  weather?: { elevation: number };
  soundscape?: any;
  skybox?: { enabled: boolean };
  spriteOptions?: Record<string, any>;
}

// ── Setting Registration ────────────────────────────────────────────────────

export function registerVistaSettings(): void {
  (game as any).settings.register(MODULE_ID, SETTING_KEY, {
    name: "Custom Vista Configurations",
    hint: "Stores user-created vista scene configurations",
    scope: "world",
    config: false,
    type: Object,
    default: {},
  });
}

// ── CRUD Functions ──────────────────────────────────────────────────────────

export function getCustomVistas(): Record<string, VistaConfig> {
  return (game as any).settings.get(MODULE_ID, SETTING_KEY) ?? {};
}

export function getCustomVista(id: string): VistaConfig | undefined {
  return getCustomVistas()[id];
}

export async function saveCustomVista(config: VistaConfig): Promise<void> {
  const all = getCustomVistas();
  config.custom = true;
  all[config.id] = config;
  await (game as any).settings.set(MODULE_ID, SETTING_KEY, all);
  // Ensure registered in CONFIG.Canvas.managedScenes
  const EmberVista = getEmberVistaClass();
  if (EmberVista) {
    CONFIG.Canvas.managedScenes[config.id] = EmberVista;
  }
}

export async function deleteCustomVista(id: string): Promise<void> {
  const all = getCustomVistas();
  delete all[id];
  await (game as any).settings.set(MODULE_ID, SETTING_KEY, all);
  // Only remove from managedScenes if not a built-in vista
  const builtIn = getBuiltinVistas();
  if (!builtIn[id]) {
    delete CONFIG.Canvas.managedScenes[id];
  }
}

// ── Built-in Vista Access ───────────────────────────────────────────────────

function getEmberVistaClass(): any {
  const ember = (globalThis as any).ember;
  return ember?.api?.canvas?.sceneManagers?.EmberVista;
}

export function getBuiltinVistas(): Record<string, VistaConfig> {
  const ember = (globalThis as any).ember;
  if (!ember?.scenes?.vistas) return {};
  // Return a shallow copy since the original is frozen
  return { ...ember.scenes.vistas };
}

export function getAllVistas(): Record<string, VistaConfig> {
  return { ...getBuiltinVistas(), ...getCustomVistas() };
}

export function getVista(id: string): VistaConfig | undefined {
  return getAllVistas()[id];
}

export function isCustomVista(id: string): boolean {
  return !!getCustomVistas()[id];
}

// ── Runtime Registration ────────────────────────────────────────────────────

let patched = false;

export function registerCustomVistas(): void {
  const EmberVista = getEmberVistaClass();
  if (!EmberVista) return;

  // Register all custom vistas in CONFIG.Canvas.managedScenes
  const customs = getCustomVistas();
  for (const id of Object.keys(customs)) {
    CONFIG.Canvas.managedScenes[id] = EmberVista;
  }

  // Monkey-patch _loadConfig to fall back to custom storage
  if (!patched) {
    const original = EmberVista.prototype._loadConfig;
    EmberVista.prototype._loadConfig = function (this: any) {
      const config = original.call(this);
      if (config) return config;
      const custom = getCustomVista(this.scene.id);
      if (custom) return custom;
      return undefined;
    };
    patched = true;
  }
}

// ── Default Config Factory ──────────────────────────────────────────────────

export function createBlankVistaConfig(id: string, label: string): VistaConfig {
  return {
    id,
    label,
    custom: true,
    managerClass: "EmberVista",
    spritesheets: {
      default: "",
    },
    dimensions: {
      canvas: { width: 3440, height: 1440 },
      view: { width: 3440, height: 1440 },
    },
    tokens: {
      nearest: { elevation: 0, y: 1440, scale: 1.0 },
      farthest: { elevation: -10, y: 500, scale: 0.5 },
    },
    compositions: {
      default: {
        id: "default",
        label: "Default",
        sprites: {},
        lights: {},
      },
    },
  };
}

export function duplicateVistaConfig(source: VistaConfig, newId: string, newLabel: string): VistaConfig {
  const clone = foundry.utils.deepClone(source) as VistaConfig;
  clone.id = newId;
  clone.label = newLabel;
  clone.custom = true;
  return clone;
}
