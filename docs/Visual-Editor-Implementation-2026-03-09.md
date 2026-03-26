# Visual Programming Editor — Implementation

## Overview

The macro-autocomplete module includes an optional visual block-based programming editor built on Google Blockly. Users can toggle between the standard CodeMirror text editor and a drag-and-drop block editor. The visual editor generates valid JavaScript code from the block arrangements.

Blocks are **auto-generated from the existing completion tree** — the same data structure that powers text autocompletion. Any module that registers completions via the `macro-autocomplete.ready` hook (e.g., midi-qol, dae) automatically gets corresponding Blockly blocks without additional integration work.

A client setting ("Enable Visual Editor") controls whether the toggle button appears. When disabled, the Blockly chunk is never loaded.

## Technology

**Google Blockly 12.4.1** (Apache-2.0 license) was chosen because it:

- Generates executable JavaScript from visual blocks
- Works as vanilla JavaScript with no framework dependency
- Supports custom block definitions with full control over generated code
- Is actively maintained

**acorn** is used for JavaScript parsing (JS-to-blocks conversion when switching from text to visual mode).

## Bundle Strategy

The Blockly library (~1.8 MB) is **lazy-loaded via code splitting**. The main `macro-autocomplete.js` bundle remains at ~160 KB and loads at startup. The Blockly chunk only loads when the user clicks the "Visual Editor" toggle for the first time.

This is achieved by:
1. Using a dynamic `import("./blockly/editor")` in the main module
2. Configuring esbuild with `splitting: true` and `outdir` (instead of `outfile`)
3. Chunks are output to a `chunks/` subdirectory with hashed filenames

```
modules/macro-autocomplete/
├── macro-autocomplete.js          (~160 KB — main module, loads at startup)
├── macro-autocomplete.js.map
├── chunks/
│   ├── editor-XXXXXXXX.js         (~1.8 MB — Blockly + blocks, lazy-loaded)
│   ├── editor-XXXXXXXX.js.map
│   ├── chunk-XXXXXXXX.js          (~1.5 KB — shared esbuild helpers)
│   └── chunk-XXXXXXXX.js.map
├── module.json
└── README.md
```

## Source File Structure

```
src/
├── macro-autocomplete.ts          Main module (autocompletion + visual editor integration)
├── lib/
│   └── foundryCompletions.json    Generated type data from fvtt-types
└── blockly/
    ├── index.ts                   Barrel export
    ├── editor.ts                  BlocklyEditor workspace manager
    ├── treeToBlocks.ts            Completion tree → Blockly block definitions + code generators
    ├── toolbox.ts                 Toolbox category builder
    └── jsToBlocks.ts              JavaScript → Blockly blocks parser (via acorn AST)
```

## How It Works

### 1. Completion Tree → Block Definitions (`treeToBlocks.ts`)

The completion tree is a nested object where each entry has:
```typescript
interface CompletionEntry {
  type?: string;           // "function", "method", "property", "variable", "class", "object"
  detail?: string;         // Type signature, e.g. "(item, options?) => Promise<Workflow>"
  info?: string;           // Description text
  children?: CompletionNode;
  staticChildren?: CompletionNode;
  instanceChildren?: CompletionNode;
}
```

The `registerBlocksFromTree()` function walks this tree (up to depth 4) and creates three types of blocks:

**Function blocks** — for entries with `type: "function"` or `type: "method"`. The `detail` string is parsed to extract parameter names. Each required parameter becomes an input socket; optional parameters are grouped into a single "options" input. The generator produces `await path.to.func(param1, param2)` with `await` added when the return type contains `Promise`.

**Property blocks** — for entries with `type: "property"` or `type: "variable"` that have no children. These are value blocks (output connector, no statement connectors) that generate the dotted path, e.g., `workflow.isCritical`.

**Namespace dropdown blocks** — for entries with children (objects, variables with sub-properties). These present cascading dropdowns of child keys, generating `path.child.subchild`. Selecting an option that has its own children adds another dropdown level, allowing navigation like `actor.abilities.str.mod`.

Block type names are derived from the dotted path: `game.settings.get` → `mac_game_settings_get`. A registry prevents duplicate definitions.

### 2. Built-in Programming Blocks

In addition to tree-generated blocks, `registerBuiltinBlocks()` creates standard programming constructs:

| Block | Code Generated | Notes |
|-------|---------------|-------|
| AND (multi-input) | `a && b && c` | Blue, +/- buttons to add/remove conditions |
| OR (multi-input) | `a \|\| b \|\| c` | Orange, +/- buttons |
| NOT | `!value` | |
| comparison | `left === right`, `>`, `<`, etc. | Dropdown operator |
| if/else | `if (cond) { ... } else { ... }` | |
| for...of | `for (const item of iterable) { ... }` | |
| try/catch | `try { ... } catch (err) { ... }` | |
| return | `return value;` | |
| await | `await expression` | |
| const/let | `const name = value;` | |
| string literal | `"text"` | |
| number literal | `42` | |
| template literal | `` `template ${expr}` `` | |
| list create | `[a, b, c]` | +/- buttons for items |
| list includes | `list.includes(value)` | |
| value in list | `["a", "b"].includes(expr)` | Inline literal array |
| race includes | `["humanoid"].includes(raceOrType)` | Dropdown for field selection |
| console.error | `console.error(msg);` | |
| warn notification | `ui.notifications.warn(msg);` | |
| info notification | `ui.notifications.info(msg);` | |
| raw JS expression | Any typed JavaScript (value output) | Escape hatch |
| raw JS statement | Any typed JavaScript (statement) | Escape hatch |
| typed variable | `varName.property` | Type-aware property access |

The multi-input AND/OR blocks use green +/red - button icons (inline SVG) to add/remove condition slots. Minimum 2 conditions. They are visually distinct (AND blue, OR orange) to prevent confusion when nesting.

The list create block uses the same +/- pattern. Items can be reduced to 0 for an empty array.

### 3. JS-to-Blocks Parser (`jsToBlocks.ts`)

When switching from text to visual mode, existing JavaScript code is parsed via **acorn** into an AST and converted to Blockly blocks:

- **Variable declarations** (`const`/`let`) → `mac_const`/`mac_let` blocks
- **If/else statements** → `mac_if_else` or standard `controls_if` blocks
- **For...of loops** → `mac_for_of` blocks
- **Try/catch** → `mac_try_catch` blocks
- **Return/await** → corresponding blocks
- **Binary expressions** (`===`, `>`, `+`, etc.) → comparison or arithmetic blocks
- **Logical expressions** (`&&`, `||`) → multi-input AND/OR blocks (chains are flattened: `a && b && c` parsed as `(a && b) && c` becomes a single 3-input AND block)
- **Call expressions** → matched against registered function blocks, or raw expression fallback
- **`[...].includes(expr)`** → `mac_value_in_list` block
- **Array literals** → `mac_list_create` block
- **Member expressions** → matched against registered namespace/property blocks
- **Unrecognized patterns** → raw JS expression/statement blocks

The parser preserves code that can't be represented as blocks by wrapping it in raw JS blocks, ensuring no data loss on round-trip.

### 4. Toolbox Organization (`toolbox.ts`)

The toolbox is organized into two sections separated by a divider:

**Built-in categories** (always present):
- Logic — if/else, comparisons, AND/OR, NOT, race includes
- Control Flow — for...of, while, repeat, try/catch, return, await
- Math — numbers, arithmetic, rounding, random
- Text — strings, templates, join, length, case
- Lists — list create (+/-), length, includes, indexOf, sort
- Variables — const/let declarations, typed variable access
- Output — console.error, warn/info notifications
- Raw JavaScript — escape hatch blocks

**Dynamic categories** (generated from completion tree):
- Sorted by priority: Workflow, Actor, Token, Item, Macro Args first
- Then module namespaces: MidiQOL, Chris Premades
- Then Foundry core: Game, Canvas, UI, Hooks, CONFIG, Constants
- Then document classes: Chat Messages, Rolls, Dialogs
- Then system: dnd5e System

Each category has a configured display name, colour, and sort order. Unknown categories from new module registrations fall back to alphabetical sorting.

### 5. Context-Scoped Toolbox

The `setContextCompletions` API accepts an optional third parameter: `blocklyCategories`, a `Record<string, Record<string, CompletionEntry>>` mapping category display names to entries. When provided, the Blockly editor shows only these categories instead of the global tree.

This is used by midi-qol's ConditionEditor to show only the variables available in the condition sandbox:
- **Actor Data** — `actor.raceOrType`, `actor.abilities`, `actor.attributes`, etc. (green blocks)
- **Target Data** — `target.saved`, `target.isHit`, `target.abilities`, etc. (purple blocks)
- **Workflow** — `hasSave`, `hasAttack`, `item`, `workflow.activity.actionType`
- **World** — `worldTime`
- **Combat** — `combatRound`, `combatTurn`, `combatTime`, `isCombatTurn`
- **Functions** — `findNearby`, `hasCondition`, `computeDistance`, etc.

Entries within each context category are sorted alphabetically in the toolbox.

The `BlocklyEditor.setContextCategories()` method registers property, function, or namespace blocks as needed from the category spec. Namespace entries (those with children) produce cascading dropdown blocks; leaf entries produce simple property blocks; entries with `type: "function"` produce function blocks with parameter inputs.

### 6. Workspace Management (`editor.ts`)

The `BlocklyEditor` class manages the lifecycle of a single Blockly workspace:

**Initialization flow:**
1. `initBlockly(tree)` stores a reference to the completion tree
2. On first `show()`, blocks are lazily registered from the tree via `ensureBlocksRegistered()`
3. Blockly workspace is injected into a container div inserted after the code-mirror element

**Mode switching:**
- `show()` — captures CodeMirror content, hides code-mirror, shows Blockly container. If the user edited the text since last visual session, re-parses via `jsToBlocks()`. Otherwise restores saved workspace state.
- `hide()` — if blocks were placed, generates JavaScript via `workspaceToCode()` and writes it to CodeMirror. If no blocks were placed, restores the original text. Saves workspace state for later.
- `toggle()` — switches between modes

**Workspace serialization:**
Workspace state is saved as JSON via `Blockly.serialization.workspaces.save()` when switching to text mode, and restored when switching back. The `saveExtraState`/`loadExtraState` methods on custom blocks (AND/OR, list create) preserve their dynamic input counts through serialization.

**Code change detection:**
When switching from text to visual mode, the editor compares the current CodeMirror content against `lastCodeOutput` (the code last written by the visual editor). If they differ, the workspace is cleared and the new code is re-parsed into blocks. This allows users to edit in text mode and have their changes reflected in visual mode.

**Theme:**
A custom "foundry" theme with dark colours matching Foundry VTT's UI:
- Workspace background: `#1a1a2e`
- Toolbox background: `#16213e`
- Light text on dark backgrounds
- Signika font (matching Foundry's default)

**Workspace features enabled:**
- Scrollbars and drag panning
- Trashcan for block deletion
- Zoom controls (mouse wheel + buttons, 0.3x to 2x)
- Grid snapping (20px spacing)
- Zelos renderer (rounded, modern block style)
- Sounds disabled

### 7. Main Module Integration (`macro-autocomplete.ts`)

**Settings:**
A client-scoped boolean setting "Enable Visual Editor" (default: true) controls whether the toggle button is shown. Requires reload.

**Toggle button injection:**
When `enhanceCodeMirror()` processes a code-mirror element, it calls `addVisualEditorToggle()` (if the setting is enabled) which inserts a toolbar div above the editor with a toggle button. The button shows "Visual Editor" (puzzle piece icon) in text mode and "Text Editor" (code icon) in visual mode.

**Lazy loading:**
The `getBlocklyModule()` async function uses `import("./blockly/editor")` to load the Blockly chunk on demand. It also calls `initBlockly(COMPLETION_TREE)` on first load to pass the completion tree to the Blockly module.

**CSS injection:**
`injectVisualEditorStyles()` (only called when the setting is enabled) adds a `<style>` element with styles for the toolbar, toggle button (with hover/active states), Blockly container, and z-index overrides for Blockly's dropdown/tooltip overlays (set to 10000 to render above Foundry's ApplicationV2 dialogs).

## Colour Coding

Blocks are colour-coded by their root namespace via `getColourForPath()`:

| Namespace | Hue | Visual |
|-----------|-----|--------|
| actor | 120 | Green |
| target | 290 | Purple |
| workflow | 350 | Red |
| game | 210 | Blue |
| canvas | 180 | Teal |
| item/Item | 140 | Green |
| token/Token | 100 | Green |
| MidiQOL | 0 | Red |
| Hooks | 290 | Purple |
| dnd5e | 150 | Teal |
| CONFIG/CONST/args/scope | 45-60 | Yellow |

Multi-input AND blocks use `#5b80a5` (steel blue) and OR blocks use `#e07020` (orange) for visual distinction when nesting logic.

## How Module Completions Become Blocks

When midi-qol (or any module) registers completions:

```javascript
Hooks.on("macro-autocomplete.ready", ({ tree, rebuildSignatureMap }) => {
  tree.MidiQOL = {
    type: "object",
    children: {
      completeItemUse: {
        type: "function",
        detail: "(item, options?) => Promise<Workflow>",
        info: "Complete the use of an item..."
      },
    }
  };
  tree.workflow = {
    type: "variable",
    detail: "Workflow",
    children: {
      targets: { type: "property", detail: "Set<Token5e>" },
      hitTargets: { type: "property", detail: "Set<Token5e>" },
    }
  };
  rebuildSignatureMap();
});
```

These entries are automatically converted to blocks:
- `MidiQOL.completeItemUse` → function block with `item` input socket, optional `options` input, generates `await MidiQOL.completeItemUse(item, options)`
- `workflow` → namespace dropdown block with targets, hitTargets, etc. as cascading dropdown options
- `workflow.targets` → property value block generating `workflow.targets`

No Blockly-specific code is needed in the registering module.

## Limitations

1. **JS-to-blocks fidelity** — The acorn-based parser handles common patterns but complex JavaScript (closures, destructuring, class definitions, switch statements) falls back to raw JS blocks.

2. **Limited depth** — Tree walking stops at depth 4 to prevent combinatorial explosion. Deep property chains beyond 4 levels require the raw JS expression block.

3. **No type checking between blocks** — Blockly's type system is basic. Function inputs accept any value block, not just the correct type. The generated code may have runtime type errors.

4. **Workspace persistence** — Workspace state is only preserved in memory during a single editing session. Closing and reopening the macro editor loses the block arrangement. Future work could store workspace JSON in a macro flag.

5. **Block count** — Large completion trees generate many blocks. The `MAX_BLOCKS_PER_CATEGORY` limit (50) and `MAX_DEPTH` limit (4) keep the toolbox manageable. The raw JS blocks serve as escape hatches.
