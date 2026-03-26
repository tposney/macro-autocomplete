/**
 * Build-time script to generate Foundry VTT completions from fvtt-types.
 *
 * Usage: node scripts/generateFoundryCompletions.js
 *
 * This parses the TypeScript declaration files from fvtt-types and generates
 * a JSON file with completion data that can be imported into macroAutoComplete.ts
 */

const ts = require("typescript");
const fs = require("fs");
const path = require("path");

// Types we want to extract completions for
// Format: typeName -> { paths: [...], preferFile: "partial/path", instancePath?: "variable_name" }
// instancePath: if set, instance members go to this variable name, static members go to the class name
const TARGET_TYPES = {
  // Global objects - these map to completion paths (no static/instance split needed)
  "Game": { paths: ["game"], preferFile: "/client/game.d.mts" },
  "Canvas": { paths: ["canvas"], preferFile: "/canvas/" },
  "ClientSettings": { paths: ["game.settings"] },
  "Localization": { paths: ["game.i18n"] },

  // UI
  "Notifications": { paths: ["ui.notifications"] },

  // Document classes - prefer files in /documents/ folder
  // instancePath tells where instance members should go
  "Actor": { paths: ["Actor"], instancePath: "actor", preferFile: "/documents/actor" },
  "Item": { paths: ["Item"], instancePath: "item", preferFile: "/documents/item" },
  "ChatMessage": { paths: ["ChatMessage"], preferFile: "/documents/chat-message" },
  "Roll": { paths: ["Roll"], preferFile: "/dice/roll" },
  "ActiveEffect": { paths: ["ActiveEffect"], preferFile: "/documents/active-effect" },
  "Token": { paths: ["Token"], instancePath: "token", preferFile: "/canvas/token" },
  "TokenDocument": { paths: ["TokenDocument"], preferFile: "/documents/token" },
  "Scene": { paths: ["Scene"], preferFile: "/documents/scene" },
  "Combat": { paths: ["Combat"], preferFile: "/documents/combat" },
  "Combatant": { paths: ["Combatant"], preferFile: "/documents/combatant" },
  "User": { paths: ["User"], preferFile: "/documents/user" },
  "Folder": { paths: ["Folder"], preferFile: "/documents/folder" },

  // Collections
  "Actors": { paths: ["Actors", "game.actors"], preferFile: "/collections/actors" },
  "Items": { paths: ["Items", "game.items"], preferFile: "/collections/items" },
  "Users": { paths: ["Users", "game.users"], preferFile: "/collections/users" },

  // Utilities
  "Hooks": { paths: ["Hooks"], preferFile: "/helpers/hooks" },
  "Dialog": { paths: ["Dialog"], preferFile: "/apps/dialog" },
};

// Track found types - store array of candidates
const foundTypes = new Map();

function simplifyType(typeText) {
  // Remove namespaces and simplify
  return typeText
    .replace(/foundry\.documents\./g, "")
    .replace(/foundry\.data\./g, "")
    .replace(/foundry\.utils\./g, "")
    .replace(/foundry\.abstract\./g, "")
    .replace(/documents\./g, "")
    .replace(/internal\./g, "")
    .replace(/<[^>]+>/g, match => {
      // Simplify generic parameters
      const inner = match.slice(1, -1);
      return `<${simplifyType(inner)}>`;
    })
    .replace(/\s+/g, " ")
    .trim();
}

function getTypeString(type, sourceFile) {
  if (!type) return "any";

  try {
    const typeText = type.getText(sourceFile);
    return simplifyType(typeText);
  } catch {
    return "any";
  }
}

function getJSDocComment(node) {
  const jsDocs = node.jsDoc;
  if (!jsDocs || jsDocs.length === 0) return "";

  const comments = [];
  for (const jsDoc of jsDocs) {
    if (jsDoc.comment) {
      if (typeof jsDoc.comment === "string") {
        comments.push(jsDoc.comment);
      } else if (Array.isArray(jsDoc.comment)) {
        comments.push(jsDoc.comment.map(c => c.text || "").join(""));
      }
    }
  }
  return comments.join(" ").trim().substring(0, 200); // Limit length
}

function extractMemberInfo(member, sourceFile) {
  // Handle constructors first (they don't have a name property)
  if (ts.isConstructorDeclaration(member)) {
    const jsDoc = getJSDocComment(member);
    const params = [];
    if (member.parameters) {
      for (const param of member.parameters) {
        try {
          const paramName = param.name.getText(sourceFile);
          const optional = param.questionToken ? "?" : "";
          params.push(`${paramName}${optional}`);
        } catch {
          params.push("arg");
        }
      }
    }
    return {
      name: "__constructor",
      entry: {
        type: "constructor",
        detail: `(${params.join(", ")})`,
        info: jsDoc || undefined,
      },
      isStatic: true, // constructors are class-level
    };
  }

  let name;
  try {
    name = member.name?.getText(sourceFile);
  } catch {
    return null;
  }

  if (!name || name.startsWith("_") || name.startsWith("#")) return null;

  // Skip certain noisy members
  const skipNames = ["prototype", "toString", "valueOf", "toJSON",
    "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
    "then", "catch", "finally"];
  if (skipNames.includes(name)) return null;

  // Detect static modifier
  const isStatic = member.modifiers?.some(m => m.kind === ts.SyntaxKind.StaticKeyword) || false;

  const jsDoc = getJSDocComment(member);

  if (ts.isMethodSignature(member) || ts.isMethodDeclaration(member)) {
    // Method
    const params = [];
    if (member.parameters) {
      for (const param of member.parameters) {
        try {
          const paramName = param.name.getText(sourceFile);
          const optional = param.questionToken ? "?" : "";
          params.push(`${paramName}${optional}`);
        } catch {
          params.push("arg");
        }
      }
    }

    const returnType = member.type ? getTypeString(member.type, sourceFile) : "void";

    return {
      name,
      isStatic,
      entry: {
        type: "method",
        detail: `(${params.join(", ")}) => ${returnType}`,
        info: jsDoc || undefined,
      }
    };
  } else if (ts.isPropertySignature(member) || ts.isPropertyDeclaration(member)) {
    // Property
    const propType = member.type ? getTypeString(member.type, sourceFile) : "any";

    return {
      name,
      isStatic,
      entry: {
        type: "property",
        detail: propType,
        info: jsDoc || undefined,
      }
    };
  } else if (ts.isGetAccessor(member)) {
    // Getter property
    const returnType = member.type ? getTypeString(member.type, sourceFile) : "any";

    return {
      name,
      isStatic,
      entry: {
        type: "property",
        detail: returnType,
        info: jsDoc || undefined,
      }
    };
  }

  return null;
}

/**
 * Extract the extends clause type names from an interface or class declaration.
 * Returns simplified type names (e.g., "Scene.Dimensions" from "Scene.Dimensions").
 */
function getExtendsTypes(node, sourceFile) {
  const result = [];
  if (!node.heritageClauses) return result;
  for (const clause of node.heritageClauses) {
    if (clause.token === ts.SyntaxKind.ExtendsKeyword) {
      for (const type of clause.types) {
        try {
          const typeText = type.expression.getText(sourceFile);
          result.push(simplifyType(typeText));
        } catch {
          // Skip
        }
      }
    }
  }
  return result;
}

function extractTypeMembers(decl, sourceFile) {
  const typeName = decl.name?.getText(sourceFile) || "unknown";
  const isClass = ts.isClassDeclaration(decl);

  const entry = {
    type: isClass ? "class" : "object",
    detail: typeName,
    staticChildren: {},
    instanceChildren: {},
  };

  let memberCount = 0;
  const maxMembers = 100; // Limit to avoid huge outputs

  for (const member of decl.members) {
    if (memberCount >= maxMembers) break;

    const info = extractMemberInfo(member, sourceFile);
    if (info) {
      if (info.name === "__constructor") {
        // Store constructor info on the entry itself
        entry.constructorDetail = `${info.entry.detail} => ${typeName}`;
      } else if (info.isStatic) {
        entry.staticChildren[info.name] = info.entry;
      } else {
        entry.instanceChildren[info.name] = info.entry;
      }
      memberCount++;
    }
  }

  return entry;
}

function findTypeDeclarations(sourceFile) {
  const fileName = sourceFile.fileName;

  function visit(node, namespacePrefix) {
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      try {
        const name = node.name?.getText(sourceFile);
        if (!name) return;

        // Check if it's a top-level TARGET_TYPE
        if (!namespacePrefix && TARGET_TYPES[name]) {
          if (!foundTypes.has(name)) {
            foundTypes.set(name, []);
          }
          foundTypes.get(name).push({
            node,
            sourceFile,
            fileName,
            isClass: ts.isClassDeclaration(node),
            memberCount: node.members?.length || 0,
          });
        }

        // If inside a namespace that's a TARGET_TYPE, collect as "Namespace.Name"
        if (namespacePrefix && TARGET_TYPES[namespacePrefix]) {
          const qualifiedName = `${namespacePrefix}.${name}`;
          if (!foundTypes.has(qualifiedName)) {
            foundTypes.set(qualifiedName, []);
          }
          foundTypes.get(qualifiedName).push({
            node,
            sourceFile,
            fileName,
            isClass: ts.isClassDeclaration(node),
            memberCount: node.members?.length || 0,
            isNestedType: true,
          });
        }
      } catch {
        // Skip problematic nodes
      }
    }

    // Descend into namespace/module declarations to find nested interfaces
    if (ts.isModuleDeclaration(node)) {
      try {
        const nsName = node.name?.getText(sourceFile);
        // Only descend into namespaces whose name matches a TARGET_TYPE
        if (nsName && TARGET_TYPES[nsName] && node.body) {
          ts.forEachChild(node.body, child => visit(child, nsName));
        }
      } catch {
        // Skip
      }
    }

    ts.forEachChild(node, child => visit(child, namespacePrefix));
  }

  visit(sourceFile, null);
}

/**
 * Select the best candidate for a type based on preferFile and other heuristics
 */
function selectBestCandidate(typeName, candidates) {
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0];

  const config = TARGET_TYPES[typeName];
  const preferFile = config?.preferFile;

  // Score candidates
  const scored = candidates.map(c => {
    let score = 0;

    // Prefer file path match
    if (preferFile && c.fileName.includes(preferFile)) {
      score += 100;
    }

    // Prefer classes over interfaces
    if (c.isClass) {
      score += 10;
    }

    // Prefer more members
    score += Math.min(c.memberCount, 50);

    // Prefer files in /client/ over /common/
    if (c.fileName.includes("/client/")) {
      score += 5;
    }

    return { ...c, score };
  });

  // Sort by score descending
  scored.sort((a, b) => b.score - a.score);

  return scored[0];
}

function generateCompletions() {
  const fvttTypesPath = path.resolve(__dirname, "../node_modules/fvtt-types/src");

  if (!fs.existsSync(fvttTypesPath)) {
    console.error("fvtt-types not found at:", fvttTypesPath);
    process.exit(1);
  }

  // Find all .d.mts files
  const files = [];
  function findFiles(dir) {
    if (!fs.existsSync(dir)) return;
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        findFiles(fullPath);
      } else if (entry.name.endsWith(".d.mts") || entry.name.endsWith(".d.ts")) {
        files.push(fullPath);
      }
    }
  }
  findFiles(fvttTypesPath);

  console.log(`Found ${files.length} declaration files`);

  // Create TypeScript program
  const program = ts.createProgram(files, {
    target: ts.ScriptTarget.ESNext,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.NodeNext,
    allowJs: true,
    checkJs: false,
    noEmit: true,
    skipLibCheck: true,
  });

  // Find type declarations
  for (const sourceFile of program.getSourceFiles()) {
    if (sourceFile.fileName.includes("fvtt-types")) {
      findTypeDeclarations(sourceFile);
    }
  }

  const mainTypeCount = [...foundTypes.keys()].filter(k => !k.includes(".")).length;
  const nestedTypeCount = [...foundTypes.keys()].filter(k => k.includes(".")).length;
  console.log(`Found ${mainTypeCount} main types + ${nestedTypeCount} nested types`);

  // Pass 1: Generate completions for main (non-nested) TARGET_TYPES
  const completions = {};

  for (const [typeName, candidates] of foundTypes) {
    const best = selectBestCandidate(typeName, candidates);
    if (!best || best.isNestedType) continue;

    try {
      const entry = extractTypeMembers(best.node, best.sourceFile);
      const config = TARGET_TYPES[typeName];

      const output = {
        type: entry.type,
        detail: entry.detail,
      };

      // Include constructor detail if found
      if (entry.constructorDetail) {
        output.constructorDetail = entry.constructorDetail;
      }

      // Include instancePath from config
      if (config?.instancePath) {
        output.instancePath = config.instancePath;
      }

      // Include static and instance children separately
      if (Object.keys(entry.staticChildren).length > 0) {
        output.staticChildren = entry.staticChildren;
      }
      if (Object.keys(entry.instanceChildren).length > 0) {
        output.instanceChildren = entry.instanceChildren;
      }

      completions[typeName] = output;

      const staticCount = Object.keys(entry.staticChildren).length;
      const instanceCount = Object.keys(entry.instanceChildren).length;
      const shortPath = best.fileName.replace(/.*fvtt-types\/src\//, "");
      const ctorInfo = entry.constructorDetail ? `, ctor: ${entry.constructorDetail}` : "";
      console.log(`  ${typeName}: ${staticCount} static + ${instanceCount} instance members (from ${shortPath})${ctorInfo}`);
    } catch (err) {
      console.error(`  Error processing ${typeName}:`, err.message);
    }
  }

  // Pass 2: Collect all type names referenced by property detail strings in main types.
  // Only include nested types that are actually used as property types.
  const referencedTypes = new Set();
  function collectReferencedTypes(children) {
    for (const [, entry] of Object.entries(children)) {
      if (entry.detail && typeof entry.detail === "string") {
        // Extract qualified type names (e.g., "Canvas.Dimensions" from "Canvas.Dimensions | null")
        const matches = entry.detail.match(/\b([A-Z][A-Za-z0-9]+\.[A-Z][A-Za-z0-9]+)\b/g);
        if (matches) {
          for (const m of matches) referencedTypes.add(m);
        }
      }
    }
  }
  for (const [, typeEntry] of Object.entries(completions)) {
    if (typeEntry.staticChildren) collectReferencedTypes(typeEntry.staticChildren);
    if (typeEntry.instanceChildren) collectReferencedTypes(typeEntry.instanceChildren);
  }

  // Also resolve extends chains: if a referenced type extends another nested type, include that too
  function resolveExtendsChain(typeName) {
    const candidates = foundTypes.get(typeName);
    if (!candidates) return;
    const best = selectBestCandidate(typeName, candidates);
    if (!best) return;
    const extendsTypes = getExtendsTypes(best.node, best.sourceFile);
    for (const parentType of extendsTypes) {
      if (foundTypes.has(parentType) && !referencedTypes.has(parentType)) {
        referencedTypes.add(parentType);
        resolveExtendsChain(parentType);
      }
    }
  }
  for (const refType of [...referencedTypes]) {
    resolveExtendsChain(refType);
  }

  console.log(`\n  Referenced nested types: ${referencedTypes.size}`);

  // Pass 3: Generate completions for referenced nested types only
  for (const typeName of referencedTypes) {
    const candidates = foundTypes.get(typeName);
    if (!candidates) continue;
    const best = selectBestCandidate(typeName, candidates);
    if (!best) continue;

    try {
      const entry = extractTypeMembers(best.node, best.sourceFile);
      const allChildren = { ...entry.instanceChildren, ...entry.staticChildren };

      const output = {
        type: "interface",
        detail: typeName,
      };
      if (Object.keys(allChildren).length > 0) {
        output.instanceChildren = allChildren;
      }

      // Capture extends clause for parent type resolution
      const extendsTypes = getExtendsTypes(best.node, best.sourceFile);
      if (extendsTypes.length > 0) {
        output.extends = extendsTypes;
      }

      // Skip if no members and no extends
      if (Object.keys(allChildren).length === 0 && extendsTypes.length === 0) continue;

      completions[typeName] = output;

      const memberCount = Object.keys(allChildren).length;
      const shortPath = best.fileName.replace(/.*fvtt-types\/src\//, "");
      const extendsInfo = extendsTypes.length > 0 ? ` (extends ${extendsTypes.join(", ")})` : "";
      console.log(`  ${typeName}: ${memberCount} members (nested type from ${shortPath})${extendsInfo}`);
    } catch (err) {
      console.error(`  Error processing ${typeName}:`, err.message);
    }
  }

  return completions;
}

// Main
try {
  console.log("Generating Foundry completions from fvtt-types...\n");
  const completions = generateCompletions();

  const outputPath = path.resolve(__dirname, "../src/lib/foundryCompletions.json");
  fs.writeFileSync(outputPath, JSON.stringify(completions, null, 2));

  console.log(`\nGenerated ${Object.keys(completions).length} completion entries`);
  console.log(`Output written to: ${outputPath}`);
} catch (err) {
  console.error("Error generating completions:", err);
  process.exit(1);
}
