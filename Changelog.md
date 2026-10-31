# Changelog

## 14.0.3

- The project moved to GitHub (https://github.com/tposney/macro-autocomplete); updates come from GitHub releases (https://github.com/tposney/macro-autocomplete/releases/download/latest-v14/module.json). The GitLab project stays readable.

## 14.0.2

- Updates are served from GitLab Pages (https://tposney.gitlab.io/macro-autocomplete/v14/module.json), so update checks no longer fail when GitLab rate-limits repository files.

## 14.0.1

### Visual Block Editor

- Toggle between text and visual editing modes using the visual editor button in any macro editor.
- Build macros by dragging and connecting blocks — no need to type much JavaScript.
- Switch freely between text and visual modes; existing code is automatically converted to blocks and vice versa.
- Can be disabled per-client in Settings > Module Settings
- The Block Editor should be treated as experimental, it has been tested quite a lot, but the scope of what it covers is immense so expect errors.

### Available Blocks

**Macro Scope Blocks**
- Top level blocks created for pre defined macro data, such as item, activity, speaker and so on.

**Logic & Control Flow:**
- AND/OR blocks with +/- buttons to combine multiple conditions
- Comparison operators (===, !==, >, <, >=, <=) and NOT
- if/else, for...of, counting for loop, try/catch, return, await
- Variable declarations (const/let)

**Values:**
- String, number, and template literal blocks
- List creation with +/- buttons for adding/removing items
- Object.keys, Object.values, Object.entries
- Array.from, instanceof

**Notifications & Logging:**
- console.error, ui.notifications.warn, ui.notifications.info
- setTimeout, setInterval

**List Checks:**
- Check if a list includes a value
- Inline array check (e.g., `["humanoid"].includes(raceOrType)`)

**Module API Blocks:**
- Blocks are automatically generated for any module that registers completions (actor, target, workflow, game, etc.)
- Browse properties via cascading dropdown menus — select a namespace, then drill into its properties
- Function and method blocks show parameter names and accept value inputs

**Foundry**
- Blocks generated for most foundry API calls.

**JavaScript:**
- Raw expression and statement blocks for anything not covered by the built-in blocks
- Typed variable block for property access.

### Code-to-Blocks Conversion

- Switching from text to visual mode parses your existing JavaScript into blocks
- Supports variables, if/else, for loops, try/catch, return, await, assignments, and logical chains
- Unrecognized code is preserved as raw JavaScript blocks

### Toolbox & Appearance

- Blocks are colour-coded by category (actor=green, target=purple, workflow=red, game=blue, etc.)
- Context-aware toolbox — when opened from a condition editor, only relevant blocks are shown
- Dark theme matching the Foundry VTT interface
- Zoom controls, grid snapping, trashcan

## 1.0.0

- Initial release with CodeMirror 6 autocompletion
- Tab key completion acceptance
- Function signature tooltips
- Schema-generated completions from dnd5e DataModels
- Module API for registering custom completions
