/**
 * Shared completion tree resolution logic.
 *
 * Both the text editor (CodeMirror) and visual editor (Blockly) need to
 * resolve property chains, extract type names, follow extends chains,
 * and merge children from multiple sources.  This module provides the
 * single authoritative implementation used by both.
 *
 * Call `setCompletionTree()` once during init to wire up the tree.
 */

// ── Shared types ──

export interface CompletionEntry {
  type?: string;
  detail?: string;
  info?: string;
  children?: CompletionNode;          // Structural sub-properties (schema data, sub-objects, namespaces)
  staticChildren?: CompletionNode;    // Static class members (e.g., Actor.create)
  instanceChildren?: CompletionNode;  // Instance members (e.g., actor.update)
  constructorDetail?: string;         // e.g. "(formula, data?) => Roll"
  returnType?: string;                // Class name whose instanceChildren to use for the return value
  inherited?: boolean;                // true if member was inherited from a parent class
  extends?: string[];                 // Parent type names for interface inheritance
}

export interface CompletionNode {
  [key: string]: CompletionEntry;
}

// ── Tree reference ──

let tree: CompletionNode | null = null;

/** Set the completion tree reference.  Call once during init. */
export function setCompletionTree(t: CompletionNode): void {
  tree = t;
}

/** Get the current completion tree (for callers that need direct access). */
export function getCompletionTree(): CompletionNode | null {
  return tree;
}

// ── Type name extraction ──

/**
 * Extract a core type name from a detail string, stripping wrappers.
 * Handles dotted namespace types (Canvas.Dimensions, Scene.Dimensions).
 *
 *   "Canvas.Dimensions | null"   → "Canvas.Dimensions"
 *   "D20Roll"                    → "D20Roll"
 *   "Actor5e | null"             → "Actor5e" → "Actor" (if 5e not in tree)
 *   "Promise<Workflow>"          → "Workflow"
 *   "Set<Token5e>"               → "Token5e"
 *   "(x) => Item"                → "Item"
 *   "DamageRoll[]"               → "DamageRoll"
 *
 * Returns null if no known class name can be extracted.
 */
export function extractTypeName(detail: string): string | null {
  const stripped = detail
    .replace(/^\(.*?\)\s*=>\s*/, "")          // strip function signature prefix
    .replace(/\bPromise<(.+?)>/, "$1")
    .replace(/\bSet<(.+?)>/, "$1")
    .replace(/\bCollection<(.+?)>/, "$1")
    .replace(/\bEmbeddedCollection<(.+?)>/, "$1")
    .replace(/\bMap<[^,]+,\s*(.+?)>/, "$1")
    .replace(/\[\]$/, "")                      // strip array suffix
    .replace(/\[["'][^"']*["']\]/g, "")        // strip indexed access (["actor"])
    .replace(/\.Implementation/g, "")          // strip .Implementation qualifier
    .replace(/\.Stored/g, "")                  // strip .Stored qualifier
    .replace(/<[^>]*>/g, "")                   // strip generic parameters
    .replace(/\s*\|.*$/, "")                   // strip union alternatives
    .trim();
  // Match ClassName or ClassName.SubType (e.g., Canvas.Dimensions)
  const match = stripped.match(/^([A-Z][A-Za-z0-9]+(?:\.[A-Z][A-Za-z0-9]+)?)/);
  if (!match) return null;
  const name = match[1];
  if (tree?.[name]) return name;
  // Strip system suffix (e.g., "Item5e" → "Item", "Actor5e" → "Actor")
  const base = name.replace(/5e$/, "");
  if (base !== name && tree?.[base]) return base;
  // Return the name even if not in tree (callers may use it for pattern matching)
  if (/^[A-Z]/.test(name)) return name;
  return null;
}

/**
 * Extract a class name from a function's return-type string.
 *   "(data?) => Promise<Actor.Stored | null>"  → "Actor"
 *   "(formula) => Roll<D>"                      → "Roll"
 */
export function extractReturnType(detail: string | undefined): string | null {
  if (!detail) return null;
  const arrowMatch = detail.match(/=>\s*(.+)$/);
  if (!arrowMatch) return null;
  let ret = arrowMatch[1].trim();
  const promiseMatch = ret.match(/^(?:Promise|MaybePromise)<(.+)>$/);
  if (promiseMatch) ret = promiseMatch[1].trim();
  ret = ret.replace(/\s*\|\s*(?:null|undefined|void)\b/g, "").trim();
  // Use extractTypeName for consistent dotted-type and qualifier handling
  return extractTypeName(ret);
}

/**
 * Extract the raw element type name from a collection type string,
 * without checking if it exists in the tree.
 */
export function extractRawElementType(detail: string): string | null {
  let m = detail.match(/^(?:Set|Collection|EmbeddedCollection|ActivityCollection)<(\w+)>/);
  if (m) return m[1];
  m = detail.match(/^Map<[^,]+,\s*(\w+)>/);
  if (m) return m[1];
  m = detail.match(/^(\w+)\[\]$/);
  if (m) return m[1];
  return null;
}

/**
 * Extract the element type from a collection detail and resolve it
 * to a known class in the completion tree.
 */
export function extractElementType(detail: string): string | null {
  const rawType = extractRawElementType(detail);
  if (!rawType || !tree) return null;
  if (tree[rawType]) return rawType;
  if (tree[rawType + "5e"]) return rawType + "5e";
  if (rawType.endsWith("5e") && tree[rawType.slice(0, -2)]) return rawType.slice(0, -2);
  return null;
}

// ── Merge utilities ──

/** Rank detail strings by specificity (0 = uninformative, 3 = specific). */
export function detailSpecificity(detail: string): number {
  if (!detail || detail === "any" || detail === "object") return 0;
  if (detail === "string" || detail === "number" || detail === "boolean") return 1;
  if (/^\(.*\)\s*=>/.test(detail)) return 3; // function signature
  return 2;
}

/**
 * Recursively merge additions into target.children.
 * Upgrades detail if the addition is more specific.
 */
export function mergeCompletions(target: { children?: CompletionNode }, additions: CompletionNode): void {
  if (!target.children) target.children = {};
  for (const [key, value] of Object.entries(additions)) {
    if (!(key in target.children)) {
      target.children[key] = value;
    } else {
      const existing = target.children[key];
      if (value.detail && existing.detail) {
        const existingSpec = detailSpecificity(existing.detail);
        const additionSpec = detailSpecificity(value.detail);
        if (additionSpec > existingSpec) existing.detail = value.detail;
      } else if (value.detail && !existing.detail) {
        existing.detail = value.detail;
      }
      if (value.info && !existing.info) existing.info = value.info;
      if (value.constructorDetail && !existing.constructorDetail) {
        existing.constructorDetail = value.constructorDetail;
      }
      if (value.returnType && !existing.returnType) existing.returnType = value.returnType;
      if (value.children) mergeCompletions(existing, value.children);
    }
  }
}

// ── Collection methods ──

/** Methods available on Foundry Set/Collection types. */
export const COLLECTION_METHODS: CompletionNode = {
  first: { type: "method", detail: "() => T | undefined", info: "Get the first element" },
  last: { type: "method", detail: "() => T | undefined", info: "Get the last element" },
  find: { type: "method", detail: "(predicate) => T | undefined", info: "Find the first element matching a predicate" },
  filter: { type: "method", detail: "(predicate) => T[]", info: "Filter elements matching a predicate" },
  map: { type: "method", detail: "(fn) => U[]", info: "Map elements to a new array" },
  some: { type: "method", detail: "(predicate) => boolean", info: "Test if any element matches a predicate" },
  every: { type: "method", detail: "(predicate) => boolean", info: "Test if all elements match a predicate" },
  reduce: { type: "method", detail: "(fn, initial) => U", info: "Reduce elements to a single value" },
  forEach: { type: "method", detail: "(callback) => void", info: "Execute a function for each element" },
  has: { type: "method", detail: "(value) => boolean", info: "Check if a value exists" },
  size: { type: "property", detail: "number", info: "Number of elements" },
  contents: { type: "property", detail: "T[]", info: "Array of elements" },
};

const COLLECTION_WRAPPER_RE = /\b(?:Set|Collection|Map)<.+?>/;

// ── Type resolution ──

/**
 * Resolve a type name (from a detail string) to a CompletionNode of its
 * properties.  Follows extends chains and merges instance/schema children.
 *
 * For collection types (Set<X>, Collection<X>), merges element type
 * children with collection methods (first, last, filter, etc.).
 */
export function resolveViaType(detail: string, _seen?: Set<string>): CompletionNode | null {
  if (!tree) return null;

  // Handle TS indexed access types: TypeName.Implementation["prop"]
  const indexedMatch = detail.match(/^(\w+)\.Implementation\["(\w+)"\]/);
  if (indexedMatch) {
    const [, outerType, propName] = indexedMatch;
    const outerResolved = resolveViaType(outerType);
    if (outerResolved?.[propName]?.detail) {
      return resolveViaType(outerResolved[propName].detail!);
    }
  }

  const typeName = extractTypeName(detail);
  if (!typeName) return null;

  // Prevent infinite recursion for circular extends chains
  const seen = _seen ?? new Set<string>();
  if (seen.has(typeName)) return null;
  seen.add(typeName);

  const namesToTry = [typeName];
  const baseName = typeName.replace(/5e$/, "");
  if (baseName !== typeName) namesToTry.push(baseName);

  const sources: CompletionNode[] = [];

  for (const name of namesToTry) {
    const classEntry = tree[name];
    if (classEntry) {
      if (classEntry.instanceChildren && Object.keys(classEntry.instanceChildren).length > 0) {
        sources.push(classEntry.instanceChildren);
      }
      if (classEntry.children && Object.keys(classEntry.children).length > 0) {
        sources.push(classEntry.children);
      }
      // Resolve parent types from extends chain
      if (classEntry.extends) {
        for (const parentType of classEntry.extends) {
          const parentChildren = resolveViaType(parentType, seen);
          if (parentChildren) sources.push(parentChildren);
        }
      }
    }

    // Also check the lowercase variable entry (e.g., "Item" → "item")
    // Skip for dotted type names (Canvas.Dimensions has no lowercase equivalent)
    if (!name.includes(".")) {
      const varName = name[0].toLowerCase() + name.slice(1);
      if (varName !== name) {
        const varEntry = tree[varName];
        if (varEntry) {
          if (varEntry.children && Object.keys(varEntry.children).length > 0) {
            sources.push(varEntry.children);
          }
          if (varEntry.instanceChildren && Object.keys(varEntry.instanceChildren).length > 0) {
            sources.push(varEntry.instanceChildren);
          }
        }
      }
    }
  }

  // For collection wrapper types, include collection-level methods
  if (COLLECTION_WRAPPER_RE.test(detail)) {
    sources.push(COLLECTION_METHODS);
  }

  if (sources.length === 0) return null;
  if (sources.length === 1) return sources[0];
  return Object.assign({}, ...sources);
}

// ── Effective / visible children ──

/**
 * Get the effective children of a CompletionEntry for navigation.
 * Merges children, staticChildren (for classes), and instanceChildren,
 * then performs type-based resolution via the detail string.
 *
 * This is the single source of truth for "what properties does this entry
 * expose?" — used by both the text editor and visual editor.
 */
export function getVisibleChildren(entry: CompletionEntry): CompletionNode {
  const result: CompletionNode = {};

  // Merge structural children first (runtime-discovered, schema data)
  if (entry.children) Object.assign(result, entry.children);

  // Add static or instance children based on entry type
  if (entry.type === "class") {
    if (entry.staticChildren) Object.assign(result, entry.staticChildren);
  } else {
    if (entry.instanceChildren) Object.assign(result, entry.instanceChildren);

    // Deep-fix: when runtime produces vague details ("any", "object") but
    // instanceChildren has typed details, prefer the typed version.
    if (entry.children && entry.instanceChildren) {
      for (const [k, v] of Object.entries(entry.instanceChildren)) {
        if (result[k] && v.detail && detailSpecificity(v.detail) > detailSpecificity(result[k].detail ?? "")) {
          result[k] = { ...result[k], detail: v.detail };
          if (v.info && !result[k].info) result[k].info = v.info;
          if (v.extends) result[k].extends = v.extends;
        }
      }
    }

    // Type-based resolution: if detail names a known type, merge its members.
    // Local children take precedence (already assigned above).
    // Only for non-class entries — class entries show static members, not instance members.
    if (entry.detail) {
      const resolved = resolveViaType(entry.detail);
      if (resolved) {
        for (const [k, v] of Object.entries(resolved)) {
          if (!result[k]) result[k] = v;
        }
      }
    }
  }

  return result;
}

// ── Tree walking ──

/**
 * Navigate the completion tree following a chain of property names.
 * Uses getVisibleChildren() at each step to resolve the full set of
 * available properties (including type-resolved ones).
 *
 * @param segments - dotted path segments to navigate
 * @param root - optional root node (defaults to the completion tree)
 * @returns The visible children of the deepest matched node, or null
 */
export function getCompletionsForPath(segments: string[], root?: CompletionNode): CompletionNode | null {
  let node = root ?? tree;
  if (!node) return null;
  for (const seg of segments) {
    const entry = node[seg];
    if (!entry) return null;
    const visible = getVisibleChildren(entry);
    if (Object.keys(visible).length === 0) return null;
    node = visible;
  }
  return node;
}

// ── Instance / return-type helpers ──

/**
 * Get instance-level completions for a class by name.
 * Checks instanceChildren on the class entry, falling back to children.
 */
export function getInstanceCompletions(className: string): CompletionNode | null {
  if (!tree) return null;
  const classEntry = tree[className];
  if (!classEntry) return null;
  if (classEntry.instanceChildren && Object.keys(classEntry.instanceChildren).length > 0) {
    return classEntry.instanceChildren;
  }
  return classEntry.children || null;
}

/** Static factory method names that typically return instances of their class. */
const FACTORY_METHOD_NAMES = new Set([
  "create", "get", "build", "fromData", "fromJSON", "fromDropData",
  "fromImport", "fromSource", "fromTerms", "createDialog",
]);

/**
 * Resolve the return type of a method to a class name, using three strategies:
 * 1. Explicit returnType field on the entry
 * 2. Parse the detail string for a known class name
 * 3. Factory method heuristic (create/get/build → return the class type)
 */
export function resolveMethodReturnType(
  methodEntry: CompletionEntry, methodName: string,
  classEntry: CompletionEntry, className: string
): string | null {
  if (methodEntry.returnType && tree?.[methodEntry.returnType]) return methodEntry.returnType;
  const parsed = extractReturnType(methodEntry.detail);
  if (parsed) return parsed;
  if (FACTORY_METHOD_NAMES.has(methodName) && classEntry.type === "class") return className;
  return null;
}

// ── Variable inference ──

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Resolve the element type of an iterable path for `for...of` inference.
 * Given "workflow.targets" with detail "Set<Token5e>", extracts "Token5e"
 * and returns its instance completions.
 */
export function resolveIterableElementType(iterablePath: string): CompletionNode | null {
  if (!tree) return null;
  const segments = iterablePath.split(".");
  let entry: CompletionEntry | undefined = tree[segments[0]];
  if (!entry) return null;
  for (let i = 1; i < segments.length && entry; i++) {
    const visible = getVisibleChildren(entry);
    entry = visible[segments[i]];
  }
  if (!entry?.detail) return null;

  const elementType = extractElementType(entry.detail);
  if (elementType) return getInstanceCompletions(elementType);

  const rawType = extractRawElementType(entry.detail);
  if (rawType) {
    const lower = rawType.charAt(0).toLowerCase() + rawType.slice(1);
    const fallbackEntry = tree[rawType] ?? tree[lower];
    if (fallbackEntry) {
      const result = getVisibleChildren(fallbackEntry);
      if (Object.keys(result).length > 0) return result;
    }
  }
  return null;
}

/**
 * Scan document text for variable assignments and infer what completions
 * the variable should produce.
 */
export function inferVariableCompletions(varName: string, docText: string): CompletionNode | null {
  if (!tree) return null;
  const escaped = escapeRegExp(varName);

  // Pattern 0: for...of loop variable
  const forOfRe = new RegExp(
    `for\\s*\\(\\s*(?:const|let|var)\\s+${escaped}\\s+of\\s+(\\w+(?:\\.\\w+)*)\\s*\\)`, "m"
  );
  const forOfMatch = docText.match(forOfRe);
  if (forOfMatch) {
    const result = resolveIterableElementType(forOfMatch[1]);
    if (result) return result;
  }

  // Combined regex: new ClassName | ClassName.method() | dotted.path
  const combined = new RegExp(
    `(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?new\\s+(\\w+)` +
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?new\\s+(\\w+)` +
    `|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?(\\w+)\\.(\\w+)\\s*\\(` +
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?(\\w+)\\.(\\w+)\\s*\\(` +
    `|(?:const|let|var)\\s+${escaped}\\s*=\\s*(?:await\\s+)?(\\w+(?:\\.\\w+)*)(?!\\s*\\()` +
    `|(?:^|[;\\n])\\s*${escaped}\\s*=\\s*(?:await\\s+)?(\\w+(?:\\.\\w+)*)(?!\\s*\\()`,
    "m"
  );

  const m = docText.match(combined);
  if (!m) return null;

  // Pattern 1: new ClassName(...)
  const newClass = m[1] || m[2];
  if (newClass && tree[newClass]) return getInstanceCompletions(newClass);

  // Pattern 2: ClassName.method(...)
  const className = m[3] || m[5];
  const methodName = m[4] || m[6];
  if (className && methodName) {
    const classEntry = tree[className];
    if (classEntry) {
      const visible = getVisibleChildren(classEntry);
      const methodEntry = visible[methodName];
      if (methodEntry) {
        const returnTypeName = resolveMethodReturnType(methodEntry, methodName, classEntry, className);
        if (returnTypeName) return getInstanceCompletions(returnTypeName);
      }
    }
  }

  // Pattern 3: dotted.path assignment
  const fullPath = m[7] || m[8];
  if (fullPath) {
    const segments = fullPath.split(".");
    let entry: CompletionEntry | undefined = tree[segments[0]];
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

// ── Utility ──

/**
 * Filter and sort child keys: excludes private (_/#-prefixed),
 * sorts non-inherited entries before inherited ones.
 */
export function filteredKeys(node: CompletionNode): string[] {
  return Object.keys(node)
    .filter((k) => !k.startsWith("_") && !k.startsWith("#"))
    .sort((a, b) => {
      const aInherited = node[a].inherited ? 1 : 0;
      const bInherited = node[b].inherited ? 1 : 0;
      if (aInherited !== bInherited) return aInherited - bInherited;
      return a.localeCompare(b);
    });
}
