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
// Format: typeName -> { paths: [...], preferFile: "partial/path" }
const TARGET_TYPES = {
  // Global objects - these map to completion paths
  "Game": { paths: ["game"], preferFile: "/client/game.d.mts" },
  "Canvas": { paths: ["canvas"], preferFile: "/canvas/" },
  "ClientSettings": { paths: ["game.settings"] },
  "Localization": { paths: ["game.i18n"] },

  // UI
  "Notifications": { paths: ["ui.notifications"] },

  // Document classes - prefer files in /documents/ folder
  "Actor": { paths: ["Actor"], preferFile: "/documents/actor" },
  "Item": { paths: ["Item"], preferFile: "/documents/item" },
  "ChatMessage": { paths: ["ChatMessage"], preferFile: "/documents/chat-message" },
  "Roll": { paths: ["Roll"], preferFile: "/dice/roll" },
  "ActiveEffect": { paths: ["ActiveEffect"], preferFile: "/documents/active-effect" },
  "Token": { paths: ["Token"], preferFile: "/canvas/token" },
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
  let name;
  try {
    name = member.name?.getText(sourceFile);
  } catch {
    return null;
  }

  if (!name || name.startsWith("_") || name.startsWith("#")) return null;

  // Skip certain noisy members
  const skipNames = ["constructor", "prototype", "toString", "valueOf", "toJSON",
    "hasOwnProperty", "isPrototypeOf", "propertyIsEnumerable", "toLocaleString",
    "then", "catch", "finally"];
  if (skipNames.includes(name)) return null;

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
      entry: {
        type: "property",
        detail: propType,
        info: jsDoc || undefined,
      }
    };
  }

  return null;
}

function extractTypeMembers(decl, sourceFile) {
  const typeName = decl.name?.getText(sourceFile) || "unknown";

  const entry = {
    type: ts.isClassDeclaration(decl) ? "class" : "object",
    detail: typeName,
    children: {},
  };

  let memberCount = 0;
  const maxMembers = 100; // Limit to avoid huge outputs

  for (const member of decl.members) {
    if (memberCount >= maxMembers) break;

    const info = extractMemberInfo(member, sourceFile);
    if (info) {
      entry.children[info.name] = info.entry;
      memberCount++;
    }
  }

  // Also check heritage clauses for extended interfaces
  if (decl.heritageClauses) {
    for (const heritage of decl.heritageClauses) {
      // Could recursively resolve parent types here
      // For now, just note it in the info
    }
  }

  return entry;
}

function findTypeDeclarations(sourceFile) {
  const fileName = sourceFile.fileName;

  function visit(node) {
    if (ts.isInterfaceDeclaration(node) || ts.isClassDeclaration(node)) {
      try {
        const name = node.name?.getText(sourceFile);
        if (name && TARGET_TYPES[name]) {
          // Store all candidates for this type
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
      } catch {
        // Skip problematic nodes
      }
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
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

  console.log(`Found ${foundTypes.size} target types: ${[...foundTypes.keys()].join(", ")}`);

  // Generate completions - select best candidate for each type
  const completions = {};

  for (const [typeName, candidates] of foundTypes) {
    const best = selectBestCandidate(typeName, candidates);
    if (!best) continue;

    try {
      const entry = extractTypeMembers(best.node, best.sourceFile);
      completions[typeName] = entry;

      const childCount = Object.keys(entry.children || {}).length;
      const shortPath = best.fileName.replace(/.*fvtt-types\/src\//, "");
      console.log(`  ${typeName}: ${childCount} members (from ${shortPath})`);
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

  const outputPath = path.resolve(__dirname, "../src/module/lib/foundryCompletions.json");
  fs.writeFileSync(outputPath, JSON.stringify(completions, null, 2));

  console.log(`\nGenerated ${Object.keys(completions).length} completion entries`);
  console.log(`Output written to: ${outputPath}`);
} catch (err) {
  console.error("Error generating completions:", err);
  process.exit(1);
}
