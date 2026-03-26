/**
 * Shared configuration for the Blockly visual editor.
 * This file has NO Blockly imports so it can be imported eagerly
 * by macro-autocomplete.ts without pulling in the Blockly bundle.
 *
 * Modules register category configs, block colours, and scope merge keys
 * via the macro-autocomplete API, which delegates to these functions.
 */

/** Colour hue map for top-level path segments. */
const colourMap: Record<string, number> = {
  // Foundry core
  game: 210,
  canvas: 180,
  ui: 160,
  Hooks: 290,
  CONST: 60,
  foundry: 200,
  CONFIG: 45,
  // Document classes
  Actor: 120,
  Item: 140,
  ChatMessage: 260,
  Roll: 330,
  Dialog: 300,
  Token: 100,
  Scene: 80,
  // Macro variables
  actor: 120,
  target: 290,
  token: 100,
  item: 140,
  speaker: 260,
  character: 120,
  args: 30,
  scope: 30,
  // dnd5e
  dnd5e: 150,
};

/** Get a Blockly colour hue based on the top-level path segment */
export function getColourForPath(path: string): number {
  const root = path.split(".")[0];
  return colourMap[root] ?? 230;
}

/**
 * Register additional colour hues for top-level path segments.
 */
export function registerBlockColours(colours: Record<string, number>): void {
  Object.assign(colourMap, colours);
}

/** Category keys whose blocks should be merged into the scope category. */
const scopeMergeKeys: string[] = [];

/** Get the current scope merge keys list */
export function getScopeMergeKeys(): readonly string[] {
  return scopeMergeKeys;
}

/**
 * Register category keys whose blocks should be merged into the scope toolbox category.
 */
export function registerScopeMergeKeys(keys: string[]): void {
  for (const key of keys) {
    if (!scopeMergeKeys.includes(key)) scopeMergeKeys.push(key);
  }
}

/** Display names and ordering for known top-level categories. */
const CATEGORY_CONFIG: Record<string, { display: string; colour: string; order: number; namespaceOnly?: boolean }> = {
  // Programming constructs
  _logic: { display: "Logic", colour: "#5b80a5", order: 0 },
  _variables: { display: "Variables", colour: "#a55b99", order: 1 },
  _control: { display: "Control Flow", colour: "#5ba580", order: 2 },
  _text: { display: "Text", colour: "#5ba55b", order: 3 },
  _util: { display: "Utilities", colour: "#a5805b", order: 4 },

  // Macro context (lowercase — these are variables available in macro scope)
  character: { display: "character", colour: "#457b9d", order: 11 },
  speaker: { display: "speaker", colour: "#9b59b6", order: 12 },
  actor: { display: "actor", colour: "#457b9d", order: 14 },
  token: { display: "token", colour: "#2a9d8f", order: 15 },
  _token: { display: "_token", colour: "#2a9d8f", order: 15 },
  item: { display: "item", colour: "#6a994e", order: 16 },
  args: { display: "args", colour: "#e9c46a", order: 21 },
  scope: { display: "scope", colour: "#e9c46a", order: 22 },

  // Foundry core (lowercase — these are globals)
  game: { display: "game", colour: "#457b9d", order: 40 },
  canvas: { display: "canvas", colour: "#2a9d8f", order: 41, namespaceOnly: true },
  ui: { display: "ui", colour: "#6a994e", order: 42 },
  Hooks: { display: "Hooks", colour: "#9b59b6", order: 43 },
  foundry: { display: "foundry", colour: "#457b9d", order: 44, namespaceOnly: true },
  CONFIG: { display: "CONFIG", colour: "#e9c46a", order: 45 },
  CONST: { display: "Constants", colour: "#e9c46a", order: 46 },

  // Document classes
  ChatMessage: { display: "Chat Messages", colour: "#9b59b6", order: 50 },
  Roll: { display: "Rolls", colour: "#e74c3c", order: 51 },
  Dialog: { display: "Dialogs", colour: "#8e44ad", order: 52 },
  Actor: { display: "Actor Class", colour: "#457b9d", order: 53 },
  Item: { display: "Item Class", colour: "#6a994e", order: 54 },

  // dnd5e
  dnd5e: { display: "dnd5e System", colour: "#2a9d8f", order: 60 },
};

/** Get the category config for a given key */
export function getCategoryConfig(key: string): { display: string; colour: string; order: number; namespaceOnly?: boolean } | undefined {
  return CATEGORY_CONFIG[key];
}

/** Get the full category config map (for toolbox building) */
export function getAllCategoryConfigs(): Record<string, { display: string; colour: string; order: number; namespaceOnly?: boolean }> {
  return CATEGORY_CONFIG;
}

/**
 * Register additional category configurations for the Blockly toolbox.
 */
export function registerCategoryConfigs(
  configs: Record<string, { display: string; colour: string; order: number; namespaceOnly?: boolean }>
): void {
  Object.assign(CATEGORY_CONFIG, configs);
}

/**
 * Check if a root key is configured as namespace-only.
 * When true, the parser should prefer namespace blocks over individual blocks.
 */
export function isNamespaceOnly(rootKey: string): boolean {
  return CATEGORY_CONFIG[rootKey]?.namespaceOnly === true;
}
