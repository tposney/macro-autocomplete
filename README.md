# Macro Autocomplete

![](https://img.shields.io/badge/Foundry-v13-informational)
![Forge Installs](https://img.shields.io/badge/dynamic/json?label=Forge%20Installs&query=package.installs&suffix=%25&url=https%3A%2F%2Fforge-vtt.com%2Fapi%2Fbazaar%2Fpackage%2Fmacro-autocomplete&colorB=4aa94a)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/tposney)

Context-aware autocompletion for Foundry VTT macro editors (v13+). Enhances CodeMirror 6 with intelligent suggestions for Foundry's API, game system data, and macro variables.

* The module will walk the systems schema to identify auto completion targets.
* The module will walk various foundry.xxxx (e.g. foundry.utils) to identify methods for auto completion.
* The module also uses league of foundry developers fvtt-types to extract rich type information.
* Generally (but not always) the module knows about return types so variables assigned to function call return values will be treated as of the correct type.

## Features

- **Dot-path completions** -- type `game.` to see properties, `actor.system.` to drill into system data
- **Signature hints** -- shows function parameter info when you type `(`
- **Runtime introspection** -- discovers globals (`game`, `canvas`, `ui`, `Hooks`, `CONST`, etc.) and their members at runtime
- **Schema walking** -- recursively walks DataModel schemas for `actor.system.*` and `item.system.*` fields (works with any game system)
- **Foundry namespace discovery** -- surfaces all classes from `foundry.documents` and `foundry.applications`
- **Type enrichment** -- supplements runtime discovery with typed data from fvtt-types
- **Macro variables** -- completions for `actor`, `token`, `character`, `speaker`, `args`, `scope`
- **Tab to accept** -- press Tab to accept the highlighted completion

## API

The API is available both via hook and at runtime:

```javascript
// Via hook (fires once after initialization)
Hooks.on("macro-autocomplete.ready", (api) => { /* ... */ });

// Via module API (available after ready)
const api = game.modules.get("macro-autocomplete")?.api;
```

### API Methods

| Method | Description |
|--------|-------------|
| `tree` | The completion tree object -- add entries directly |
| `rebuildSignatureMap()` | Rebuild signature hints after adding methods |
| `mergeCompletions(target, additions)` | Merge entries into a target node with type enrichment |
| `schemaToCompletions(schema)` | Walk a DataModel schema into completion entries |
| `fieldToCompletionNode(field, name)` | Convert a single DataField to a completion node |
| `classToCompletions(cls)` | Walk a class and return `{ staticChildren, instanceChildren, constructorDetail }` |
| `objectToCompletions(obj, maxDepth?)` | Walk a runtime object's properties and methods |
| `valueToCompletionEntry(value, maxDepth?)` | Convert a runtime value to a completion entry |

### CompletionEntry Fields

Each entry in the completion tree can have three kinds of children:

| Field | Purpose | Shown when |
|-------|---------|------------|
| `children` | Structural sub-properties (schema data, sub-objects, namespaces) | Always |
| `staticChildren` | Static class members (e.g., `Actor.create`, `Roll.validate`) | Typing `ClassName.` |
| `instanceChildren` | Instance members (e.g., `actor.update`, `roll.evaluate`) | Typing `variable.` or via type inference |

How `getVisibleChildren()` resolves what to show:
- **Class entries** (`Actor`, `Roll`): `children` + `staticChildren`
- **Variable/object entries** (`actor`, `game`): `children` + `instanceChildren`

### Example: Injecting module completions

```javascript
// Add a simple namespace with methods
Hooks.on("macro-autocomplete.ready", ({ tree, rebuildSignatureMap }) => {
  tree.MyModule = {
    type: "object", detail: "object",
    children: {
      doThing: { type: "function", detail: "(arg1, arg2) => Promise<void>" }
    }
  };
  rebuildSignatureMap();
});

// Add a class with separate static and instance members
Hooks.on("macro-autocomplete.ready", ({ tree, classToCompletions, rebuildSignatureMap }) => {
  // Walk a class to get both static and instance completions
  const walked = classToCompletions(MyCustomClass);
  tree.MyCustomClass = {
    type: "class", detail: "class MyCustomClass",
    staticChildren: walked.staticChildren,
    instanceChildren: walked.instanceChildren,
    constructorDetail: walked.constructorDetail,
  };
  rebuildSignatureMap();
});
```

## Installation

Install from the Foundry VTT module browser, or use the manifest URL:

```
https://gitlab.com/tposney/macro-autocomplete/raw/main/package/module.json
```

## Compatibility

- Foundry VTT v13
- System-independent (dnd5e, pf2e, etc.)

## License

MIT
