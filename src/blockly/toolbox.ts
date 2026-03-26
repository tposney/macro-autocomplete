/**
 * Builds the Blockly toolbox definition from the completion tree categories.
 *
 * The toolbox is organized into:
 * 1. Built-in programming blocks (logic, variables, control flow)
 * 2. Dynamic categories generated from the completion tree
 */

import { getAllCategoryConfigs } from "./blocklyConfig";

/** Toolbox category definition for Blockly */
interface ToolboxCategory {
  kind: "category";
  name: string;
  colour?: string;
  contents: (ToolboxBlock | ToolboxButton)[];
}

interface ToolboxBlock {
  kind: "block";
  type: string;
  inputs?: Record<string, { shadow?: { type: string; fields?: Record<string, string> }; block?: { type: string; fields?: Record<string, string> } }>;
  fields?: Record<string, string>;
}

interface ToolboxButton {
  kind: "button";
  text: string;
  callbackKey: string;
}

interface ToolboxSeparator {
  kind: "sep";
}

interface ToolboxDef {
  kind: "categoryToolbox";
  contents: (ToolboxCategory | ToolboxSeparator)[];
}

/** Template macro definition */
export interface MacroTemplate {
  /** Display name shown on the button */
  name: string;
  /** Unique callback key for Blockly workspace registration */
  callbackKey: string;
  /** JavaScript source code that gets parsed into blocks */
  source: string;
}

/** Pre-built macro templates for new users */
export const MACRO_TEMPLATES: MacroTemplate[] = [
  {
    name: "Apply Damage",
    callbackKey: "template_applyDamage",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const damage = await foundry.applications.api.DialogV2.prompt({
  window: {title: "Apply Damage"},
  content: '<input type="number" name="amount" value="10">',
  ok: {callback: (event, button) => button.form.elements.amount.valueAsNumber}
});
await _token.actor.applyDamage(damage);
`,
  },
  {
    name: "Heal Token",
    callbackKey: "template_heal",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const amount = await foundry.applications.api.DialogV2.prompt({
  window: {title: "Heal"},
  content: '<input type="number" name="amount" value="10">',
  ok: {callback: (event, button) => button.form.elements.amount.valueAsNumber}
});
await _token.actor.applyDamage(-amount);
`,
  },
  {
    name: "Toggle Status Effect",
    callbackKey: "template_toggleEffect",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await _token.actor.toggleStatusEffect("prone");
`,
  },
  {
    name: "Roll Saving Throw",
    callbackKey: "template_rollSave",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await _token.actor.rollSavingThrow({ability: "dex"});
`,
  },
  {
    name: "Roll Skill Check",
    callbackKey: "template_rollSkill",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await _token.actor.rollSkill({skill: "prc"});
`,
  },
  {
    name: "Roll Ability Check",
    callbackKey: "template_rollAbility",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await _token.actor.rollAbilityCheck({ability: "str"});
`,
  },
  {
    name: "Short Rest",
    callbackKey: "template_shortRest",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await _token.actor.shortRest({dialog: true, chat: true, autoHD: false});
`,
  },
  {
    name: "Set HP",
    callbackKey: "template_setHP",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const hp = await foundry.applications.api.DialogV2.prompt({
  window: {title: "Set HP"},
  content: \`<input type="number" name="amount" value="\${_token.actor.system.attributes.hp.max}">\`,
  ok: {callback: (event, button) => button.form.elements.amount.valueAsNumber}
});
await _token.actor.update({"system.attributes.hp.value": hp});
`,
  },
  {
    name: "Chat Message with Roll",
    callbackKey: "template_chatRoll",
    source: `\
const roll = await new Roll("1d20").evaluate();
const speaker = ChatMessage.getSpeaker();
await ChatMessage.create({
  speaker: speaker,
  content: "Rolled: " + roll.total
});
`,
  },
  {
    name: "Whisper GM",
    callbackKey: "template_whisperGM",
    source: `\
const speaker = ChatMessage.getSpeaker();
await ChatMessage.create({
  speaker: speaker,
  content: "Secret message to the GM",
  whisper: ChatMessage.getWhisperRecipients("GM")
});
`,
  },
  {
    name: "Roll on Table",
    callbackKey: "template_rollTable",
    source: `\
const table = game.tables.getName("My Table");
if (!table) {
  ui.notifications.warn("Table not found");
  return;
}
await table.draw();
`,
  },
  {
    name: "Play Sound",
    callbackKey: "template_playSound",
    source: `\
AudioHelper.play({src: "sounds/dice.wav", volume: 0.8, loop: false}, true);
`,
  },
  {
    name: "Toggle Light",
    callbackKey: "template_toggleLight",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const hasLight = _token.document.light.bright > 0;
await _token.document.update({
  "light.bright": hasLight ? 0 : 40,
  "light.dim": hasLight ? 0 : 60,
  "light.color": "#ffcc00"
});
`,
  },
  {
    name: "Confirm Dialog",
    callbackKey: "template_confirmDialog",
    source: `\
const yes = await foundry.applications.api.DialogV2.confirm({
  window: {title: "Are you sure?"},
  content: "<p>Do you want to proceed?</p>"
});
if (yes) {
  ui.notifications.info("Confirmed");
}
`,
  },
  {
    name: "Modify Token Scale",
    callbackKey: "template_tokenScale",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const scale = await foundry.applications.api.DialogV2.prompt({
  window: {title: "Set Token Scale"},
  content: '<input type="number" name="amount" value="' + _token.document.texture.scaleX + '" step="0.1">',
  ok: {callback: (event, button) => button.form.elements.amount.valueAsNumber}
});
await _token.document.update({"texture.scaleX": scale, "texture.scaleY": scale});
`,
  },
];

/** Sample blocks added when chris-premades (CPR) is active */
const CPR_TEMPLATES: MacroTemplate[] = [
  {
    name: "CPR: Apply Condition",
    callbackKey: "template_cprCondition",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
await chrisPremades.utils.effectUtils.applyConditions(_token.actor, ["prone"]);
`,
  },
  {
    name: "CPR: Custom Dialog",
    callbackKey: "template_cprDialog",
    source: `\
const result = await chrisPremades.DialogApp.dialog(
  "Choose an Option",
  "Pick one of the following:",
  [["button", [["Option A", "a"], ["Option B", "b"]]]],
  "okCancel"
);
if (result) {
  ui.notifications.info("Selected: " + result.buttons);
}
`,
  },
];

/** Sample blocks added when midi-qol is active */
const MIDI_TEMPLATES: MacroTemplate[] = [
  {
    name: "Midi: Complete Activity Use",
    callbackKey: "template_midiActivityUse",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const item = _token.actor.items.getName("Longsword");
if (!item) {
  ui.notifications.warn("Item not found");
  return;
}
const activity = item.system.activities.contents[0];
await MidiQOL.completeActivityUse(activity, {
  midiOptions: {
    targetUuids: [Array.from(game.user.targets)[0]?.document.uuid].filter(Boolean)
  }
});
`,
  },
  {
    name: "Midi: Complete Item Use",
    callbackKey: "template_midiItemUse",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const item = _token.actor.items.getName("Longsword");
if (!item) {
  ui.notifications.warn("Item not found");
  return;
}
await MidiQOL.completeItemUse(item, {
  midiOptions: { fastForward: true }
});
`,
  },
  {
    name: "Midi: Create Effect with Flags",
    callbackKey: "template_midiEffect",
    source: `\
if (!_token) {
  ui.notifications.warn("Select a token first");
  return;
}
const effectData = {
  name: "My Custom Effect",
  icon: "icons/svg/aura.svg",
  duration: { rounds: 3 },
  changes: [
    {
      key: "flags.midi-qol.advantage.attack.mwak",
      mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
      value: "1"
    },
    {
      key: "flags.midi-qol.grants.disadvantage.attack.all",
      mode: CONST.ACTIVE_EFFECT_MODES.CUSTOM,
      value: "targetActorUuid === \\"\\" || true"
    }
  ]
};
await _token.actor.createEmbeddedDocuments("ActiveEffect", [effectData]);
ui.notifications.info("Effect applied to " + _token.name);
`,
  },
  {
    name: "Midi: Template + Damage",
    callbackKey: "template_midiTemplateDamage",
    source: `\
const cx = canvas.dimensions.width / 2;
const cy = canvas.dimensions.height / 2;
const templateDoc = new CONFIG.MeasuredTemplate.documentClass({
  t: "circle",
  distance: 20,
  x: cx,
  y: cy,
  fillColor: game.user.color,
  user: game.user.id
}, {parent: canvas.scene});
const template = new dnd5e.canvas.AbilityTemplate(templateDoc);
let placedDocs;
try {
  placedDocs = await template.drawPreview();
} catch (e) {
  ui.notifications.info("Template placement cancelled");
  return;
}
const placed = canvas.templates.get(placedDocs[0]?.id);
if (!placed) return;
const targets = MidiQOL.selectTargetsFromTemplates([placed]);
if (!targets.length) {
  ui.notifications.warn("No targets in template");
  await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [placed.document.id]);
  return;
}
const props = new Set();
const targetDamages = [];
for (const t of targets) {
  targetDamages.push({token: t, damageDetail: [{value: 5, type: "piercing", properties: props}, {value: 5, type: "acid", properties: props}], totalDamage: 10});
}
await MidiQOL.applyTokenDamageMany(targetDamages, null);
await new Promise(resolve => setTimeout(resolve, 1000));
await canvas.scene.deleteEmbeddedDocuments("MeasuredTemplate", [placed.document.id]);
`,
  },
  {
    name: "Midi: Apply Token Damage",
    callbackKey: "template_midiApplyDamage",
    source: `\
const targets = Array.from(game.user.targets);
if (!targets.length) {
  ui.notifications.warn("Select one or more targets first");
  return;
}
const props = new Set();
const targetDamages = [];
for (const t of targets) {
  targetDamages.push({token: t, damageDetail: [{value: 10, type: "fire", properties: props}], totalDamage: 10});
}
await MidiQOL.applyTokenDamageMany(targetDamages, null);
`,
  },
];

/**
 * Get all available templates, including CPR/midi-qol templates if those modules are active.
 */
export function getAllTemplates(): MacroTemplate[] {
  const templates = [...MACRO_TEMPLATES];
  const game = (globalThis as any).game;
  if (game?.modules?.get("chris-premades")?.active) {
    templates.push(...CPR_TEMPLATES);
  }
  if (game?.modules?.get("midi-qol")?.active) {
    templates.push(...MIDI_TEMPLATES);
  }
  return templates;
}

/**
 * Build the complete toolbox definition from categories map.
 */
export function buildToolbox(categories: Map<string, string[]>): ToolboxDef {
  const contents: (ToolboxCategory | ToolboxSeparator)[] = [];

  // ── Standard Blockly blocks + custom macro blocks ──

  // Logic
  contents.push({
    kind: "category",
    name: "Logic",
    colour: "#5b80a5",
    contents: [
      { kind: "block", type: "controls_if" },
      { kind: "block", type: "logic_compare" },
      { kind: "block", type: "mac_logic_and" },
      { kind: "block", type: "mac_logic_or" },
      { kind: "block", type: "logic_negate" },
      { kind: "block", type: "logic_boolean" },
      { kind: "block", type: "logic_null" },
      { kind: "block", type: "logic_ternary" },
      { kind: "block", type: "mac_race_includes" },
    ],
  });

  // Control Flow (mix of standard loops + custom)
  contents.push({
    kind: "category",
    name: "Control Flow",
    colour: "#5ba580",
    contents: [
      {
        kind: "block", type: "mac_for_loop",
        inputs: {
          INIT: { shadow: { type: "mac_shadow_input", fields: { CODE: "0" } } },
          CONDITION: { block: { type: "mac_compare", fields: { OP: "<" } } },
          UPDATE: { shadow: { type: "mac_shadow_input", fields: { CODE: "i++" } } },
        },
        fields: { VAR: "i" },
      },
      { kind: "block", type: "mac_for_of" },
      { kind: "block", type: "controls_whileUntil" },
      { kind: "block", type: "controls_repeat_ext" },
      { kind: "block", type: "controls_flow_statements" },
      { kind: "block", type: "mac_try_catch" },
      { kind: "block", type: "mac_return" },
      { kind: "block", type: "mac_await" },
    ],
  });

  // Math (standard Blockly blocks)
  contents.push({
    kind: "category",
    name: "Math",
    colour: "#5b67a5",
    contents: [
      { kind: "block", type: "math_number" },
      { kind: "block", type: "math_arithmetic" },
      { kind: "block", type: "math_single" },
      { kind: "block", type: "math_modulo" },
      { kind: "block", type: "math_constrain" },
      { kind: "block", type: "math_random_int" },
      { kind: "block", type: "math_round" },
    ],
  });

  // Text (standard + custom template literal)
  contents.push({
    kind: "category",
    name: "Text",
    colour: "#5ba55b",
    contents: [
      { kind: "block", type: "text" },
      { kind: "block", type: "mac_string_join" },
      { kind: "block", type: "mac_template_literal" },
      { kind: "block", type: "text_join" },
      { kind: "block", type: "text_length" },
      { kind: "block", type: "text_isEmpty" },
      { kind: "block", type: "text_indexOf" },
      { kind: "block", type: "text_changeCase" },
      { kind: "block", type: "text_trim" },
    ],
  });

  // Lists (standard Blockly blocks)
  contents.push({
    kind: "category",
    name: "Lists",
    colour: "#745ba5",
    contents: [
      { kind: "block", type: "mac_list_create" },
      { kind: "block", type: "lists_length" },
      { kind: "block", type: "lists_isEmpty" },
      { kind: "block", type: "lists_indexOf" },
      { kind: "block", type: "lists_getIndex" },
      { kind: "block", type: "lists_sort" },
      { kind: "block", type: "lists_split" },
      { kind: "block", type: "lists_reverse" },
      { kind: "block", type: "mac_list_method" },
      { kind: "block", type: "mac_list_forEach" },
      { kind: "block", type: "mac_value_in_list" },
    ],
  });

  // Variables (custom JS-style declarations)
  contents.push({
    kind: "category",
    name: "Variables",
    colour: "#a55b99",
    contents: [
      { kind: "block", type: "mac_const" },
      { kind: "block", type: "mac_let" },
      { kind: "block", type: "mac_typed_var" },
    ],
  });

  // Functions (custom function definition blocks with async support)
  contents.push({
    kind: "category",
    name: "Functions",
    colour: "#995ba5",
    contents: [
      { kind: "block", type: "mac_function_def" },
      { kind: "block", type: "mac_function_def_return" },
      { kind: "block", type: "mac_arrow_function" },
      { kind: "block", type: "mac_arrow_function_return" },
    ],
  });

  // Output (custom Foundry-specific)
  contents.push({
    kind: "category",
    name: "Output",
    colour: "#a5805b",
    contents: [
      { kind: "block", type: "mac_console_error" },
      { kind: "block", type: "mac_console_log" },
      { kind: "block", type: "mac_console_warn" },
      { kind: "block", type: "mac_ui_notifications_warn" },
      { kind: "block", type: "mac_ui_notifications_info" },
      { kind: "block", type: "mac_ui_notifications_error" },
    ],
  });

  // Utilities (common JS utility functions)
  contents.push({
    kind: "category",
    name: "Utilities",
    colour: "#a5805b",
    contents: [
      { kind: "block", type: "mac_await_promise" },
      {
        kind: "block", type: "mac_setTimeout",
        inputs: {
          DELAY: { shadow: { type: "mac_shadow_input", fields: { CODE: "1000" } } },
        },
      },
      {
        kind: "block", type: "mac_setInterval",
        inputs: {
          DELAY: { shadow: { type: "mac_shadow_input", fields: { CODE: "1000" } } },
        },
      },
      { kind: "block", type: "mac_object_keys" },
      { kind: "block", type: "mac_object_values" },
      { kind: "block", type: "mac_object_entries" },
      { kind: "block", type: "mac_array_from" },
      { kind: "block", type: "mac_instanceof" },
    ],
  });

  // JavaScript (core JS constructs + escape hatches)
  contents.push({
    kind: "category",
    name: "JavaScript",
    colour: "#7f8c8d",
    contents: [
      { kind: "block", type: "mac_expr_statement" },
      { kind: "block", type: "mac_object_literal" },
      { kind: "block", type: "mac_comment" },
      { kind: "block", type: "mac_raw_expression" },
      { kind: "block", type: "mac_raw_statement" },
    ],
  });

  // Sample Blocks — pre-built macro examples users can load
  const allTemplates = getAllTemplates();
  contents.push({
    kind: "category",
    name: "Sample Blocks",
    colour: "#e07020",
    contents: allTemplates.map((t) => ({
      kind: "button" as const,
      text: t.name,
      callbackKey: t.callbackKey,
    })),
  });

  // Separator between built-in and dynamic categories
  contents.push({ kind: "sep" });

  const categoryConfig = getAllCategoryConfigs();

  // Sort dynamic categories by configured order, then alphabetically
  const sortedCategories = Array.from(categories.entries())
    .filter(([, blocks]) => blocks.length > 0)
    .sort(([a], [b]) => {
      const orderA = categoryConfig[a]?.order ?? 100;
      const orderB = categoryConfig[b]?.order ?? 100;
      if (orderA !== orderB) return orderA - orderB;
      return a.localeCompare(b);
    });

  for (const [catName, blockTypes] of sortedCategories) {
    const config = categoryConfig[catName];
    // Sort blocks alphabetically within each category for consistent ordering
    const sorted = [...blockTypes].sort((a, b) => a.localeCompare(b));
    contents.push({
      kind: "category",
      name: config?.display ?? catName,
      colour: config?.colour,
      contents: sorted.map((type) => ({ kind: "block", type })),
    });
  }

  return { kind: "categoryToolbox", contents };
}
