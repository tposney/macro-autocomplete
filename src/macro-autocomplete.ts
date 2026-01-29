/**
 * CodeMirror autocompletion for Foundry VTT macros
 *
 * Hooks into Foundry's code-mirror elements and injects custom completions
 * for Foundry core API, dnd5e system, and extensible module completions.
 *
 * Strategy: Access the EditorView via CodeMirror's internal DOM properties,
 * then use StateEffect.appendConfig (obtained via EditorView.scrollIntoView)
 * to dynamically inject a completion source via the languageData facet.
 *
 * Completions are context-aware: typing "game." shows sub-properties,
 * typing "actor.system." shows schema-walked fields.
 *
 * Signature hints: when "(" is typed after a known function/method, a tooltip
 * shows the parameter signature with the current parameter highlighted.
 *
 * Completion sources:
 * 1. Runtime global introspection (foundry.utils, game, canvas, ui, Hooks, CONST, system globals, etc.)
 * 2. foundryCompletions.json - generated from fvtt-types at build time (static/instance member separation)
 * 3. dnd5e DataModel schemas - walked at runtime (if dnd5e is installed)
 * 4. Module-injected completions via "macro-autocomplete.ready" hook
 */

// Import generated completions from fvtt-types (run: node scripts/generateFoundryCompletions.js)
import foundryCompletions from "./lib/foundryCompletions.json";

// Completion tree: each node has children (next segments) or is a leaf with type/detail/info
interface CompletionEntry {
  type?: string;
  detail?: string;
  info?: string;
  children?: CompletionNode;          // Structural sub-properties (schema data, sub-objects, namespaces)
  staticChildren?: CompletionNode;    // Static class members (e.g., Actor.create)
  instanceChildren?: CompletionNode;  // Instance members (e.g., actor.update)
  constructorDetail?: string; // e.g. "(formula, data?) => Roll" - for signature hints on `new ClassName(`
  returnType?: string; // Class name whose instanceChildren to use for the return value
}

interface CompletionNode {
  [key: string]: CompletionEntry;
}

// Use let so we can augment with schema-generated completions at runtime
let COMPLETION_TREE: CompletionNode = {
  foundry: {
    type: "object", detail: "object", info: "Foundry VTT core namespace",
    children: {
      utils: {
        type: "object", detail: "object", info: "Foundry utility functions (populated at runtime)",
        children: {}
      }
    }
  },

  // ── Core macro variables from Foundry's Macro#executeScript ──
  // These are always available in script macros
  // Instance methods populated at runtime by injectPrototypeCompletions()

  speaker: {
    type: "variable", detail: "SpeakerData", info: "Chat speaker data (always available in macros via Macro#executeScript)",
    children: {}
  },

  character: {
    type: "variable", detail: "Actor | null", info: "The current user's assigned character (game.user.character)",
    children: {}
  },

  token: {
    type: "variable", detail: "Token", info: "Token instance (always available in macros via Macro#executeScript)",
    children: {}
  },

  actor: {
    type: "variable", detail: "Actor", info: "Actor instance (always available in macros via Macro#executeScript)",
    children: {
      // Root document properties populated at runtime from document schema
      // system children populated at runtime by injectSchemaCompletions()
      system: {
        type: "property", detail: "object", info: "Actor system data (populated from system schema)",
        children: {}
      },
    }
  },

  item: {
    type: "variable", detail: "Item", info: "Item instance (available in macros via scope)",
    children: {
      system: {
        type: "property", detail: "object", info: "Item system data (populated from system schema)",
        children: {}
      },
    }
  },

  // Common macro variables
  args: {
    type: "variable", detail: "any[]", info: "Macro arguments array",
    children: {
      "0": { type: "property", detail: "any", info: "First argument" },
    }
  },

  scope: {
    type: "variable", detail: "object", info: "Macro scope object (additional named params spread from scope are also available as top-level variables)",
    children: {}
  },

  // CONFIG children populated at runtime by injectConfigCompletions()
  CONFIG: {
    type: "object", detail: "object", info: "Global Foundry configuration object (populated at runtime)",
    children: {}
  },
};

// ── Schema walking for system DataModels ──

/**
 * Convert a Foundry DataField to a completion node.
 * Recursively walks SchemaField children.
 */
function fieldToCompletionNode(field: any, fieldName: string): { type?: string; detail?: string; info?: string; children?: CompletionNode } {
  const fieldType = field.constructor?.name ?? "unknown";
  const label = field.label ?? fieldName;
  const hint = field.hint ?? "";

  // Determine the detail string based on field type
  let detail = "any";
  let nodeType = "property";

  if (fieldType === "StringField") {
    detail = "string";
  } else if (fieldType === "NumberField") {
    detail = "number";
  } else if (fieldType === "BooleanField") {
    detail = "boolean";
  } else if (fieldType === "ArrayField") {
    const elementType = field.element?.constructor?.name ?? "any";
    detail = `${elementType}[]`;
  } else if (fieldType === "SetField") {
    const elementType = field.element?.constructor?.name ?? "string";
    detail = `Set<${elementType === "StringField" ? "string" : elementType}>`;
  } else if (fieldType === "SchemaField" || fieldType === "EmbeddedDataField") {
    detail = "object";
  } else if (fieldType === "ObjectField") {
    detail = "object";
  } else if (fieldType === "HTMLField") {
    detail = "string (HTML)";
  } else if (fieldType === "IntegerSortField") {
    detail = "number";
  } else if (fieldType === "DocumentIdField" || fieldType === "ForeignDocumentField") {
    detail = "string (ID)";
  } else if (fieldType === "FilePathField") {
    detail = "string (path)";
  } else if (fieldType === "ColorField") {
    detail = "string (color)";
  } else if (fieldType === "JSONField") {
    detail = "object (JSON)";
  } else if (fieldType === "TypeDataField") {
    detail = "object";
  } else if (fieldType === "MappingField") {
    detail = "object";
  }

  const info = hint || (label !== fieldName ? label : "");

  const node: { type?: string; detail?: string; info?: string; children?: CompletionNode } = {
    type: nodeType,
    detail,
    info: info || undefined,
  };

  // Recursively process children for SchemaField and its subclasses
  // (SimpleTraitField, DamageTraitField, RollConfigField, etc. all extend SchemaField)
  if (field.fields && typeof field.fields === "object" && fieldType !== "MappingField") {
    const children: CompletionNode = {};
    for (const [childName, childField] of Object.entries(field.fields)) {
      children[childName] = fieldToCompletionNode(childField, childName);
    }
    if (Object.keys(children).length > 0) {
      node.children = children;
    }
  }

  // For MappingField, try to enumerate the actual keys and attach the inner model schema to each
  if (fieldType === "MappingField") {
    // Build inner schema children (the structure each key's value has)
    // MappingField stores inner DataField as this.model; SchemaField stores sub-fields at .fields
    let innerChildren: CompletionNode | undefined;
    const innerFields = field.model?.fields;
    if (innerFields && typeof innerFields === "object") {
      innerChildren = {};
      for (const [childName, childField] of Object.entries(innerFields)) {
        innerChildren[childName] = fieldToCompletionNode(childField, childName);
      }
      if (Object.keys(innerChildren).length === 0) innerChildren = undefined;
    }

    // Try to get the actual keys from initialKeys
    let keys: string[] | undefined;
    if (field.initialKeys) {
      if (Array.isArray(field.initialKeys)) {
        keys = field.initialKeys;
      } else if (typeof field.initialKeys === "object") {
        keys = Object.keys(field.initialKeys);
      }
    }

    if (keys && keys.length > 0) {
      // Create a child entry for each known key with the inner schema as its children
      const children: CompletionNode = {};
      for (const key of keys) {
        const keyLabel = field.initialKeys?.[key]?.label ?? field.initialKeys?.[key] ?? key;
        const keyInfo = typeof keyLabel === "string" && keyLabel !== key ? keyLabel : undefined;
        children[key] = {
          type: "property",
          detail: innerChildren ? "object" : "any",
          info: keyInfo,
          children: innerChildren ? JSON.parse(JSON.stringify(innerChildren)) : undefined,
        };
      }
      node.children = children;
    } else if (innerChildren) {
      // No known keys - fall back to showing the inner structure directly
      node.children = innerChildren;
      node.info = (node.info || "") + " (keyed by ID)";
    }
  }

  return node;
}

/**
 * Walk a DataModel schema and generate a CompletionNode tree.
 */
function schemaToCompletions(schema: any): CompletionNode {
  const result: CompletionNode = {};

  if (!schema?.fields) return result;

  for (const [fieldName, field] of Object.entries(schema.fields)) {
    result[fieldName] = fieldToCompletionNode(field, fieldName);
  }

  return result;
}

/**
 * Merge a set of completions into a target node's children.
 * Creates the children object if it doesn't exist.
 */
function mergeCompletions(target: { children?: CompletionNode }, additions: CompletionNode): void {
  if (!target.children) {
    target.children = {};
  }
  for (const [key, value] of Object.entries(additions)) {
    if (!(key in target.children)) {
      // New entry — add it
      target.children[key] = value;
    } else {
      const existing = target.children[key];
      // Enrich existing entry if the addition has better type info
      if (value.detail && existing.detail) {
        const existingIsWeak = existing.detail === "any" || existing.detail === "object"
          || existing.detail === "Promise<any>" || existing.detail === "any | null";
        const additionIsStrong = value.detail !== "any" && value.detail !== "object"
          && value.detail !== "Promise<any>" && value.detail !== "any | null";
        if (existingIsWeak && additionIsStrong) {
          existing.detail = value.detail;
        }
      }
      // Copy info if the existing entry lacks it
      if (value.info && !existing.info) {
        existing.info = value.info;
      }
      // Copy constructorDetail if the existing entry lacks it
      if (value.constructorDetail && !existing.constructorDetail) {
        existing.constructorDetail = value.constructorDetail;
      }
      // Copy returnType if the existing entry lacks it
      if (value.returnType && !existing.returnType) {
        existing.returnType = value.returnType;
      }
      // Recursively merge children
      if (value.children) {
        mergeCompletions(existing, value.children);
      }
    }
  }
}

/**
 * Inject schema-generated completions for system actors and items.
 * Uses CONFIG.Actor.dataModels and CONFIG.Item.dataModels which are
 * generic Foundry structures (Record<string, TypeDataModel>) populated
 * by whichever game system is active. Works with dnd5e, pf2e, etc.
 */
let _schemaInjected = false;
function injectSchemaCompletions(): void {
  if (_schemaInjected) return;

  const cfg = (globalThis as any).CONFIG;
  if (!cfg) {
    console.log("macro-autocomplete | CONFIG not available, skipping schema injection");
    return;
  }

  const initStart = performance.now();
  console.log("macro-autocomplete | Injecting schema-generated completions from system DataModels");

  try {
    // Walk CONFIG.Actor.dataModels - merges all actor type schemas for comprehensive coverage
    const actorDataModels = cfg.Actor?.dataModels;
    if (actorDataModels && typeof actorDataModels === "object" && COMPLETION_TREE.actor?.children?.system) {
      let count = 0;
      for (const [typeName, DataModel] of Object.entries(actorDataModels) as [string, any][]) {
        if (DataModel?.schema) {
          const schemaCompletions = schemaToCompletions(DataModel.schema);
          mergeCompletions(COMPLETION_TREE.actor.children.system, schemaCompletions);
          // Also populate character.system (character is also an Actor)
          if (COMPLETION_TREE.character?.children?.system) {
            mergeCompletions(COMPLETION_TREE.character.children.system, schemaCompletions);
          }
          count++;
        }
      }
      if (count > 0) {
        console.log(`macro-autocomplete | Injected actor system schema completions (${count} types)`);
      }
    }

    // Walk CONFIG.Item.dataModels - merges all item type schemas
    const itemDataModels = cfg.Item?.dataModels;
    if (itemDataModels && typeof itemDataModels === "object" && COMPLETION_TREE.item?.children?.system) {
      let count = 0;
      for (const [typeName, DataModel] of Object.entries(itemDataModels) as [string, any][]) {
        if (DataModel?.schema) {
          const schemaCompletions = schemaToCompletions(DataModel.schema);
          mergeCompletions(COMPLETION_TREE.item.children.system, schemaCompletions);
          count++;
        }
      }
      if (count > 0) {
        console.log(`macro-autocomplete | Injected item system schema completions (${count} types)`);
      }
    }

    // Walk base document schemas for root-level properties (name, img, type, items, effects, etc.)
    // These are distinct from system-specific dataModel schemas which only populate actor.system/item.system
    const documentSchemaTargets: Array<{ configKey: string; treeKeys: string[]; label: string }> = [
      { configKey: "Actor", treeKeys: ["actor", "character"], label: "Actor" },
      { configKey: "Item", treeKeys: ["item"], label: "Item" },
    ];

    for (const { configKey, treeKeys, label } of documentSchemaTargets) {
      try {
        const docClass = cfg[configKey]?.documentClass;
        const schema = docClass?.schema;
        if (!schema) continue;

        const rootCompletions = schemaToCompletions(schema);
        // Remove "system" from root completions — it's already populated more comprehensively
        // from the individual dataModel schemas above
        delete rootCompletions.system;

        if (Object.keys(rootCompletions).length > 0) {
          for (const treeKey of treeKeys) {
            const target = COMPLETION_TREE[treeKey];
            if (target) {
              mergeCompletions(target, rootCompletions);
            }
          }
          console.log(`macro-autocomplete | Injected ${Object.keys(rootCompletions).length} root document properties for ${label}`);
        }
      } catch (err) {
        console.warn(`macro-autocomplete | Error walking ${label} document schema:`, err);
      }
    }

    // Supplement schema completions with runtime-derived properties.
    // Many systems compute properties during prepareDerivedData() that aren't in schemas
    // (e.g., actor.system.attributes.ac.value, .base, .shield, .bonus).
    // Construct temporary in-memory documents for each type — this triggers prepareData()
    // which populates derived properties without needing actual world instances.
    try {
      const ActorCls = cfg.Actor?.documentClass;
      if (ActorCls && actorDataModels && COMPLETION_TREE.actor?.children?.system) {
        let count = 0;
        for (const typeName of Object.keys(actorDataModels)) {
          try {
            const temp = new ActorCls({ name: "_mac_tmp", type: typeName });
            if (temp.system) {
              const runtimeCompletions = objectToCompletions(temp.system, 4);
              mergeCompletions(COMPLETION_TREE.actor.children.system, runtimeCompletions);
              if (COMPLETION_TREE.character?.children?.system) {
                mergeCompletions(COMPLETION_TREE.character.children.system, runtimeCompletions);
              }
              count++;
            }
          } catch { /* some types may fail without required data */ }
        }
        if (count > 0) {
          console.log(`macro-autocomplete | Supplemented actor.system with derived data (${count} types)`);
        }
      }

      const ItemCls = cfg.Item?.documentClass;
      if (ItemCls && itemDataModels && COMPLETION_TREE.item?.children?.system) {
        let count = 0;
        for (const typeName of Object.keys(itemDataModels)) {
          try {
            const temp = new ItemCls({ name: "_mac_tmp", type: typeName });
            if (temp.system) {
              mergeCompletions(COMPLETION_TREE.item.children.system, objectToCompletions(temp.system, 4));
              count++;
            }
          } catch { /* some types may fail without required data */ }
        }
        if (count > 0) {
          console.log(`macro-autocomplete | Supplemented item.system with derived data (${count} types)`);
        }
      }
    } catch (err) {
      console.warn("macro-autocomplete | Error supplementing schema with derived data:", err);
    }

    _schemaInjected = true;

    // Walk globals at runtime: foundry.utils, game, canvas, ui, Hooks, CONST, etc.
    // These discover methods/properties with generic "any" types.
    injectGlobalCompletions();

    // Walk foundry namespaces (documents, applications) for class entries
    injectFoundryNamespaceCompletions();

    // Inject instance methods from runtime class prototypes (system-specific)
    injectPrototypeCompletions();

    // Enrich with fvtt-types generated completions (build-time typed data).
    // Runs after runtime discovery so it can upgrade "any" types to proper types.
    injectFoundryCompletions();

    // Inject CONFIG completions from runtime
    injectConfigCompletions();

    // Rebuild signature map with new completions
    rebuildSignatureMap();

    // Build the public API object
    const api = {
      tree: COMPLETION_TREE,
      rebuildSignatureMap,
      schemaToCompletions,
      mergeCompletions,
      classToCompletions,
      objectToCompletions,
      valueToCompletionEntry,
      fieldToCompletionNode,
    };

    // Expose as module API (game.modules.get("macro-autocomplete").api)
    const mod = (game as any).modules?.get("macro-autocomplete");
    if (mod) mod.api = api;

    // Fire ready hook so other modules can inject their completions
    (Hooks as any).callAll("macro-autocomplete.ready", api);

    const elapsed = (performance.now() - initStart).toFixed(1);

    console.log(`macro-autocomplete | Initialization complete in ${elapsed}ms`);

  } catch (err) {
    console.error("macro-autocomplete | Error injecting schema completions:", err);
  }
}

/**
 * Inject completions generated from fvtt-types at build time.
 * These provide Foundry core types like Actor, Item, Roll, Dialog, Hooks, etc.
 *
 * The generated JSON separates static vs instance members:
 * - staticChildren: methods/properties on the class itself (e.g., Actor.create)
 * - instanceChildren: methods/properties on instances (e.g., actor.update)
 * - instancePath: if set, where to route instance members (e.g., "actor" for Actor)
 * - constructorDetail: constructor signature for `new ClassName()` hints
 */
function injectFoundryCompletions(): void {
  if (!foundryCompletions || typeof foundryCompletions !== "object") {
    console.log("macro-autocomplete | foundryCompletions not available");
    return;
  }

  console.log("macro-autocomplete | Injecting fvtt-types generated completions");

  // Map class names to tree paths where their instance members should be merged.
  // This routes typed instance members from the JSON to the runtime globals.
  // Entries with dots navigate into nested tree paths (e.g., "game.settings").
  const instanceTargets: Record<string, string[]> = {
    Canvas: ["canvas"],
    Game: ["game"],
    ClientSettings: ["game.settings"],
    Localization: ["game.i18n"],
    Notifications: ["ui.notifications"],
    Actor: ["actor", "character"],
    Item: ["item"],
    Token: ["token"],
  };

  try {
    for (const [typeName, typeEntry] of Object.entries(foundryCompletions)) {
      const entry = typeEntry as {
        type?: string; detail?: string; info?: string;
        staticChildren?: CompletionNode; instanceChildren?: CompletionNode;
        children?: CompletionNode; // legacy format fallback
        instancePath?: string;
        constructorDetail?: string;
      };

      const staticChildren = entry.staticChildren || {};
      const instanceChildren = entry.instanceChildren || {};
      // Legacy format: if only "children" exists, treat all as static (class-level)
      const legacyChildren = entry.children || {};
      const hasNewFormat = entry.staticChildren || entry.instanceChildren;

      // Merge static members into the class entry's staticChildren (e.g., Actor.create)
      const classMembers = hasNewFormat ? staticChildren : legacyChildren;
      if (Object.keys(classMembers).length > 0) {
        if (!COMPLETION_TREE[typeName]) {
          COMPLETION_TREE[typeName] = { type: entry.type || "class", detail: entry.detail || typeName };
        }
        if (!COMPLETION_TREE[typeName].staticChildren) {
          COMPLETION_TREE[typeName].staticChildren = {};
        }
        mergeCompletions({ children: COMPLETION_TREE[typeName].staticChildren }, classMembers);
      }

      // Apply constructor detail to the class entry
      if (entry.constructorDetail) {
        if (!COMPLETION_TREE[typeName]) {
          COMPLETION_TREE[typeName] = { type: entry.type || "class", detail: entry.detail || typeName };
        }
        COMPLETION_TREE[typeName].constructorDetail = entry.constructorDetail;
      }

      // Store instance members on the class entry for type inference (e.g., r = new Roll() → r.xxx)
      if (Object.keys(instanceChildren).length > 0) {
        if (!COMPLETION_TREE[typeName]) {
          COMPLETION_TREE[typeName] = { type: entry.type || "class", detail: entry.detail || typeName };
        }
        if (!COMPLETION_TREE[typeName].instanceChildren) {
          COMPLETION_TREE[typeName].instanceChildren = {};
        }
        mergeCompletions({ children: COMPLETION_TREE[typeName].instanceChildren }, instanceChildren);
      }

      // Merge instance members into known runtime globals
      if (Object.keys(instanceChildren).length > 0) {
        // Collect all target paths for this type
        const targets: string[] = [];
        // From the JSON's own instancePath field
        if (entry.instancePath) targets.push(entry.instancePath);
        // From our mapping table
        if (instanceTargets[typeName]) {
          for (const t of instanceTargets[typeName]) {
            if (!targets.includes(t)) targets.push(t);
          }
        }

        for (const targetPath of targets) {
          // Navigate dotted paths (e.g. "game.settings")
          const parts = targetPath.split(".");
          let node: CompletionEntry | undefined = COMPLETION_TREE[parts[0]];
          for (let i = 1; i < parts.length && node; i++) {
            node = node.children?.[parts[i]];
          }
          if (node) {
            if (!node.instanceChildren) node.instanceChildren = {};
            mergeCompletions({ children: node.instanceChildren }, instanceChildren);
          }
        }
      }
    }

    console.log(`macro-autocomplete | Merged ${Object.keys(foundryCompletions).length} foundry type completions`);
  } catch (err) {
    console.error("macro-autocomplete | Error injecting foundry completions:", err);
  }
}

/**
 * Result of walking a class for both static and instance members.
 */
interface ClassCompletions {
  staticChildren: CompletionNode;
  instanceChildren: CompletionNode;
  constructorDetail?: string;
}

/**
 * Walk a class and extract both static members (on the constructor chain)
 * and instance members (on the prototype chain) as completions.
 *
 * Replaces the old separate `prototypeToCompletions` and `classStaticsToCompletions` functions.
 *
 * Static chain: cls → parent → ... → stop at Function.prototype/Object
 * Instance chain: cls.prototype → parent prototype → ... → stop at Object.prototype
 */
function classToCompletions(cls: any): ClassCompletions {
  const result: ClassCompletions = {
    staticChildren: {},
    instanceChildren: {},
  };

  if (!cls || typeof cls !== "function") return result;

  const staticSkipNames = new Set([
    "name", "length", "prototype", "caller", "arguments",
    "toString", "valueOf", "hasOwnProperty", "isPrototypeOf",
    "propertyIsEnumerable", "toLocaleString", "constructor",
  ]);

  const instanceSkipNames = new Set([
    "constructor", "toString", "valueOf", "toJSON", "toLocaleString",
    "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
    "then", "catch", "finally",
  ]);

  /** Extract a completion entry from a property descriptor, or null to skip. */
  function extractMember(descriptor: PropertyDescriptor): CompletionEntry | null {
    if (typeof descriptor.value === "function") {
      const fn = descriptor.value;
      const fnStr = fn.toString();
      const match = fnStr.match(/^(?:async\s+)?(?:function\s*\w*\s*)?(\([^)]*\))|^(?:async\s+)?(\([^)]*\))\s*=>|^(?:async\s+)?\w+\s*(\([^)]*\))/);
      const params = match ? (match[1] || match[2] || match[3] || "()") : "()";
      const isAsync = fnStr.trimStart().startsWith("async");
      const returnHint = isAsync ? "Promise<any>" : "any";
      return { type: "method", detail: `${params} => ${returnHint}` };
    } else if (descriptor.get && !descriptor.set) {
      // Read-only getter — treat as a property
      return { type: "property", detail: "any" };
    } else if (descriptor.get && descriptor.set) {
      // Getter+setter pair (likely libWrapper interception) — skip to find real definition deeper
      return null;
    }
    return null;
  }

  // Walk static members on the class chain
  let current = cls;
  while (current && current !== Function.prototype && current !== Object) {
    for (const name of Object.getOwnPropertyNames(current)) {
      if (name.startsWith("_") || name.startsWith("#")) continue;
      if (staticSkipNames.has(name)) continue;
      if (result.staticChildren[name]) continue; // already found on a more specific class

      try {
        const descriptor = Object.getOwnPropertyDescriptor(current, name);
        if (!descriptor) continue;
        const entry = extractMember(descriptor);
        if (entry) result.staticChildren[name] = entry;
      } catch { /* skip inaccessible properties */ }
    }
    current = Object.getPrototypeOf(current);
  }

  // Walk instance members on the prototype chain
  if (cls.prototype) {
    let proto = cls.prototype;
    while (proto && proto !== Object.prototype) {
      for (const name of Object.getOwnPropertyNames(proto)) {
        if (name.startsWith("_") || name.startsWith("#")) continue;
        if (instanceSkipNames.has(name)) continue;
        if (result.instanceChildren[name]) continue; // already found on a more specific prototype

        try {
          const descriptor = Object.getOwnPropertyDescriptor(proto, name);
          if (!descriptor) continue;
          const entry = extractMember(descriptor);
          if (entry) result.instanceChildren[name] = entry;
        } catch { /* skip properties that throw on access */ }
      }
      proto = Object.getPrototypeOf(proto);
    }
  }

  // Extract constructor detail
  try {
    const ctorStr = cls.toString();
    const ctorMatch = ctorStr.match(/constructor\s*\(([^)]*)\)/);
    if (ctorMatch) {
      result.constructorDetail = `(${ctorMatch[1].trim()}) => ${cls.name || "object"}`;
    }
  } catch { /* ignore */ }

  return result;
}

/**
 * Inject instance methods from runtime class prototypes into macro variable entries.
 * This dynamically discovers methods from the current system's document classes
 * (e.g., dnd5e's Actor5e, Item5e) so completions are always accurate.
 *
 * Uses classToCompletions() to get both static and instance members in one call.
 * Instance members go into variable entries' instanceChildren (e.g., actor.instanceChildren).
 * Both static and instance members are stored on class entries (e.g., Actor.staticChildren, Actor.instanceChildren).
 *
 * Also populates plain-data entries (like speaker) from runtime samples.
 */
function injectPrototypeCompletions(): void {
  const cfg = (globalThis as any).CONFIG;
  if (!cfg) return;

  // Unified class config — each entry can target variable entries and/or a class entry
  const classConfig: Array<{
    configPath: string;
    variableKeys?: string[];  // tree keys for variable entries (get instanceChildren)
    classKey?: string;        // tree key for class entry (gets static + instance)
    label: string;
  }> = [
    { configPath: "Actor.documentClass", variableKeys: ["actor", "character"], classKey: "Actor", label: "Actor" },
    { configPath: "Item.documentClass", variableKeys: ["item"], classKey: "Item", label: "Item" },
    { configPath: "Token.objectClass", variableKeys: ["token"], classKey: "Token", label: "Token" },
    { configPath: "ChatMessage.documentClass", classKey: "ChatMessage", label: "ChatMessage" },
    { configPath: "ActiveEffect.documentClass", classKey: "ActiveEffect", label: "ActiveEffect" },
    { configPath: "Scene.documentClass", classKey: "Scene", label: "Scene" },
    { configPath: "Combat.documentClass", classKey: "Combat", label: "Combat" },
    { configPath: "Combatant.documentClass", classKey: "Combatant", label: "Combatant" },
    { configPath: "User.documentClass", classKey: "User", label: "User" },
    { configPath: "Folder.documentClass", classKey: "Folder", label: "Folder" },
    { configPath: "TokenDocument.documentClass", classKey: "TokenDocument", label: "TokenDocument" },
  ];

  for (const { configPath, variableKeys, classKey, label } of classConfig) {
    try {
      const parts = configPath.split(".");
      let cls: any = cfg;
      for (const p of parts) cls = cls?.[p];
      if (!cls?.prototype) continue;

      const walked = classToCompletions(cls);

      // Store instance members on variable entries (e.g., actor, token)
      if (variableKeys) {
        for (const treeKey of variableKeys) {
          const target = COMPLETION_TREE[treeKey];
          if (!target) continue;
          if (!target.instanceChildren) target.instanceChildren = {};
          mergeCompletions({ children: target.instanceChildren }, walked.instanceChildren);
          console.log(`macro-autocomplete | Injected ${Object.keys(walked.instanceChildren).length} instance members for ${label} → ${treeKey}`);
        }
      }

      // Store on class entry
      if (classKey) {
        const classEntry = COMPLETION_TREE[classKey];
        if (!classEntry) continue;
        if (Object.keys(walked.instanceChildren).length > 0) {
          if (!classEntry.instanceChildren) classEntry.instanceChildren = {};
          mergeCompletions({ children: classEntry.instanceChildren }, walked.instanceChildren);
        }
        if (Object.keys(walked.staticChildren).length > 0) {
          if (!classEntry.staticChildren) classEntry.staticChildren = {};
          mergeCompletions({ children: classEntry.staticChildren }, walked.staticChildren);
        }
        if (walked.constructorDetail && !classEntry.constructorDetail) {
          classEntry.constructorDetail = walked.constructorDetail;
        }
      }
    } catch (err) {
      console.warn(`macro-autocomplete | Error injecting prototype completions for ${label}:`, err);
    }
  }

  // Global classes not in CONFIG (Roll, Dialog, DialogV2)
  const g = globalThis as any;
  for (const className of ["Roll", "Dialog", "DialogV2"]) {
    try {
      const cls = g[className];
      if (!cls?.prototype) continue;
      if (!COMPLETION_TREE[className]) continue;

      const walked = classToCompletions(cls);
      const classEntry = COMPLETION_TREE[className];
      if (Object.keys(walked.instanceChildren).length > 0) {
        if (!classEntry.instanceChildren) classEntry.instanceChildren = {};
        mergeCompletions({ children: classEntry.instanceChildren }, walked.instanceChildren);
      }
      if (Object.keys(walked.staticChildren).length > 0) {
        if (!classEntry.staticChildren) classEntry.staticChildren = {};
        mergeCompletions({ children: classEntry.staticChildren }, walked.staticChildren);
      }
      if (walked.constructorDetail && !classEntry.constructorDetail) {
        classEntry.constructorDetail = walked.constructorDetail;
      }
    } catch { /* skip */ }
  }

  // Speaker — plain data object, introspect from a runtime sample
  try {
    const ChatMsg = cfg.ChatMessage?.documentClass;
    if (ChatMsg?.getSpeaker) {
      const sample = ChatMsg.getSpeaker();
      if (sample && typeof sample === "object") {
        const speakerTarget = COMPLETION_TREE.speaker;
        if (speakerTarget) {
          if (!speakerTarget.children) speakerTarget.children = {};
          for (const [key, value] of Object.entries(sample)) {
            if (key.startsWith("_")) continue;
            const entry = valueToCompletionEntry(value, 0);
            if (entry) speakerTarget.children[key] = entry;
          }
          console.log(`macro-autocomplete | Injected ${Object.keys(speakerTarget.children).length} speaker fields from ChatMessage.getSpeaker()`);
        }
      }
    }
  } catch (err) {
    console.warn("macro-autocomplete | Error injecting speaker completions:", err);
  }
}

/**
 * Convert a runtime value to a completion entry.
 * Recursively walks objects up to maxDepth levels.
 */
function valueToCompletionEntry(value: any, maxDepth: number = 3): CompletionEntry | null {
  if (value === null || value === undefined) return null;

  const type = typeof value;

  if (type === "function") {
    // Check if it's a class constructor (has prototype and PascalCase name)
    if (value.prototype && value.name && /^[A-Z]/.test(value.name)) {
      const entry: CompletionEntry = { type: "class", detail: `class ${value.name}`, info: value.name };
      if (maxDepth > 0) {
        const walked = classToCompletions(value);
        if (Object.keys(walked.staticChildren).length > 0) entry.staticChildren = walked.staticChildren;
        if (Object.keys(walked.instanceChildren).length > 0) entry.instanceChildren = walked.instanceChildren;
        if (walked.constructorDetail) entry.constructorDetail = walked.constructorDetail;
      }
      return entry;
    }
    // Regular function
    const fnStr = value.toString();
    const match = fnStr.match(/^(?:function\s*\w*\s*)?(\([^)]*\))|^(\([^)]*\))\s*=>/);
    const params = match ? (match[1] || match[2]) : "()";
    return { type: "function", detail: `${params} => any`, info: value.name || "function" };
  }

  if (Array.isArray(value)) {
    return { type: "property", detail: `array[${value.length}]`, info: "Array" };
  }

  if (type === "object") {
    // Regular object - recurse if depth allows
    const entry: CompletionEntry = { type: "property", detail: "object" };

    if (maxDepth > 0) {
      const children: CompletionNode = {};
      let count = 0;
      const maxChildren = 200; // Limit children to avoid huge objects

      for (const key of Object.keys(value)) {
        if (count >= maxChildren) break;
        if (key.startsWith("_") || key.startsWith("#")) continue; // Skip private

        try {
          const childValue = value[key];
          const childEntry = valueToCompletionEntry(childValue, maxDepth - 1);
          if (childEntry) {
            children[key] = childEntry;
            count++;
          }
        } catch {
          // Skip properties that throw on access
        }
      }

      if (Object.keys(children).length > 0) {
        entry.children = children;
      }
    }

    return entry;
  }

  // Primitive types
  if (type === "string") {
    const preview = value.length > 50 ? value.substring(0, 50) + "..." : value;
    return { type: "property", detail: "string", info: `"${preview}"` };
  }
  if (type === "number") {
    return { type: "property", detail: "number", info: String(value) };
  }
  if (type === "boolean") {
    return { type: "property", detail: "boolean", info: String(value) };
  }

  return { type: "property", detail: type };
}

/**
 * Recursively walk a completion subtree and register any class entries at the
 * top level of COMPLETION_TREE so they can be resolved by type name.
 * e.g., CONFIG.Dice.D20Roll → COMPLETION_TREE["D20Roll"]
 * Skips entries that already exist at the top level (runtime/namespace walkers take priority).
 */
function registerClassesFromNode(entry: CompletionEntry): void {
  const walkNode = (node: CompletionNode) => {
    for (const [key, child] of Object.entries(node)) {
      if (child.type === "class" && /^[A-Z]/.test(key)) {
        if (!COMPLETION_TREE[key]) {
          COMPLETION_TREE[key] = child;
        } else {
          // Merge in any new static/instance members
          if (child.staticChildren) {
            if (!COMPLETION_TREE[key].staticChildren) COMPLETION_TREE[key].staticChildren = {};
            mergeCompletions({ children: COMPLETION_TREE[key].staticChildren }, child.staticChildren);
          }
          if (child.instanceChildren) {
            if (!COMPLETION_TREE[key].instanceChildren) COMPLETION_TREE[key].instanceChildren = {};
            mergeCompletions({ children: COMPLETION_TREE[key].instanceChildren }, child.instanceChildren);
          }
          if (child.constructorDetail && !COMPLETION_TREE[key].constructorDetail) {
            COMPLETION_TREE[key].constructorDetail = child.constructorDetail;
          }
        }
      }
      // Recurse into children
      if (child.children) walkNode(child.children);
    }
  };
  if (entry.children) walkNode(entry.children);
}

/**
 * Inject completions from the global CONFIG object at runtime.
 * This dynamically populates CONFIG.DND5E and other CONFIG entries.
 */
function injectConfigCompletions(): void {
  const config = (globalThis as any).CONFIG;
  if (!config || typeof config !== "object") {
    console.log("macro-autocomplete | CONFIG not available, skipping config injection");
    return;
  }

  console.log("macro-autocomplete | Injecting CONFIG completions");

  try {
    if (!COMPLETION_TREE.CONFIG) {
      COMPLETION_TREE.CONFIG = { type: "object", detail: "object", info: "Global Foundry configuration" };
    }
    if (!COMPLETION_TREE.CONFIG.children) {
      COMPLETION_TREE.CONFIG.children = {};
    }

    let count = 0;
    for (const key of Object.keys(config)) {
      if (key.startsWith("_")) continue;

      try {
        const value = config[key];
        // Use depth 3 for top-level CONFIG entries to get good drill-down
        const entry = valueToCompletionEntry(value, 3);
        if (entry) {
          COMPLETION_TREE.CONFIG.children[key] = entry;
          count++;
        }
      } catch {
        // Skip properties that throw
      }
    }

    // Register classes found within CONFIG as top-level tree entries
    // so they can be resolved by type name (e.g., D20Roll from CONFIG.Dice.D20Roll)
    registerClassesFromNode(COMPLETION_TREE.CONFIG);

    console.log(`macro-autocomplete | Injected ${count} CONFIG entries`);
  } catch (err) {
    console.error("macro-autocomplete | Error injecting config completions:", err);
  }
}

/**
 * Walk a runtime object and extract its properties, methods, and getters as completions.
 * Handles both own properties (data values) and prototype members (methods/getters).
 * For sub-objects, recurses up to maxDepth. Classes get their statics extracted.
 */
function objectToCompletions(obj: any, maxDepth: number = 2): CompletionNode {
  const children: CompletionNode = {};
  if (!obj || typeof obj !== "object") return children;

  const skipNames = new Set([
    "constructor", "toString", "valueOf", "toJSON", "toLocaleString",
    "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable",
    "then", "catch", "finally",
  ]);

  const maxChildren = 200;
  let count = 0;

  // First: walk own enumerable properties (data values)
  for (const key of Object.keys(obj)) {
    if (count >= maxChildren) break;
    if (key.startsWith("_") || key.startsWith("#")) continue;
    if (skipNames.has(key)) continue;
    if (children[key]) continue;

    try {
      const value = obj[key];
      if (value === null || value === undefined) {
        // Property exists on the object but has no value (e.g., equippedArmor on a
        // temporary actor with no armor). Still register so it appears in completions.
        children[key] = { type: "property", detail: "any" };
        count++;
        continue;
      }
      const vType = typeof value;

      if (vType === "function") {
        // Check if it's a class constructor
        if (value.prototype && /^[A-Z]/.test(key)) {
          const entry: CompletionEntry = { type: "class", detail: `class ${key}`, info: key };
          if (maxDepth > 0) {
            const walked = classToCompletions(value);
            if (Object.keys(walked.staticChildren).length > 0) entry.staticChildren = walked.staticChildren;
            if (Object.keys(walked.instanceChildren).length > 0) entry.instanceChildren = walked.instanceChildren;
            if (walked.constructorDetail) entry.constructorDetail = walked.constructorDetail;
          }
          children[key] = entry;
        } else {
          // Regular function
          const fnStr = value.toString();
          const match = fnStr.match(/^(?:async\s+)?(?:function\s*\w*\s*)?(\([^)]*\))|^(?:async\s+)?(\([^)]*\))\s*=>|^(?:async\s+)?\w+\s*(\([^)]*\))/);
          const params = match ? (match[1] || match[2] || match[3] || "()") : "()";
          const isAsync = fnStr.trimStart().startsWith("async");
          const returnHint = isAsync ? "Promise<any>" : "any";
          children[key] = { type: "function", detail: `${params} => ${returnHint}` };
        }
      } else if (vType === "object") {
        if (Array.isArray(value)) {
          children[key] = { type: "property", detail: `array[${value.length}]` };
        } else if (maxDepth > 0) {
          const subChildren = objectToCompletions(value, maxDepth - 1);
          const entry: CompletionEntry = {
            type: "property",
            detail: value.constructor?.name || "object",
          };
          if (Object.keys(subChildren).length > 0) entry.children = subChildren;
          children[key] = entry;
        } else {
          children[key] = { type: "property", detail: value.constructor?.name || "object" };
        }
      } else if (vType === "string") {
        children[key] = { type: "property", detail: "string" };
      } else if (vType === "number") {
        children[key] = { type: "property", detail: "number", info: String(value) };
      } else if (vType === "boolean") {
        children[key] = { type: "property", detail: "boolean" };
      }
      count++;
    } catch {
      // Skip properties that throw on access
    }
  }

  // Second: walk prototype chain for methods and getters not yet covered
  let proto = Object.getPrototypeOf(obj);
  while (proto && proto !== Object.prototype) {
    for (const name of Object.getOwnPropertyNames(proto)) {
      if (count >= maxChildren) break;
      if (name.startsWith("_") || name.startsWith("#")) continue;
      if (skipNames.has(name)) continue;
      if (children[name]) continue;

      try {
        const descriptor = Object.getOwnPropertyDescriptor(proto, name);
        if (!descriptor) continue;

        if (typeof descriptor.value === "function") {
          const fn = descriptor.value;
          const fnStr = fn.toString();
          const match = fnStr.match(/^(?:async\s+)?(?:function\s*\w*\s*)?(\([^)]*\))|^(?:async\s+)?(\([^)]*\))\s*=>|^(?:async\s+)?\w+\s*(\([^)]*\))/);
          const params = match ? (match[1] || match[2] || match[3] || "()") : "()";
          const isAsync = fnStr.trimStart().startsWith("async");
          const returnHint = isAsync ? "Promise<any>" : "any";
          children[name] = { type: "method", detail: `${params} => ${returnHint}` };
          count++;
        } else if (descriptor.get && !descriptor.set) {
          children[name] = { type: "property", detail: "any" };
          count++;
        } else if (descriptor.get && descriptor.set) {
          // Getter+setter pair (wrapper/interceptor) — skip to find real definition deeper
          continue;
        }
      } catch { /* skip */ }
    }
    proto = Object.getPrototypeOf(proto);
  }

  return children;
}

/**
 * Walk global Foundry objects at runtime and populate completions for:
 * foundry.utils, game, canvas, ui, Hooks, CONST, fromUuid/fromUuidSync,
 * and system globals (e.g. dnd5e).
 */
function injectGlobalCompletions(): void {
  const g = globalThis as any;

  // foundry.utils — utility functions
  if (g.foundry?.utils) {
    const utilsNode = COMPLETION_TREE.foundry?.children?.utils;
    if (utilsNode) {
      const utils = objectToCompletions(g.foundry.utils, 1);
      mergeCompletions(utilsNode, utils);
      console.log(`macro-autocomplete | Injected ${Object.keys(utils).length} foundry.utils members`);
    }
  }

  // game — the Game instance
  if (g.game) {
    if (!COMPLETION_TREE.game) {
      COMPLETION_TREE.game = { type: "object", detail: "Game", info: "The active Game instance" };
    }
    const gameMembers = objectToCompletions(g.game, 2);
    mergeCompletions(COMPLETION_TREE.game, gameMembers);
    console.log(`macro-autocomplete | Injected ${Object.keys(gameMembers).length} game members`);
  }

  // canvas — the Canvas instance
  if (g.canvas) {
    if (!COMPLETION_TREE.canvas) {
      COMPLETION_TREE.canvas = { type: "object", detail: "Canvas", info: "The game canvas" };
    }
    const canvasMembers = objectToCompletions(g.canvas, 2);
    mergeCompletions(COMPLETION_TREE.canvas, canvasMembers);
    console.log(`macro-autocomplete | Injected ${Object.keys(canvasMembers).length} canvas members`);
  }

  // ui — UI singletons
  if (g.ui) {
    if (!COMPLETION_TREE.ui) {
      COMPLETION_TREE.ui = { type: "object", detail: "object", info: "Foundry UI singletons" };
    }
    const uiMembers = objectToCompletions(g.ui, 2);
    mergeCompletions(COMPLETION_TREE.ui, uiMembers);
    console.log(`macro-autocomplete | Injected ${Object.keys(uiMembers).length} ui members`);
  }

  // Hooks — static class
  if (g.Hooks && typeof g.Hooks === "function") {
    if (!COMPLETION_TREE.Hooks) {
      COMPLETION_TREE.Hooks = { type: "class", detail: "class Hooks", info: "Event hooks manager" };
    }
    const hooksWalked = classToCompletions(g.Hooks);
    if (!COMPLETION_TREE.Hooks.staticChildren) COMPLETION_TREE.Hooks.staticChildren = {};
    mergeCompletions({ children: COMPLETION_TREE.Hooks.staticChildren }, hooksWalked.staticChildren);
    console.log(`macro-autocomplete | Injected ${Object.keys(hooksWalked.staticChildren).length} Hooks static members`);
  }

  // CONST — constants object
  if (g.CONST) {
    if (!COMPLETION_TREE.CONST) {
      COMPLETION_TREE.CONST = { type: "object", detail: "object", info: "Foundry constants" };
    }
    const constMembers = objectToCompletions(g.CONST, 2);
    mergeCompletions(COMPLETION_TREE.CONST, constMembers);
    console.log(`macro-autocomplete | Injected ${Object.keys(constMembers).length} CONST members`);
  }

  // Global functions: fromUuid, fromUuidSync
  for (const fnName of ["fromUuid", "fromUuidSync"]) {
    if (typeof g[fnName] === "function" && !COMPLETION_TREE[fnName]) {
      const fn = g[fnName];
      const fnStr = fn.toString();
      const match = fnStr.match(/^(?:async\s+)?(?:function\s*\w*\s*)?(\([^)]*\))|^(?:async\s+)?(\([^)]*\))\s*=>|^(?:async\s+)?\w+\s*(\([^)]*\))/);
      const params = match ? (match[1] || match[2] || match[3] || "()") : "()";
      const isAsync = fnStr.trimStart().startsWith("async");
      const returnHint = isAsync ? "Promise<Document>" : "Document | null";
      COMPLETION_TREE[fnName] = { type: "function", detail: `${params} => ${returnHint}`, info: `Resolve a UUID to a document${isAsync ? " (async)" : " (sync)"}` };
    }
  }

  // Global classes commonly used in macros: Dialog, Roll, ChatMessage
  for (const className of ["Dialog", "Roll", "ChatMessage"]) {
    if (typeof g[className] === "function") {
      if (!COMPLETION_TREE[className]) {
        COMPLETION_TREE[className] = { type: "class", detail: `class ${className}`, info: className };
      }
      const walked = classToCompletions(g[className]);
      if (Object.keys(walked.staticChildren).length > 0) {
        if (!COMPLETION_TREE[className].staticChildren) COMPLETION_TREE[className].staticChildren = {};
        mergeCompletions({ children: COMPLETION_TREE[className].staticChildren }, walked.staticChildren);
      }
      if (Object.keys(walked.instanceChildren).length > 0) {
        if (!COMPLETION_TREE[className].instanceChildren) COMPLETION_TREE[className].instanceChildren = {};
        mergeCompletions({ children: COMPLETION_TREE[className].instanceChildren }, walked.instanceChildren);
      }
    }
  }

  // System global (e.g., dnd5e, pf2e, etc.) — walk whatever the system provides
  if (g.game?.system?.id) {
    const systemId = g.game.system.id;
    const systemGlobal = g[systemId];
    if (systemGlobal && typeof systemGlobal === "object") {
      if (!COMPLETION_TREE[systemId]) {
        COMPLETION_TREE[systemId] = { type: "object", detail: "object", info: `${systemId} system namespace` };
      }
      const systemMembers = objectToCompletions(systemGlobal, 2);
      mergeCompletions(COMPLETION_TREE[systemId], systemMembers);
      console.log(`macro-autocomplete | Injected ${Object.keys(systemMembers).length} ${systemId} system members`);
    }
  }
}

/**
 * Recursively walk a foundry namespace object and create class/object entries.
 * Classes get their static methods extracted. Sub-objects are recursed into.
 * Classes are also added as top-level entries (skipping "Base*" prefixed ones).
 * Returns the number of classes found.
 */
function walkNamespaceToTree(ns: any, parentNode: CompletionNode, addTopLevel: boolean = true): number {
  let classCount = 0;

  for (const key of Object.keys(ns)) {
    if (key.startsWith("_")) continue;

    try {
      const value = ns[key];

      if (typeof value === "function" && value.prototype) {
        // It's a class constructor
        const walked = classToCompletions(value);
        const entry: CompletionEntry = {
          type: "class",
          detail: `class ${key}`,
          info: key,
        };

        if (walked.constructorDetail) {
          entry.constructorDetail = walked.constructorDetail;
        }
        if (Object.keys(walked.staticChildren).length > 0) {
          entry.staticChildren = walked.staticChildren;
        }
        if (Object.keys(walked.instanceChildren).length > 0) {
          entry.instanceChildren = walked.instanceChildren;
        }

        parentNode[key] = entry;

        // Also add/merge into top-level tree entry (skip "Base*" classes)
        if (addTopLevel && !key.startsWith("Base")) {
          if (COMPLETION_TREE[key]) {
            if (Object.keys(walked.staticChildren).length > 0) {
              if (!COMPLETION_TREE[key].staticChildren) COMPLETION_TREE[key].staticChildren = {};
              mergeCompletions({ children: COMPLETION_TREE[key].staticChildren }, walked.staticChildren);
            }
            if (Object.keys(walked.instanceChildren).length > 0) {
              if (!COMPLETION_TREE[key].instanceChildren) COMPLETION_TREE[key].instanceChildren = {};
              mergeCompletions({ children: COMPLETION_TREE[key].instanceChildren }, walked.instanceChildren);
            }
            if (entry.constructorDetail && !COMPLETION_TREE[key].constructorDetail) {
              COMPLETION_TREE[key].constructorDetail = entry.constructorDetail;
            }
          } else {
            COMPLETION_TREE[key] = { ...entry };
          }
        }

        classCount++;
      } else if (value && typeof value === "object" && !Array.isArray(value)) {
        // It's a sub-namespace object — recurse
        const subEntry: CompletionEntry = {
          type: "object",
          detail: "object",
          info: key,
        };
        subEntry.children = {};
        classCount += walkNamespaceToTree(value, subEntry.children, addTopLevel);
        if (Object.keys(subEntry.children).length > 0) {
          parentNode[key] = subEntry;
        }
      }
    } catch {
      // Skip problematic entries
    }
  }

  return classCount;
}

/**
 * Walk foundry namespaces at runtime and create class entries with static methods.
 * Processes foundry.documents (and sub-namespaces like collections)
 * and foundry.applications (api, sidebar, sheets, etc.).
 * Classes are navigable at their namespace path (e.g., foundry.applications.api.DialogV2)
 * and also added as top-level entries (e.g., DialogV2).
 */
function injectFoundryNamespaceCompletions(): void {
  const foundryNS = (globalThis as any).foundry;
  if (!foundryNS || typeof foundryNS !== "object") {
    console.log("macro-autocomplete | foundry namespace not available, skipping");
    return;
  }

  // Ensure foundry path exists in tree
  if (!COMPLETION_TREE.foundry) {
    COMPLETION_TREE.foundry = { type: "object", detail: "object", info: "Foundry VTT core namespace" };
  }
  if (!COMPLETION_TREE.foundry.children) {
    COMPLETION_TREE.foundry.children = {};
  }

  const namespacesToWalk = ["documents", "applications"];
  let totalClasses = 0;

  for (const nsName of namespacesToWalk) {
    const ns = foundryNS[nsName];
    if (!ns || typeof ns !== "object") continue;

    if (!COMPLETION_TREE.foundry.children[nsName]) {
      COMPLETION_TREE.foundry.children[nsName] = {
        type: "object", detail: "object", info: `Foundry ${nsName}`,
      };
    }
    if (!COMPLETION_TREE.foundry.children[nsName].children) {
      COMPLETION_TREE.foundry.children[nsName].children = {};
    }

    const count = walkNamespaceToTree(ns, COMPLETION_TREE.foundry.children[nsName].children);
    totalClasses += count;
    console.log(`macro-autocomplete | Injected ${count} foundry.${nsName} class entries`);
  }

  console.log(`macro-autocomplete | Total foundry namespace classes: ${totalClasses}`);
}

// ── Signature map (built from the tree for quick lookup) ──

/** Flat map of "dotted.path" → { params: ["param1", "param2"], info: "description" } */
interface SignatureInfo {
  params: string[];
  info: string;
}

const SIGNATURE_MAP: Map<string, SignatureInfo> = new Map();

/** Recursively walk the tree and collect function/method signatures */
function buildSignatureMap(node: CompletionNode, prefix: string): void {
  for (const [key, entry] of Object.entries(node)) {
    const fullPath = prefix ? `${prefix}.${key}` : key;
    if ((entry.type === "function" || entry.type === "method") && entry.detail) {
      // Parse params from detail like "(source, displayName?)" or "(token1, token2) => number"
      const match = entry.detail.match(/^\(([^)]*)\)/);
      if (match) {
        const params = match[1].split(",").map(p => p.trim()).filter(p => p.length > 0);
        SIGNATURE_MAP.set(fullPath, { params, info: entry.info ?? "" });
      }
    }
    // Register constructor signatures for class entries with constructorDetail
    if (entry.type === "class" && entry.constructorDetail) {
      const match = entry.constructorDetail.match(/^\(([^)]*)\)/);
      if (match) {
        const params = match[1].split(",").map(p => p.trim()).filter(p => p.length > 0);
        SIGNATURE_MAP.set(`new ${fullPath}`, { params, info: entry.info ?? "" });
      }
    }
    if (entry.children) {
      buildSignatureMap(entry.children, fullPath);
    }
    if (entry.staticChildren) {
      buildSignatureMap(entry.staticChildren, fullPath);
    }
    if (entry.instanceChildren) {
      buildSignatureMap(entry.instanceChildren, fullPath);
    }
  }
}

/** Rebuild the signature map (called after schema injection) */
function rebuildSignatureMap(): void {
  SIGNATURE_MAP.clear();
  buildSignatureMap(COMPLETION_TREE, "");
}

// Initial build (will be rebuilt after schema injection)
buildSignatureMap(COMPLETION_TREE, "");

// ── Signature hint tooltip ──

let activeTooltip: HTMLElement | null = null;
let activeTooltipView: any = null; // track which view owns the tooltip

function createTooltipElement(): HTMLElement {
  const el = document.createElement("div");
  el.className = "macro-autocomplete-signature-hint";
  el.style.cssText = `
    position: fixed;
    z-index: 10000;
    background: var(--color-cool-5, #1a1a2e);
    color: var(--color-light-2, #ddd);
    border: 1px solid var(--color-cool-3, #444);
    border-radius: 4px;
    padding: 4px 8px;
    font-family: var(--font-mono, monospace);
    font-size: 12px;
    line-height: 1.4;
    pointer-events: none;
    white-space: nowrap;
    box-shadow: 0 2px 8px rgba(0,0,0,0.4);
  `;
  document.body.appendChild(el);
  return el;
}

function hideSignatureTooltip(): void {
  if (activeTooltip) {
    activeTooltip.remove();
    activeTooltip = null;
    activeTooltipView = null;
  }
}

/**
 * Render the signature tooltip with the current parameter highlighted.
 */
function renderSignatureTooltip(sig: SignatureInfo, paramIndex: number, funcName: string): string {
  const parts = sig.params.map((p, i) => {
    if (i === paramIndex) {
      return `<b style="color: var(--color-warm-2, #f0c040);">${p}</b>`;
    }
    return p;
  });
  return `<span style="color: var(--color-light-4, #999);">${funcName}</span>(${parts.join(", ")})`;
}

/**
 * Given the document text and a cursor position inside parens,
 * find the function path before the opening "(" and the current parameter index.
 */
function getSignatureContext(docText: string, cursorPos: number): { funcPath: string; paramIndex: number } | null {
  // Walk backwards from cursor to find the matching unmatched "("
  let depth = 0;
  let openParenPos = -1;
  for (let i = cursorPos - 1; i >= 0; i--) {
    const ch = docText[i];
    if (ch === ")") depth++;
    else if (ch === "(") {
      if (depth === 0) {
        openParenPos = i;
        break;
      }
      depth--;
    }
  }
  if (openParenPos < 0) return null;

  // Extract the function path before the "("
  const before = docText.substring(0, openParenPos);
  const match = before.match(/([\w.]+)$/);
  if (!match) return null;
  let funcPath = match[1];

  // Check for "new ClassName(" pattern - look for "new" keyword before the identifier
  const preIdentifier = before.substring(0, match.index!).trimEnd();
  if (preIdentifier.endsWith("new")) {
    funcPath = `new ${funcPath}`;
  }

  // Count commas at depth 0 between openParen and cursor to determine param index
  let paramIndex = 0;
  depth = 0;
  for (let i = openParenPos + 1; i < cursorPos; i++) {
    const ch = docText[i];
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "," && depth === 0) paramIndex++;
  }

  return { funcPath, paramIndex };
}

/**
 * Check if we should show/update/hide the signature tooltip based on the current editor state.
 */
function updateSignatureHint(view: any): void {
  const state = view.state;
  if (!state) return;

  const cursorPos = state.selection?.main?.head;
  if (cursorPos == null) return;

  const docText = state.doc?.toString();
  if (!docText) return;

  const ctx = getSignatureContext(docText, cursorPos);

  if (!ctx) {
    if (activeTooltipView === view) hideSignatureTooltip();
    return;
  }

  const sig = SIGNATURE_MAP.get(ctx.funcPath);
  if (!sig || sig.params.length === 0) {
    if (activeTooltipView === view) hideSignatureTooltip();
    return;
  }

  // Clamp param index
  const paramIndex = Math.min(ctx.paramIndex, sig.params.length - 1);

  // Position tooltip above the cursor
  const coords = view.coordsAtPos?.(cursorPos);
  if (!coords) return;

  if (!activeTooltip) {
    activeTooltip = createTooltipElement();
  }
  activeTooltipView = view;
  activeTooltip.innerHTML = renderSignatureTooltip(sig, paramIndex, ctx.funcPath);
  activeTooltip.style.left = `${coords.left}px`;
  activeTooltip.style.top = `${coords.top - 24}px`;
}

// ── Completion tree navigation ──

/**
 * Get the visible children for an entry based on its type.
 * - Class entries (type="class"): children + staticChildren
 * - Variable/other entries: children + instanceChildren
 */
function getVisibleChildren(entry: CompletionEntry): CompletionNode {
  const result: CompletionNode = {};
  if (entry.children) Object.assign(result, entry.children);
  if (entry.type === "class") {
    if (entry.staticChildren) Object.assign(result, entry.staticChildren);
  } else {
    if (entry.instanceChildren) Object.assign(result, entry.instanceChildren);
    // Type-based resolution: if detail names a known class, merge its instance members.
    // This lets properties like workflow.attackRoll (detail: "D20Roll") show D20Roll methods.
    // Local children/instanceChildren take precedence (already assigned above).
    if (entry.detail) {
      const typeName = entry.detail;
      if (/^[A-Z]\w*$/.test(typeName)) {
        const classEntry = COMPLETION_TREE[typeName];
        if (classEntry?.instanceChildren) {
          for (const [k, v] of Object.entries(classEntry.instanceChildren)) {
            if (!result[k]) result[k] = v;
          }
        }
      }
    }
  }
  return result;
}

/**
 * Navigate the completion tree to find the node at the given path segments.
 * Uses getVisibleChildren() to show the right members based on entry type.
 * Returns the visible children of the deepest matched node.
 */
function getCompletionsForPath(segments: string[]): CompletionNode | null {
  let node = COMPLETION_TREE;
  for (const seg of segments) {
    const entry = node[seg];
    if (!entry) return null;
    const visible = getVisibleChildren(entry);
    if (Object.keys(visible).length === 0) return null;
    node = visible;
  }
  return node;
}

// ── EditorView access ──

/**
 * Get the EditorView from a code-mirror element.
 * CodeMirror 6 attaches view references to internal DOM nodes.
 */
function getEditorView(element: HTMLElement): any | null {
  // @ts-expect-error - check for exposed view property
  if (element.view) return element.view;
  for (const selector of [".cm-editor", ".cm-content", ".cm-scroller"]) {
    const el = element.querySelector(selector);
    // @ts-expect-error - CodeMirror internal
    if (el?.cmView?.view) return el.cmView.view;
  }
  return null;
}

// ── Type inference ──

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Extract a class name from a function's detail/return-type string.
 * Handles patterns like:
 *   "(data?) => Promise<Actor.Stored | null>"  → "Actor"
 *   "(formula) => Roll<D>"                      → "Roll"
 *   "(config?) => Item"                          → "Item"
 * Returns null if no known class name can be extracted.
 */
function extractReturnType(detail: string | undefined): string | null {
  if (!detail) return null;
  const arrowMatch = detail.match(/=>\s*(.+)$/);
  if (!arrowMatch) return null;
  let ret = arrowMatch[1].trim();
  // Unwrap Promise<X>, MaybePromise<X>
  const promiseMatch = ret.match(/^(?:Promise|MaybePromise)<(.+)>$/);
  if (promiseMatch) ret = promiseMatch[1].trim();
  // Remove union members: | null, | undefined, | void
  ret = ret.replace(/\s*\|\s*(?:null|undefined|void)\b/g, "").trim();
  // Remove sub-type qualifiers: .Stored, .Implementation, .ConfiguredInstance
  ret = ret.replace(/\.\w+/g, "").trim();
  // Remove generic parameters: Roll<D> → Roll
  ret = ret.replace(/<[^>]*>/g, "").trim();
  // Accept only if it's a simple PascalCase name that exists in the tree
  if (/^[A-Z]\w*$/.test(ret) && COMPLETION_TREE[ret]) return ret;
  return null;
}

// Static factory method names that typically return instances of their class
const FACTORY_METHOD_NAMES = new Set([
  "create", "get", "build", "fromData", "fromJSON", "fromDropData",
  "fromImport", "fromSource", "fromTerms", "createDialog",
]);

/**
 * Get instance-level completions for a class by name.
 * Checks instanceChildren on the class entry, falling back to children for non-class entries.
 */
function getInstanceCompletions(className: string): CompletionNode | null {
  const classEntry = COMPLETION_TREE[className];
  if (!classEntry) return null;
  // Prefer instanceChildren (methods/properties available on instances)
  if (classEntry.instanceChildren && Object.keys(classEntry.instanceChildren).length > 0) {
    return classEntry.instanceChildren;
  }
  // Fall back to children (for entries that don't separate static/instance)
  return classEntry.children || null;
}

/**
 * Resolve the return type of a method to a class name, using three strategies:
 * 1. Explicit returnType field on the entry
 * 2. Parse the detail string for a known class name
 * 3. Factory method heuristic (common names like create/get return the class type)
 */
function resolveMethodReturnType(methodEntry: CompletionEntry, methodName: string, classEntry: CompletionEntry, className: string): string | null {
  if (methodEntry.returnType && COMPLETION_TREE[methodEntry.returnType]) {
    return methodEntry.returnType;
  }
  const parsed = extractReturnType(methodEntry.detail);
  if (parsed) return parsed;
  if (FACTORY_METHOD_NAMES.has(methodName) && classEntry.type === "class") {
    return className;
  }
  return null;
}

/**
 * Scan the document text for variable assignments and infer what completions the
 * variable should produce. Handles:
 *   const/let/var x = new ClassName(...)           — instance completions for ClassName
 *   const/let/var x = ClassName.method(...)        — uses returnType or detail parsing
 *   const/let/var x = await ClassName.method(...)
 *   const/let/var x = dotted.path                  — resolves path through completion tree
 * Returns a CompletionNode for the variable's direct children, or null.
 */
function inferVariableCompletions(varName: string, docText: string): CompletionNode | null {
  const escaped = escapeRegExp(varName);

  // Build a combined regex that captures all three patterns at once.
  // Group layout (each arm has declaration and bare-assignment alternatives):
  //   Pattern 1 (new): groups 1,2 = ClassName
  //   Pattern 2 (static method call): groups 3,4 = ClassName; groups 5,6 = methodName
  //   Pattern 3 (dotted path, no call): groups 7,8 = full path
  const combined = new RegExp(
    // Pattern 1a: (const|let|var) x = [await] new ClassName
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?new\\s+(\\w+)` +
    // Pattern 1b: x = [await] new ClassName  (bare assignment)
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?new\\s+(\\w+)` +
    // Pattern 2a: (const|let|var) x = [await] Class.method(
    `|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?(\\w+)\\.(\\w+)\\s*\\(` +
    // Pattern 2b: x = [await] Class.method(   (bare assignment)
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?(\\w+)\\.(\\w+)\\s*\\(` +
    // Pattern 3a: (const|let|var) x = dotted.path  (not followed by open-paren)
    `|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?(\\w+(?:\\.\\w+)*)(?!\\s*\\()` +
    // Pattern 3b: x = dotted.path  (bare assignment, not followed by open-paren)
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?(\\w+(?:\\.\\w+)*)(?!\\s*\\()`,
    "m"
  );

  const m = docText.match(combined);
  if (!m) return null;

  // Pattern 1: new ClassName(...)
  const newClass = m[1] || m[2];
  if (newClass && COMPLETION_TREE[newClass]) {
    return getInstanceCompletions(newClass);
  }

  // Pattern 2: ClassName.method(...)
  const className = m[3] || m[5];
  const methodName = m[4] || m[6];
  if (className && methodName) {
    const classEntry = COMPLETION_TREE[className];
    if (classEntry) {
      const visible = getVisibleChildren(classEntry);
      const methodEntry = visible[methodName];
      if (methodEntry) {
        const returnTypeName = resolveMethodReturnType(methodEntry, methodName, classEntry, className);
        if (returnTypeName) return getInstanceCompletions(returnTypeName);
      }
    }
  }

  // Pattern 3: dotted.path assignment (not a function call)
  const fullPath = m[7] || m[8];
  if (fullPath) {
    const segments = fullPath.split(".");
    let entry: CompletionEntry | undefined = COMPLETION_TREE[segments[0]];
    if (entry) {
      for (let i = 1; i < segments.length && entry; i++) {
        const visible = getVisibleChildren(entry);
        entry = visible[segments[i]];
      }
      if (entry) {
        const result = getVisibleChildren(entry);
        if (Object.keys(result).length > 0) return result;
      }
    }
  }

  return null;
}

// ── Completion source ──

/**
 * Custom completion source for Foundry macros.
 * Context-aware: completes one segment at a time based on the dotted path prefix.
 * Supports type inference for `new ClassName()`, `ClassName.method()`, and
 * dotted-path assignments like `let a = actor.system.attributes.ac`.
 */
function macroCompletionSource(context: any): any | null {
  const word = context.matchBefore(/[\w.]+/);
  if (!word && !context.explicit) return null;

  const fullText = word?.text ?? "";
  const parts = fullText.split(".");
  const currentSegment = parts.pop() ?? "";
  const pathSegments = parts;

  let node: CompletionNode;
  if (pathSegments.length === 0) {
    node = COMPLETION_TREE;
  } else {
    // Try normal path resolution first
    const found = getCompletionsForPath(pathSegments);
    if (found) {
      node = found;
    } else if (pathSegments.length >= 1 && !COMPLETION_TREE[pathSegments[0]]) {
      // Root variable not in tree — try type inference
      // e.g., "r.evaluate" where r = new Roll(...)
      // e.g., "a.value" where a = actor.system.attributes.ac
      const docText = context.state.doc.toString();
      const inferred = inferVariableCompletions(pathSegments[0], docText);
      if (inferred) {
        // Walk remaining path segments through the inferred completions
        let current: CompletionNode | null = inferred;
        for (let i = 1; i < pathSegments.length && current; i++) {
          const entry = current[pathSegments[i]];
          if (entry) {
            const visible = getVisibleChildren(entry);
            current = Object.keys(visible).length > 0 ? visible : null;
          } else {
            current = null;
          }
        }
        if (current) {
          node = current;
        } else {
          return null;
        }
      } else {
        return null;
      }
    } else {
      return null;
    }
  }

  const options = Object.entries(node)
    .filter(([key]) => key.toLowerCase().startsWith(currentSegment.toLowerCase()))
    .map(([key, entry]) => {
      const hasChildren = !!(entry.children || entry.staticChildren || entry.instanceChildren);
      return {
        label: key,
        type: entry.type ?? (hasChildren ? "namespace" : "property"),
        detail: entry.detail ?? (hasChildren ? "..." : undefined),
        info: entry.info,
        boost: hasChildren ? 1 : 0,
      };
    });

  if (options.length === 0) return null;

  const from = word ? word.from + (fullText.length - currentSegment.length) : context.pos;
  return { from, options };
}

// ── CodeMirror internals discovery ──

let _appendConfig: any = null;
let _languageData: any = null;
let _updateListener: any = null;
let _internalsResolved = false;

/**
 * Try to accept the current completion by simulating Enter key.
 * Returns true if completion was active and accepted.
 */
function tryAcceptCompletion(view: any): boolean {
  // Check if completion tooltip is visible
  const tooltip = view.dom?.querySelector('.cm-tooltip-autocomplete');
  if (!tooltip) return false;

  // Dispatch Enter key event to accept the completion
  const enterEvent = new KeyboardEvent('keydown', {
    key: 'Enter',
    code: 'Enter',
    keyCode: 13,
    which: 13,
    bubbles: true,
    cancelable: true
  });
  view.contentDOM.dispatchEvent(enterEvent);
  return true;
}

function resolveInternals(view: any): boolean {
  if (_internalsResolved) return !!_appendConfig;

  try {
    const ViewClass = view.constructor;
    if (typeof ViewClass.scrollIntoView === "function") {
      const effect = ViewClass.scrollIntoView(0);
      const StateEffect = effect?.constructor;
      if (StateEffect) {
        _appendConfig = StateEffect.appendConfig;
      }
    }

    // EditorView.updateListener facet
    if (ViewClass.updateListener) {
      _updateListener = ViewClass.updateListener;
    }

    const StateClass = view.state?.constructor;
    if (StateClass?.languageData) {
      _languageData = StateClass.languageData;
    }
  } catch (err) {
    console.error("macro-autocomplete | Error resolving CodeMirror internals:", err);
  }

  _internalsResolved = true;
  return !!_appendConfig && !!_languageData;
}

// ── Enhancement ──

const enhancedElements = new WeakSet<HTMLElement>();

// Patch Text.prototype.line once to clamp out-of-range line numbers instead of throwing.
// Foundry's ESLint preprocessor wraps source as `async () => {${source}\n}` adding one line,
// but the postprocessor doesn't clamp line numbers. When ESLint reports parse errors at the
// end of the preprocessed source (e.g., when a user pauses after typing "." to browse
// completions), mapPos calls doc.line(N+1) on an N-line document, throwing a RangeError
// that escapes through setTimeout to window.onerror.
let _textLinePatched = false;
function patchTextLine(view: any): void {
  if (_textLinePatched) return;
  const TextClass = view.state.doc.constructor;
  if (!TextClass?.prototype?.line) return;
  const origLine = TextClass.prototype.line;
  TextClass.prototype.line = function(n: number) {
    if (n < 1) n = 1;
    else if (n > this.lines) n = this.lines;
    return origLine.call(this, n);
  };
  _textLinePatched = true;
}

async function enhanceCodeMirror(element: HTMLElement): Promise<void> {
  if (enhancedElements.has(element)) return;

  await new Promise(resolve => setTimeout(resolve, 200));

  const view = getEditorView(element);
  if (!view) {
    console.warn("macro-autocomplete | Could not access CodeMirror EditorView");
    return;
  }

  patchTextLine(view);
  enhancedElements.add(element);

  const ready = resolveInternals(view);
  if (!ready) {
    console.warn("macro-autocomplete | Could not resolve CodeMirror internals - autocompletion not available");
    return;
  }

  try {
    const extensions: any[] = [];

    // Completion source
    extensions.push(
      _languageData.of(() => [{ autocomplete: macroCompletionSource }])
    );

    // Signature hint via updateListener
    if (_updateListener) {
      extensions.push(
        _updateListener.of((update: any) => {
          if (update.docChanged || update.selectionSet) {
            updateSignatureHint(update.view);
          }
        })
      );
    }

    view.dispatch({
      effects: _appendConfig.of(extensions)
    });

    // Add Tab key handler to accept completions
    // We use a DOM event listener since we can't easily access CodeMirror's keymap
    view.contentDOM.addEventListener('keydown', (event: KeyboardEvent) => {
      if (event.key === 'Tab' && !event.shiftKey) {
        if (tryAcceptCompletion(view)) {
          event.preventDefault();
          event.stopPropagation();
        }
      }
    }, true); // Use capture phase to intercept before CodeMirror

    console.log("macro-autocomplete | Injected autocompletions with Tab completion");
  } catch (err) {
    console.error("macro-autocomplete | Error injecting completions:", err);
  }
}

// ── Initialization ──

function initMacroAutoComplete(): void {
  if (typeof window === "undefined" || typeof document === "undefined") return;

  console.log("macro-autocomplete | Initializing macro autocompletion");

  // Inject schema-generated completions from dnd5e DataModels (if dnd5e is installed)
  injectSchemaCompletions();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      for (const node of Array.from(mutation.addedNodes)) {
        if (node instanceof HTMLElement) {
          const codeMirrors = node.tagName === "CODE-MIRROR"
            ? [node]
            : Array.from(node.querySelectorAll("code-mirror"));
          for (const cm of codeMirrors) {
            if (cm.getAttribute("language") === "javascript") {
              enhanceCodeMirror(cm as HTMLElement);
            }
          }
        }
      }
    }
  });

  observer.observe(document.body, { childList: true, subtree: true });

  document.querySelectorAll('code-mirror[language="javascript"]').forEach(cm => {
    enhanceCodeMirror(cm as HTMLElement);
  });
}

// Module entry point
Hooks.once("ready", () => initMacroAutoComplete());
