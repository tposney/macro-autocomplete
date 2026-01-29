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
 * 1. Static completions (foundry.utils, game, canvas, ui, etc.)
 * 2. foundryCompletions.json - generated from fvtt-types at build time
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
  children?: CompletionNode;
}

interface CompletionNode {
  [key: string]: CompletionEntry;
}

// Use let so we can augment with schema-generated completions at runtime
let COMPLETION_TREE: CompletionNode = {
  foundry: {
    children: {
      utils: {
        children: {
          // Object manipulation
          mergeObject: { type: "function", detail: "(original, other, options?) => object", info: "Recursively merge other into original. Options: insertKeys, insertValues, overwrite, recursive, inplace, performDeletions" },
          deepClone: { type: "function", detail: "(original, options?) => any", info: "Recursively deep clone an object or array" },
          duplicate: { type: "function", detail: "(original) => any", info: "Fast clone via JSON parse/stringify" },
          diffObject: { type: "function", detail: "(original, other, options?) => object", info: "Return keys/values in other that differ from original" },
          flattenObject: { type: "function", detail: "(obj) => object", info: "Flatten nested object to dot-notation keys: {a:{b:1}} => {'a.b':1}" },
          expandObject: { type: "function", detail: "(obj) => object", info: "Expand dot-notation keys back to nested object" },
          filterObject: { type: "function", detail: "(source, template, options?) => object", info: "Filter source to only keys present in template" },
          objectsEqual: { type: "function", detail: "(a, b) => boolean", info: "Deep equality test for two objects" },
          invertObject: { type: "function", detail: "(obj) => object", info: "Swap keys and values" },
          deepFreeze: { type: "function", detail: "(obj) => object", info: "Recursively freeze an object (immutable)" },

          // Property access
          getProperty: { type: "function", detail: "(object, key) => any", info: "Get value using dot-notation key: getProperty(obj, 'a.b.c')" },
          setProperty: { type: "function", detail: "(object, key, value) => boolean", info: "Set value using dot-notation key, creating intermediates" },
          hasProperty: { type: "function", detail: "(object, key) => boolean", info: "Test for nested property using dot-notation key" },
          deleteProperty: { type: "function", detail: "(object, key) => boolean", info: "Delete nested property using dot-notation key" },

          // Type checking
          getType: { type: "function", detail: "(variable) => string", info: "Get type as string: 'Array', 'Object', 'Set', 'Map', 'number', etc." },
          isEmpty: { type: "function", detail: "(value) => boolean", info: "Test if value is empty (null, undefined, empty array/object/Set/Map)" },
          isSubclass: { type: "function", detail: "(cls, parent) => boolean", info: "Test if cls extends parent" },

          // String / HTML
          escapeHTML: { type: "function", detail: "(value) => string", info: "Escape &, <, >, \", ' for safe HTML insertion" },
          unescapeHTML: { type: "function", detail: "(value) => string", info: "Unescape HTML entities back to characters" },
          parseHTML: { type: "function", detail: "(html) => Node", info: "Parse HTML string into a DOM node" },
          encodeURL: { type: "function", detail: "(path) => string", info: "Encode URL preserving protocol" },

          // UUID
          parseUuid: { type: "function", detail: "(uuid, options?) => object", info: "Parse UUID into parts: documentType, id, etc." },
          buildUuid: { type: "function", detail: "({id, documentName, parent, pack}) => string", info: "Build a UUID from parts" },
          fromUuid: { type: "function", detail: "(uuid) => Promise<Document>", info: "Async resolve a UUID to its document" },
          fromUuidSync: { type: "function", detail: "(uuid) => Document|null", info: "Sync resolve a UUID (must be already loaded)" },

          // Utility
          randomID: { type: "function", detail: "(length?) => string", info: "Generate random alphanumeric string (default 16 chars)" },
          isNewerVersion: { type: "function", detail: "(v1, v0) => boolean", info: "Test if v1 is newer than v0" },
          debounce: { type: "function", detail: "(callback, delay) => Function", info: "Wrap callback with debounced timeout (ms)" },
          throttle: { type: "function", detail: "(callback, delay) => Function", info: "Wrap callback with throttled timeout (ms)" },
          timeSince: { type: "function", detail: "(date) => string", info: "Human-readable time since date ('2 hours ago')" },
          formatFileSize: { type: "function", detail: "(size, options?) => string", info: "Format bytes to kB, MB, GB, etc." },
          getRoute: { type: "function", detail: "(path, options?) => string", info: "Get URL route including configured path prefix" },

          // Data I/O
          saveDataToFile: { type: "function", detail: "(data, type, filename) => void", info: "Download data as a file" },
          readTextFromFile: { type: "function", detail: "(file) => Promise<string>", info: "Read text content from a File object" },
          fetchWithTimeout: { type: "function", detail: "(url, data?, options?) => Promise<Response>", info: "Fetch with AbortController timeout" },
          fetchJsonWithTimeout: { type: "function", detail: "(url, data?, options?) => Promise<object>", info: "Fetch JSON with timeout" },

          // Document helpers
          getDocumentClass: { type: "function", detail: "(documentName) => class", info: "Get Document class for a type name ('Actor', 'Item', etc.)" },

          // Logging
          logCompatibilityWarning: { type: "function", detail: "(message, options?) => void", info: "Log a compatibility warning with version info" },
        }
      }
    }
  },

  // ── Foundry Globals ──

  game: {
    children: {
      actors: { type: "property", detail: "Actors", info: "Collection of all world actors" },
      items: { type: "property", detail: "Items", info: "Collection of all world items" },
      users: { type: "property", detail: "Users", info: "Collection of all users" },
      user: { type: "property", detail: "User", info: "The current user" },
      scenes: { type: "property", detail: "Scenes", info: "Collection of all scenes" },
      combat: { type: "property", detail: "Combat | null", info: "The currently active combat" },
      combats: { type: "property", detail: "CombatEncounters", info: "Collection of all combats" },
      messages: { type: "property", detail: "Messages", info: "Collection of chat messages" },
      journal: { type: "property", detail: "Journal", info: "Collection of journal entries" },
      tables: { type: "property", detail: "RollTables", info: "Collection of roll tables" },
      playlists: { type: "property", detail: "Playlists", info: "Collection of playlists" },
      macros: { type: "property", detail: "Macros", info: "Collection of macros" },
      packs: { type: "property", detail: "CompendiumPacks", info: "Collection of compendium packs" },
      settings: {
        type: "property", detail: "ClientSettings", info: "Game settings manager",
        children: {
          get: { type: "method", detail: "(scope, key) => any", info: "Get a setting value" },
          set: { type: "method", detail: "(scope, key, value) => Promise", info: "Set a setting value" },
          register: { type: "method", detail: "(scope, key, data) => void", info: "Register a new setting" },
        }
      },
      i18n: {
        type: "property", detail: "Localization", info: "Localization helper",
        children: {
          localize: { type: "method", detail: "(key) => string", info: "Localize a string" },
          format: { type: "method", detail: "(key, data?) => string", info: "Localize and format a string" },
          has: { type: "method", detail: "(key, fallback?) => boolean", info: "Check if translation exists" },
        }
      },
      time: { type: "property", detail: "GameTime", info: "In-game time tracker" },
      system: { type: "property", detail: "System", info: "The game system data" },
      modules: { type: "property", detail: "Map<string, Module>", info: "Map of installed modules" },
      ready: { type: "property", detail: "boolean", info: "Whether the game is fully initialized" },
      paused: { type: "property", detail: "boolean", info: "Whether the game is paused" },
      canvas: { type: "property", detail: "Canvas", info: "Reference to the canvas" },
    }
  },

  canvas: {
    children: {
      tokens: {
        type: "property", detail: "TokenLayer", info: "The token layer",
        children: {
          placeables: { type: "property", detail: "Token[]", info: "All tokens on the canvas" },
          controlled: { type: "property", detail: "Token[]", info: "Currently controlled tokens" },
          get: { type: "method", detail: "(id) => Token | undefined", info: "Get a token by ID" },
          ownedTokens: { type: "property", detail: "Token[]", info: "Tokens owned by current user" },
        }
      },
      scene: { type: "property", detail: "Scene | null", info: "The currently viewed scene" },
      grid: {
        type: "property", detail: "BaseGrid", info: "The canvas grid",
        children: {
          size: { type: "property", detail: "number", info: "Grid size in pixels" },
          distance: { type: "property", detail: "number", info: "Distance per grid unit" },
          units: { type: "property", detail: "string", info: "Distance unit label" },
          measurePath: { type: "method", detail: "(waypoints, options?) => object", info: "Measure distance along a path" },
        }
      },
      walls: { type: "property", detail: "WallsLayer", info: "The walls layer" },
      lighting: { type: "property", detail: "LightingLayer", info: "The lighting layer" },
      templates: {
        type: "property", detail: "TemplateLayer", info: "The measured templates layer",
        children: {
          placeables: { type: "property", detail: "MeasuredTemplate[]", info: "All templates on canvas" },
          get: { type: "method", detail: "(id) => MeasuredTemplate | undefined", info: "Get template by ID" },
        }
      },
      effects: { type: "property", detail: "EffectsLayer", info: "The visual effects layer" },
      ready: { type: "property", detail: "boolean", info: "Whether the canvas is ready" },
    }
  },

  ui: {
    children: {
      notifications: {
        type: "property", detail: "Notifications", info: "Notification manager",
        children: {
          info: { type: "method", detail: "(message, options?) => void", info: "Show info notification" },
          warn: { type: "method", detail: "(message, options?) => void", info: "Show warning notification" },
          error: { type: "method", detail: "(message, options?) => void", info: "Show error notification" },
        }
      },
      chat: { type: "property", detail: "ChatLog", info: "The chat log sidebar" },
      combat: { type: "property", detail: "CombatTracker", info: "The combat tracker sidebar" },
      actors: { type: "property", detail: "ActorDirectory", info: "The actors directory sidebar" },
      items: { type: "property", detail: "ItemDirectory", info: "The items directory sidebar" },
      windows: { type: "property", detail: "object", info: "Currently open application windows" },
    }
  },

  ChatMessage: {
    type: "class", detail: "class", info: "Chat message document class",
    children: {
      create: { type: "method", detail: "(data, options?) => Promise<ChatMessage>", info: "Create a new chat message" },
      getSpeaker: { type: "method", detail: "(options?) => object", info: "Get speaker data for a chat message" },
      applyRollMode: { type: "method", detail: "(chatData, rollMode) => object", info: "Apply roll mode to chat data" },
    }
  },

  Roll: {
    type: "class", detail: "class", info: "Dice roll class",
    children: {
      create: { type: "method", detail: "(formula, data?) => Roll", info: "Create a Roll instance" },
      fromData: { type: "method", detail: "(data) => Roll", info: "Recreate Roll from serialized data" },
      fromTerms: { type: "method", detail: "(terms) => Roll", info: "Create Roll from term array" },
      simulate: { type: "method", detail: "(formula, n?) => number[]", info: "Simulate roll results" },
    }
  },

  Hooks: {
    type: "class", detail: "class", info: "Event hooks manager",
    children: {
      on: { type: "method", detail: "(hook, fn) => number", info: "Register a callback for a hook (returns hook ID)" },
      once: { type: "method", detail: "(hook, fn) => number", info: "Register a one-time callback" },
      off: { type: "method", detail: "(hook, fn) => void", info: "Unregister a callback" },
      call: { type: "method", detail: "(hook, ...args) => boolean", info: "Call a hook, allowing interruption" },
      callAll: { type: "method", detail: "(hook, ...args) => boolean", info: "Call a hook, no interruption" },
    }
  },

  Dialog: {
    type: "class", detail: "class", info: "Dialog application class",
    children: {
      confirm: { type: "method", detail: "({title, content, yes?, no?, ...}) => Promise<boolean>", info: "Show a yes/no confirmation dialog" },
      prompt: { type: "method", detail: "({title, content, label?, callback?, ...}) => Promise<any>", info: "Show a single-button prompt dialog" },
      wait: { type: "method", detail: "(data, options?, renderOptions?) => Promise<any>", info: "Show dialog and wait for button click" },
    }
  },

  CONST: {
    type: "object", detail: "object", info: "Foundry constants",
    children: {
      TOKEN_DISPOSITIONS: {
        type: "object", detail: "object", info: "Token disposition values",
        children: {
          HOSTILE: { type: "constant", detail: "-1", info: "Hostile disposition" },
          NEUTRAL: { type: "constant", detail: "0", info: "Neutral disposition" },
          FRIENDLY: { type: "constant", detail: "1", info: "Friendly disposition" },
        }
      },
      ACTIVE_EFFECT_MODES: {
        type: "object", detail: "object", info: "Active effect application modes",
        children: {
          CUSTOM: { type: "constant", detail: "0", info: "Custom effect mode" },
          MULTIPLY: { type: "constant", detail: "1", info: "Multiply value" },
          ADD: { type: "constant", detail: "2", info: "Add to value" },
          DOWNGRADE: { type: "constant", detail: "3", info: "Use lower of current/effect" },
          UPGRADE: { type: "constant", detail: "4", info: "Use higher of current/effect" },
          OVERRIDE: { type: "constant", detail: "5", info: "Replace value entirely" },
        }
      },
      DOCUMENT_OWNERSHIP_LEVELS: {
        type: "object", detail: "object", info: "Document permission levels",
        children: {
          NONE: { type: "constant", detail: "0", info: "No permission" },
          LIMITED: { type: "constant", detail: "1", info: "Limited permission" },
          OBSERVER: { type: "constant", detail: "2", info: "Observer permission" },
          OWNER: { type: "constant", detail: "3", info: "Owner permission" },
        }
      },
      DICE_ROLL_MODES: {
        type: "object", detail: "object", info: "Roll visibility modes",
        children: {
          PUBLIC: { type: "constant", detail: "\"publicroll\"", info: "Visible to all" },
          PRIVATE: { type: "constant", detail: "\"gmroll\"", info: "Visible to GM and owner" },
          BLIND: { type: "constant", detail: "\"blindroll\"", info: "Visible only to GM" },
          SELF: { type: "constant", detail: "\"selfroll\"", info: "Visible only to roller" },
        }
      },
    }
  },

  fromUuid: { type: "function", detail: "(uuid) => Promise<Document>", info: "Async resolve a UUID to its document" },
  fromUuidSync: { type: "function", detail: "(uuid) => Document | null", info: "Sync resolve a UUID (must be already loaded)" },

  // ── dnd5e System (conditional on dnd5e being installed) ──

  dnd5e: {
    children: {
      config: { type: "property", detail: "object", info: "System configuration (same as CONFIG.DND5E)" },
      documents: {
        type: "property", detail: "object", info: "System document classes",
        children: {
          Actor5e: { type: "class", detail: "class extends Actor", info: "D&D 5e Actor document class" },
          Item5e: { type: "class", detail: "class extends Item", info: "D&D 5e Item document class" },
          TokenDocument5e: { type: "class", detail: "class extends TokenDocument", info: "D&D 5e TokenDocument class" },
          ActiveEffect5e: { type: "class", detail: "class extends ActiveEffect", info: "D&D 5e ActiveEffect class" },
          Proficiency: { type: "class", detail: "class", info: "Proficiency handling class" },
        }
      },
      applications: {
        type: "property", detail: "object", info: "System application classes",
        children: {
          ActorSheet5e: { type: "class", detail: "class extends ActorSheet", info: "Base actor sheet class" },
          ActorSheet5eCharacter: { type: "class", detail: "class extends ActorSheet5e", info: "Character sheet class" },
          ActorSheet5eNPC: { type: "class", detail: "class extends ActorSheet5e", info: "NPC sheet class" },
          ItemSheet5e: { type: "class", detail: "class extends ItemSheet", info: "Item sheet class" },
          AbilityUseDialog: { type: "class", detail: "class extends Dialog", info: "Dialog for ability usage configuration" },
          ShortRestDialog: { type: "class", detail: "class extends Dialog", info: "Short rest configuration dialog" },
          LongRestDialog: { type: "class", detail: "class extends Dialog", info: "Long rest configuration dialog" },
        }
      },
      dataModels: {
        type: "property", detail: "object", info: "Data model classes",
        children: {
          actor: {
            type: "property", detail: "object", info: "Actor data models",
            children: {
              CharacterData: { type: "class", detail: "class", info: "Character actor data model" },
              NPCData: { type: "class", detail: "class", info: "NPC actor data model" },
              VehicleData: { type: "class", detail: "class", info: "Vehicle actor data model" },
              GroupData: { type: "class", detail: "class", info: "Group actor data model" },
            }
          },
          item: {
            type: "property", detail: "object", info: "Item data models",
            children: {
              WeaponData: { type: "class", detail: "class", info: "Weapon item data model" },
              SpellData: { type: "class", detail: "class", info: "Spell item data model" },
              EquipmentData: { type: "class", detail: "class", info: "Equipment item data model" },
              FeatureData: { type: "class", detail: "class", info: "Feature item data model" },
              ClassData: { type: "class", detail: "class", info: "Class item data model" },
              BackgroundData: { type: "class", detail: "class", info: "Background item data model" },
              ConsumableData: { type: "class", detail: "class", info: "Consumable item data model" },
              ContainerData: { type: "class", detail: "class", info: "Container item data model" },
              LootData: { type: "class", detail: "class", info: "Loot item data model" },
              ToolData: { type: "class", detail: "class", info: "Tool item data model" },
            }
          },
          activity: {
            type: "property", detail: "object", info: "Activity data models",
            children: {
              AttackActivity: { type: "class", detail: "class", info: "Attack activity data model" },
              DamageActivity: { type: "class", detail: "class", info: "Damage activity data model" },
              SaveActivity: { type: "class", detail: "class", info: "Save activity data model" },
              HealActivity: { type: "class", detail: "class", info: "Heal activity data model" },
              UtilityActivity: { type: "class", detail: "class", info: "Utility activity data model" },
              SummonActivity: { type: "class", detail: "class", info: "Summon activity data model" },
              EnchantActivity: { type: "class", detail: "class", info: "Enchant activity data model" },
            }
          },
        }
      },
      dice: {
        type: "property", detail: "object", info: "Dice classes",
        children: {
          D20Roll: { type: "class", detail: "class extends Roll", info: "D20 roll with advantage/disadvantage support" },
          DamageRoll: { type: "class", detail: "class extends Roll", info: "Damage roll with critical support" },
          BasicRoll: { type: "class", detail: "class extends Roll", info: "Basic dice roll" },
        }
      },
      utils: {
        type: "property", detail: "object", info: "System utility functions",
        children: {
          simplifyBonus: { type: "function", detail: "(formula, data?) => string", info: "Simplify a roll formula using roll data" },
          convertDistance: { type: "function", detail: "(value, from, to) => number", info: "Convert distance between unit systems" },
          convertWeight: { type: "function", detail: "(value, from, to) => number", info: "Convert weight between unit systems" },
        }
      },
      activities: {
        type: "property", detail: "object", info: "Activity type registry",
        children: {
          get: { type: "method", detail: "(type) => class", info: "Get activity class by type name" },
        }
      },
    }
  },

  // CONFIG children populated at runtime by injectConfigCompletions()
  CONFIG: {
    type: "object", detail: "object", info: "Global Foundry configuration object (populated at runtime)",
    children: {}
  },

  // ── dnd5e Actor/Item ──

  Actor5e: {
    type: "class", detail: "class extends Actor", info: "D&D 5e Actor document class",
    children: {
      create: { type: "method", detail: "(data, options?) => Promise<Actor5e>", info: "Create a new actor document" },
      updateDocuments: { type: "method", detail: "(updates, context?) => Promise<Actor5e[]>", info: "Update multiple actors" },
      deleteDocuments: { type: "method", detail: "(ids, context?) => Promise<Actor5e[]>", info: "Delete multiple actors" },
    }
  },

  Item5e: {
    type: "class", detail: "class extends Item", info: "D&D 5e Item document class",
    children: {
      create: { type: "method", detail: "(data, options?) => Promise<Item5e>", info: "Create a new item document" },
      updateDocuments: { type: "method", detail: "(updates, context?) => Promise<Item5e[]>", info: "Update multiple items" },
      deleteDocuments: { type: "method", detail: "(ids, context?) => Promise<Item5e[]>", info: "Delete multiple items" },
    }
  },

  token: {
    type: "variable", detail: "Token", info: "Token instance (available in macros/hooks)",
    children: {
      actor: { type: "property", detail: "Actor | null", info: "The actor this token represents" },
      document: { type: "property", detail: "TokenDocument", info: "The token document" },
      name: { type: "property", detail: "string", info: "Token display name" },
      x: { type: "property", detail: "number", info: "X position on canvas" },
      y: { type: "property", detail: "number", info: "Y position on canvas" },
      width: { type: "property", detail: "number", info: "Token width in grid units" },
      height: { type: "property", detail: "number", info: "Token height in grid units" },
      center: { type: "property", detail: "{ x, y }", info: "Token center point" },
      bounds: { type: "property", detail: "PIXI.Rectangle", info: "Token bounding rectangle" },
      visible: { type: "property", detail: "boolean", info: "Whether token is visible" },
      controlled: { type: "property", detail: "boolean", info: "Whether token is controlled" },
      isOwner: { type: "property", detail: "boolean", info: "Whether current user owns this token" },
      inCombat: { type: "property", detail: "boolean", info: "Whether token is in active combat" },
      combatant: { type: "property", detail: "Combatant | null", info: "Associated combatant if in combat" },
      // Methods
      control: { type: "method", detail: "(options?) => boolean", info: "Take control of the token" },
      release: { type: "method", detail: "(options?) => boolean", info: "Release control of the token" },
      setTarget: { type: "method", detail: "(targeted?, options?) => void", info: "Target or untarget the token" },
      toggleEffect: { type: "method", detail: "(effect, options?) => Promise<boolean>", info: "Toggle a status effect" },
      toggleCombat: { type: "method", detail: "() => Promise<Combatant | null>", info: "Toggle combat state" },
    }
  },

  actor: {
    type: "variable", detail: "Actor", info: "Actor instance (available in macros/hooks)",
    children: {
      // Base document properties
      name: { type: "property", detail: "string", info: "Actor name" },
      type: { type: "property", detail: "string", info: "Actor type (character, npc, vehicle, group)" },
      img: { type: "property", detail: "string", info: "Actor image path" },
      uuid: { type: "property", detail: "string", info: "Actor UUID" },
      id: { type: "property", detail: "string", info: "Actor ID" },
      statuses: { type: "property", detail: "Set<string>", info: "Active status effect IDs (prone, poisoned, etc.)" },
      prototypeToken: { type: "property", detail: "object", info: "Default token configuration" },
      folder: { type: "property", detail: "Folder | null", info: "Parent folder" },
      ownership: { type: "property", detail: "object", info: "Permission levels by user ID" },
      isOwner: { type: "property", detail: "boolean", info: "Current user is owner" },
      limited: { type: "property", detail: "boolean", info: "Current user has limited permission" },
      // system children populated at runtime from dnd5e schema by injectSchemaCompletions()
      system: {
        type: "property", detail: "object", info: "Actor system data (populated from system schema)",
        children: {}
      },
      items: { type: "property", detail: "Collection<Item>", info: "Actor's item collection" },
      effects: { type: "property", detail: "Collection<ActiveEffect>", info: "Actor's active effects" },
      classes: { type: "property", detail: "object", info: "Character's class items by identifier" },
      // Methods
      // dnd5e roll methods
      rollAbilityTest: { type: "method", detail: "(abilityId, options?) => Promise<D20Roll>", info: "Roll an ability check" },
      rollAbilitySave: { type: "method", detail: "(abilityId, options?) => Promise<D20Roll>", info: "Roll a saving throw" },
      rollSkill: { type: "method", detail: "(skillId, options?) => Promise<D20Roll>", info: "Roll a skill check" },
      rollDeathSave: { type: "method", detail: "(options?) => Promise<D20Roll>", info: "Roll a death saving throw" },
      rollInitiative: { type: "method", detail: "(options?) => Promise<Combat | null>", info: "Roll initiative" },
      shortRest: { type: "method", detail: "(options?) => Promise<RestResult>", info: "Perform a short rest" },
      longRest: { type: "method", detail: "(options?) => Promise<RestResult>", info: "Perform a long rest" },
      applyDamage: { type: "method", detail: "(amount, options?) => Promise<Actor>", info: "Apply damage/healing to actor" },
      // Document methods
      getRollData: { type: "method", detail: "() => object", info: "Get data for roll formula evaluation" },
      getFlag: { type: "method", detail: "(scope, key) => any", info: "Get a flag value" },
      setFlag: { type: "method", detail: "(scope, key, value) => Promise", info: "Set a flag value" },
      unsetFlag: { type: "method", detail: "(scope, key) => Promise", info: "Remove a flag" },
      update: { type: "method", detail: "(data, context?) => Promise<Actor>", info: "Update the actor document" },
      delete: { type: "method", detail: "(context?) => Promise<Actor>", info: "Delete the actor document" },
      clone: { type: "method", detail: "(data?, options?) => Actor", info: "Clone the actor" },
      toObject: { type: "method", detail: "(source?) => object", info: "Convert to plain object" },
      createEmbeddedDocuments: { type: "method", detail: "(type, data, context?) => Promise<Document[]>", info: "Create embedded items/effects" },
      updateEmbeddedDocuments: { type: "method", detail: "(type, updates, context?) => Promise<Document[]>", info: "Update embedded items/effects" },
      deleteEmbeddedDocuments: { type: "method", detail: "(type, ids, context?) => Promise<Document[]>", info: "Delete embedded items/effects" },
    }
  },

  item: {
    type: "variable", detail: "Item", info: "Item instance (available in macros/hooks)",
    children: {
      // Base document properties
      name: { type: "property", detail: "string", info: "Item name" },
      type: { type: "property", detail: "string", info: "Item type (weapon, spell, feat, equipment, consumable, ...)" },
      img: { type: "property", detail: "string", info: "Item image path" },
      uuid: { type: "property", detail: "string", info: "Item UUID" },
      id: { type: "property", detail: "string", info: "Item ID" },
      isOwner: { type: "property", detail: "boolean", info: "Current user is owner" },
      // system children populated at runtime from dnd5e schema by injectSchemaCompletions()
      system: {
        type: "property", detail: "object", info: "Item system data (populated from system schema)",
        children: {}
      },
      activities: { type: "property", detail: "Collection<Activity>", info: "Item's activities" },
      effects: { type: "property", detail: "Collection<ActiveEffect>", info: "Item's effects" },
      actor: { type: "property", detail: "Actor | null", info: "Owning actor" },
      // dnd5e item methods
      use: { type: "method", detail: "(config?, dialog?, message?) => Promise<ChatMessage[]>", info: "Use the item" },
      roll: { type: "method", detail: "(options?) => Promise<ChatMessage>", info: "Roll the item to chat" },
      displayCard: { type: "method", detail: "(options?) => Promise<ChatMessage>", info: "Display item card in chat" },
      // Document methods
      getRollData: { type: "method", detail: "() => object", info: "Get data for roll formula evaluation" },
      getFlag: { type: "method", detail: "(scope, key) => any", info: "Get a flag value" },
      setFlag: { type: "method", detail: "(scope, key, value) => Promise", info: "Set a flag value" },
      unsetFlag: { type: "method", detail: "(scope, key) => Promise", info: "Remove a flag" },
      update: { type: "method", detail: "(data, context?) => Promise<Item>", info: "Update the item document" },
      delete: { type: "method", detail: "(context?) => Promise<Item>", info: "Delete the item document" },
      clone: { type: "method", detail: "(data?, options?) => Item", info: "Clone the item" },
      toObject: { type: "method", detail: "(source?) => object", info: "Convert to plain object" },
    }
  },

  activity: {
    type: "variable", detail: "Activity", info: "Activity instance (available in hooks)",
    children: {
      type: { type: "property", detail: "string", info: "Activity type (attack, damage, save, heal, utility, summon, enchant)" },
      name: { type: "property", detail: "string", info: "Activity name" },
      item: { type: "property", detail: "Item", info: "Parent item" },
      actor: { type: "property", detail: "Actor | null", info: "Owning actor" },
      activation: {
        type: "property", detail: "object", info: "Activation configuration",
        children: {
          type: { type: "property", detail: "string", info: "Activation type (action, bonus, reaction, ...)" },
          cost: { type: "property", detail: "number", info: "Activation cost" },
          condition: { type: "property", detail: "string", info: "Activation condition" },
        }
      },
      consumption: {
        type: "property", detail: "object", info: "Resource consumption configuration",
        children: {
          targets: { type: "property", detail: "array", info: "Consumption targets" },
          scaling: { type: "property", detail: "object", info: "Consumption scaling" },
        }
      },
      duration: {
        type: "property", detail: "object", info: "Effect duration",
        children: {
          value: { type: "property", detail: "number", info: "Duration value" },
          units: { type: "property", detail: "string", info: "Duration units" },
          concentration: { type: "property", detail: "boolean", info: "Requires concentration" },
        }
      },
      range: {
        type: "property", detail: "object", info: "Range configuration",
        children: {
          value: { type: "property", detail: "number", info: "Range value" },
          units: { type: "property", detail: "string", info: "Range units" },
          special: { type: "property", detail: "string", info: "Special range notes" },
        }
      },
      target: {
        type: "property", detail: "object", info: "Targeting configuration",
        children: {
          template: { type: "property", detail: "object", info: "Template configuration { type, size, units }" },
          affects: { type: "property", detail: "object", info: "What the activity affects { type, count, ... }" },
          prompt: { type: "property", detail: "boolean", info: "Prompt for targets" },
        }
      },
      damage: {
        type: "property", detail: "object", info: "Damage configuration (AttackActivity, DamageActivity)",
        children: {
          parts: { type: "property", detail: "array", info: "Damage parts [{ formula, types, scaling }]" },
          critical: { type: "property", detail: "object", info: "Critical hit configuration" },
        }
      },
      save: {
        type: "property", detail: "object", info: "Save configuration (SaveActivity)",
        children: {
          ability: { type: "property", detail: "string", info: "Save ability" },
          dc: { type: "property", detail: "object", info: "DC configuration { calculation, formula }" },
        }
      },
      attack: {
        type: "property", detail: "object", info: "Attack configuration (AttackActivity)",
        children: {
          ability: { type: "property", detail: "string", info: "Attack ability" },
          bonus: { type: "property", detail: "string", info: "Attack bonus formula" },
          type: { type: "property", detail: "object", info: "Attack type { value, classification }" },
          flat: { type: "property", detail: "boolean", info: "Flat attack (no ability mod)" },
        }
      },
      healing: {
        type: "property", detail: "object", info: "Healing configuration (HealActivity)",
        children: {
          formula: { type: "property", detail: "string", info: "Healing formula" },
          types: { type: "property", detail: "Set<string>", info: "Healing types" },
          scaling: { type: "property", detail: "object", info: "Scaling configuration" },
        }
      },
      effects: { type: "property", detail: "array", info: "Effects applied by this activity" },
      uses: {
        type: "property", detail: "object", info: "Activity uses (separate from item uses)",
        children: {
          value: { type: "property", detail: "number", info: "Current uses" },
          max: { type: "property", detail: "string", info: "Maximum uses" },
          recovery: { type: "property", detail: "array", info: "Recovery configuration" },
        }
      },
      // Methods
      use: { type: "method", detail: "(usage?, dialog?, message?) => Promise<ChatMessage[]>", info: "Use this activity" },
      rollAttack: { type: "method", detail: "(config?, dialog?, message?) => Promise<D20Roll[]>", info: "Roll attack (AttackActivity)" },
      rollDamage: { type: "method", detail: "(config?, dialog?, message?) => Promise<DamageRoll[]>", info: "Roll damage" },
      getRollData: { type: "method", detail: "() => object", info: "Get data for roll formula evaluation" },
      getFlag: { type: "method", detail: "(scope, key) => any", info: "Get a flag value" },
      setFlag: { type: "method", detail: "(scope, key, value) => Promise", info: "Set a flag value" },
      unsetFlag: { type: "method", detail: "(scope, key) => Promise", info: "Remove a flag" },
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
    type: "variable", detail: "object", info: "Macro scope object",
    children: {
      actor: { type: "property", detail: "Actor", info: "The actor using the item" },
      token: { type: "property", detail: "Token", info: "The token using the item" },
      item: { type: "property", detail: "Item", info: "The item being used" },
      activity: { type: "property", detail: "Activity", info: "The activity being used" },
    }
  },
};

// ── Schema walking for dnd5e DataModels ──

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
    // Don't overwrite existing entries (hardcoded takes precedence)
    if (!(key in target.children)) {
      target.children[key] = value;
    } else if (value.children && target.children[key]) {
      // Recursively merge children
      mergeCompletions(target.children[key], value.children);
    }
  }
}

/**
 * Inject schema-generated completions for dnd5e actors and items.
 * Called at runtime when dnd5e is available.
 */
let _schemaInjected = false;
function injectSchemaCompletions(): void {
  if (_schemaInjected) return;

  const dnd5e = (globalThis as any).dnd5e;
  if (!dnd5e?.dataModels) {
    console.log("macro-autocomplete | dnd5e.dataModels not available, skipping schema injection");
    return;
  }

  console.log("macro-autocomplete | Injecting schema-generated completions for Actor and Item");

  try {
    // Get actor schemas - merge CharacterData and NPCData for comprehensive coverage
    const actorSchemas = [
      dnd5e.dataModels.actor?.CharacterData,
      dnd5e.dataModels.actor?.NPCData,
    ].filter(Boolean);

    if (actorSchemas.length > 0 && COMPLETION_TREE.actor?.children?.system) {
      for (const DataModel of actorSchemas) {
        if (DataModel?.schema) {
          const schemaCompletions = schemaToCompletions(DataModel.schema);
          mergeCompletions(COMPLETION_TREE.actor.children.system, schemaCompletions);
        }
      }
      console.log("macro-autocomplete | Injected actor system schema completions");
    }

    // Get item schemas - merge all item types for comprehensive coverage
    const itemDataModels = dnd5e.dataModels.item;
    if (itemDataModels && COMPLETION_TREE.item?.children?.system) {
      const itemSchemas = Object.values(itemDataModels).filter((dm: any) => dm?.schema);
      for (const DataModel of itemSchemas as any[]) {
        const schemaCompletions = schemaToCompletions(DataModel.schema);
        mergeCompletions(COMPLETION_TREE.item.children.system, schemaCompletions);
      }
      console.log("macro-autocomplete | Injected item system schema completions");
    }

    _schemaInjected = true;

    // Also inject fvtt-types generated completions
    injectFoundryCompletions();

    // Inject CONFIG completions from runtime
    injectConfigCompletions();

    // Rebuild signature map with new completions
    rebuildSignatureMap();

    // Fire ready hook so other modules can inject their completions
    (Hooks as any).callAll("macro-autocomplete.ready", { tree: COMPLETION_TREE, rebuildSignatureMap });

  } catch (err) {
    console.error("macro-autocomplete | Error injecting schema completions:", err);
  }
}

/**
 * Inject completions generated from fvtt-types at build time.
 * These provide Foundry core types like Actor, Item, Roll, Dialog, Hooks, etc.
 */
function injectFoundryCompletions(): void {
  if (!foundryCompletions || typeof foundryCompletions !== "object") {
    console.log("macro-autocomplete | foundryCompletions not available");
    return;
  }

  console.log("macro-autocomplete | Injecting fvtt-types generated completions");

  try {
    // Merge each type from foundryCompletions into COMPLETION_TREE
    for (const [typeName, typeEntry] of Object.entries(foundryCompletions)) {
      const entry = typeEntry as { type?: string; detail?: string; info?: string; children?: CompletionNode };

      // Skip if no children (empty types like Game with 0 members)
      if (!entry.children || Object.keys(entry.children).length === 0) continue;

      if (COMPLETION_TREE[typeName]) {
        // Merge into existing entry
        mergeCompletions(COMPLETION_TREE[typeName], entry.children);
      } else {
        // Add as new entry
        COMPLETION_TREE[typeName] = entry as any;
      }
    }

    console.log(`macro-autocomplete | Merged ${Object.keys(foundryCompletions).length} foundry type completions`);
  } catch (err) {
    console.error("macro-autocomplete | Error injecting foundry completions:", err);
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
    // Try to extract parameter info from function
    const fnStr = value.toString();
    const match = fnStr.match(/^(?:function\s*\w*\s*)?(\([^)]*\))|^(\([^)]*\))\s*=>/);
    const params = match ? (match[1] || match[2]) : "()";
    return { type: "function", detail: `${params} => any`, info: value.name || "function" };
  }

  if (Array.isArray(value)) {
    return { type: "property", detail: `array[${value.length}]`, info: "Array" };
  }

  if (type === "object") {
    // Check if it's a class/constructor
    if (value.prototype && value.name) {
      return { type: "class", detail: `class ${value.name}`, info: value.name };
    }

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

    console.log(`macro-autocomplete | Injected ${count} CONFIG entries`);
  } catch (err) {
    console.error("macro-autocomplete | Error injecting config completions:", err);
  }
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
    if (entry.children) {
      buildSignatureMap(entry.children, fullPath);
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
  const funcPath = match[1];

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
 * Navigate the completion tree to find the node at the given path segments.
 * Returns the children of the deepest matched node.
 */
function getCompletionsForPath(segments: string[]): CompletionNode | null {
  let node = COMPLETION_TREE;
  for (const seg of segments) {
    const entry = node[seg];
    if (!entry?.children) return null;
    node = entry.children;
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

// ── Completion source ──

/**
 * Custom completion source for Foundry macros.
 * Context-aware: completes one segment at a time based on the dotted path prefix.
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
    const found = getCompletionsForPath(pathSegments);
    if (!found) return null;
    node = found;
  }

  const options = Object.entries(node)
    .filter(([key]) => key.toLowerCase().startsWith(currentSegment.toLowerCase()))
    .map(([key, entry]) => {
      const hasChildren = !!entry.children;
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

async function enhanceCodeMirror(element: HTMLElement): Promise<void> {
  if (enhancedElements.has(element)) return;

  await new Promise(resolve => setTimeout(resolve, 200));

  const view = getEditorView(element);
  if (!view) {
    console.warn("macro-autocomplete | Could not access CodeMirror EditorView");
    return;
  }

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
