/**
 * Converts JavaScript source code into Blockly blocks by parsing the AST
 * and mapping recognized patterns to their corresponding block types.
 *
 * Unrecognized statements become "raw JS" blocks, preserving all code.
 * The result is a best-effort conversion — control flow structures and
 * known API calls get proper blocks, while complex expressions fall back
 * to raw JS escape hatches.
 */

import * as Blockly from "blockly/core";
import type { BlockSvg } from "blockly/core";
import * as acorn from "acorn";
import { asyncBlockTypes, getVariableType } from "./treeToBlocks";
import { isNamespaceOnly } from "./blocklyConfig";

/** Helper to create a block and cast to BlockSvg (we always use SVG workspaces) */
function createBlock(workspace: Blockly.WorkspaceSvg, type: string): BlockSvg {
  return workspace.newBlock(type) as BlockSvg;
}

/** Initialize a block's SVG elements (required before connecting to rendered blocks) */
function initBlock(block: Blockly.Block): void {
  (block as BlockSvg).initSvg();
}

/** Initialize SVG and render a block (recursively handles children) */
function renderBlock(block: Blockly.Block): void {
  (block as BlockSvg).initSvg();
  (block as BlockSvg).render();
}

/** Dispose a block with events temporarily disabled to prevent interference */
function safeDispose(block: Blockly.Block): void {
  Blockly.Events.disable();
  try {
    block.dispose();
  } finally {
    Blockly.Events.enable();
  }
}

/** Vertical spacing between top-level blocks */
const BLOCK_SPACING_Y = 20;

/**
 * Parse JavaScript source and create corresponding blocks in the workspace.
 * @param connectAfter  Optional block to append new blocks after (via next connection).
 *                      If provided, the first new block chains onto this block's tail.
 */
export function jsToBlocks(source: string, workspace: Blockly.WorkspaceSvg, connectAfter?: Blockly.Block | null): void {
  let ast: acorn.Program;
  const comments: { type: string; value: string; start: number; end: number }[] = [];
  try {
    ast = acorn.parse(source, {
      ecmaVersion: "latest",
      sourceType: "module",
      allowAwaitOutsideFunction: true,
      allowReturnOutsideFunction: true,
      onComment: (isBlock: boolean, text: string, start: number, end: number) => {
        comments.push({ type: isBlock ? "Block" : "Line", value: text, start, end });
      },
    } as any);
  } catch (err) {
    // If parsing fails, put the entire source in a single raw statement block
    const block = createBlock(workspace, "mac_raw_statement");
    block.setFieldValue(source.trim(), "CODE");
    renderBlock(block);
    const tail = connectAfter ? getLastInChain(connectAfter) : null;
    if (tail?.nextConnection && block.previousConnection) {
      tail.nextConnection.connect(block.previousConnection);
    } else {
      block.moveBy(20, 20);
    }
    return;
  }

  // Build a merged list of statements and comments, ordered by source position.
  // Comments that appear between statements become mac_comment blocks.
  type Item = { pos: number; kind: "stmt"; node: acorn.Node } | { pos: number; kind: "comment"; comment: typeof comments[0] };
  const items: Item[] = [];
  for (const node of ast.body) {
    items.push({ pos: node.start, kind: "stmt", node });
  }
  // Only include comments that are NOT inside a statement's range
  // (inline comments within expressions are not worth extracting separately)
  for (const c of comments) {
    const insideStmt = ast.body.some((n: any) => c.start >= n.start && c.end <= n.end);
    if (!insideStmt) {
      items.push({ pos: c.start, kind: "comment", comment: c });
    }
  }
  items.sort((a, b) => a.pos - b.pos);

  // Convert items to blocks
  const blocks: Blockly.Block[] = [];
  for (const item of items) {
    if (item.kind === "comment") {
      const c = item.comment;
      const text = c.type === "Block"
        ? c.value.replace(/^\s*\*?\s?/gm, "").trim()  // clean block comment formatting
        : c.value.trim();
      if (!text) continue;
      const block = workspace.newBlock("mac_comment");
      block.setFieldValue(text, "TEXT");
      blocks.push(block);
    } else {
      const block = statementToBlock(item.node, source, workspace);
      if (block) blocks.push(block);
    }
  }

  // Render all blocks, then chain them together.
  // If connectAfter is provided, seed the chain from its tail so new blocks append.
  let yOffset = 20;
  let previousBlock: Blockly.Block | null = connectAfter ? getLastInChain(connectAfter) : null;

  for (const block of blocks) {
    renderBlock(block);

    // Chain statements together via previous/next connections
    if (previousBlock?.nextConnection && block.previousConnection) {
      previousBlock.nextConnection.connect(block.previousConnection);
    } else {
      // Can't chain — position below previous block with actual height spacing
      block.moveBy(20, yOffset);
      const svgBlock = block as BlockSvg;
      yOffset += (svgBlock.getHeightWidth?.()?.height ?? 40) + BLOCK_SPACING_Y;
    }

    previousBlock = getLastInChain(block);
  }
}

/** Get the last block in a next-connection chain */
function getLastInChain(block: Blockly.Block): Blockly.Block {
  let current = block;
  while (current.getNextBlock()) {
    current = current.getNextBlock()!;
  }
  return current;
}

/** Extract the raw source text for a node */
function nodeSource(node: acorn.Node, source: string): string {
  return source.slice(node.start, node.end);
}

/**
 * Convert an AST statement node to a Blockly block.
 * Returns null if the node type is not handled.
 */
function statementToBlock(
  node: acorn.Node,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  switch (node.type) {
    case "VariableDeclaration":
      return variableDeclarationToBlock(node as any, source, workspace);
    case "ExpressionStatement":
      return expressionStatementToBlock(node as any, source, workspace);
    case "IfStatement":
      return ifStatementToBlock(node as any, source, workspace);
    case "ForStatement":
      return forStatementToBlock(node as any, source, workspace);
    case "ForOfStatement":
      return forOfStatementToBlock(node as any, source, workspace);
    case "TryStatement":
      return tryStatementToBlock(node as any, source, workspace);
    case "ReturnStatement":
      return returnStatementToBlock(node as any, source, workspace);
    case "FunctionDeclaration":
      return functionDeclarationToBlock(node as any, source, workspace);
    default:
      return rawStatementBlock(nodeSource(node, source), workspace);
  }
}

/**
 * Convert a VariableDeclaration to a const or let block.
 * Only handles single declarators with const/let. Others become raw JS.
 */
function variableDeclarationToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  if ((node.kind !== "const" && node.kind !== "let") || node.declarations.length !== 1) {
    return rawStatementBlock(nodeSource(node, source), workspace);
  }

  const decl = node.declarations[0];
  if (decl.id.type !== "Identifier" || !decl.init) {
    return rawStatementBlock(nodeSource(node, source), workspace);
  }

  const blockType = node.kind === "const" ? "mac_const" : "mac_let";
  const block = workspace.newBlock(blockType);
  block.setFieldValue(decl.id.name, "NAME");

  const valueBlock = expressionToBlock(decl.init, source, workspace);
  if (valueBlock) {
    initBlock(valueBlock);
    const connection = block.getInput("VALUE")?.connection;
    if (connection && valueBlock.outputConnection) {
      connection.connect(valueBlock.outputConnection);
    }
  }

  return block;
}

/**
 * Convert an ExpressionStatement. Handles:
 * - function/method calls (console.error, ui.notifications.warn, known API calls)
 * - assignments
 * - await expressions and other value expressions (wrapped in mac_expr_statement)
 */
function expressionStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const expr = node.expression;

  // Call expressions — try statement-specific handling first (console.error,
  // ui.notifications, registered statement blocks), then fall through to
  // expression-level handling for patterns like [...].includes(expr)
  if (expr.type === "CallExpression") {
    const stmtBlock = callStatementToBlock(expr, source, workspace);
    if (stmtBlock) return stmtBlock;
  }

  // Detect `await new Promise(param => ...)` → mac_await_promise block
  if (expr.type === "AwaitExpression" && expr.argument?.type === "NewExpression") {
    const promiseBlock = tryAwaitPromiseBlock(expr.argument, source, workspace);
    if (promiseBlock) return promiseBlock;
  }

  // Await wrapping a call: `await foo.bar()` — unwrap the await and try as
  // a statement block first.  Async statement blocks already emit `await`
  // in their generator, so wrapping in mac_await would produce a duplicate.
  if (expr.type === "AwaitExpression" && expr.argument?.type === "CallExpression") {
    const stmtBlock = callStatementToBlock(expr.argument, source, workspace);
    if (stmtBlock) return stmtBlock;
  }

  // Assignment expressions: x = value
  if (expr.type === "AssignmentExpression") {
    return assignmentToBlock(expr, source, workspace);
  }

  // Fall through to expression-level parsing for any other expression types.
  // If the result is a statement block (has previousConnection), use it directly.
  // Value blocks (outputConnection only) can't chain as statements — wrap them
  // in a mac_expr_statement block to preserve the structured block representation.
  const exprBlock = expressionToBlock(expr, source, workspace);
  if (exprBlock) {
    if (exprBlock.previousConnection) {
      return exprBlock;
    }
    // Wrap the value block in an expression-statement wrapper
    const wrapper = workspace.newBlock("mac_expr_statement");
    initBlock(exprBlock);
    wrapper.getInput("EXPR")!.connection!.connect(exprBlock.outputConnection!);
    return wrapper;
  }

  return rawStatementBlock(nodeSource(node, source), workspace);
}

/**
 * Convert a function call used as a statement.
 * Recognizes console.error, ui.notifications.warn/info, and other patterns.
 */
function callStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const callPath = getCallPath(node);

  // Check if the call path matches a registered statement block
  if (callPath) {
    const blockType = "mac_" + callPath.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    if (Blockly.Blocks[blockType]) {
      const block = workspace.newBlock(blockType);
      // If the registered block is a value block (has output but no previousStatement),
      // it can't be used as a statement — return null so caller can try expression-level handling
      if (block.outputConnection && !block.previousConnection) {
        safeDispose(block);
        return null;
      }
      // For multi-arg blocks (console, notifications), expand inputs to match arg count
      if ((block as any).loadExtraState && node.arguments?.length > 1) {
        (block as any).loadExtraState({ argCount: node.arguments.length });
      }
      // Try to connect arguments to the block's inputs
      connectCallArguments(block, node, source, workspace);
      return block;
    }
  }

  // Return null — caller will fall through to expression-level parsing
  return null;
}

/**
 * Convert an if/else statement to the mac_if_else block.
 */
function ifStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const block = workspace.newBlock("mac_if_else");

  // Condition
  const condBlock = expressionToBlock(node.test, source, workspace);
  if (condBlock) {
    initBlock(condBlock);
    const conn = block.getInput("CONDITION")?.connection;
    if (conn && condBlock.outputConnection) conn.connect(condBlock.outputConnection);
  }

  // Then body
  if (node.consequent) {
    connectStatementBody(block, "THEN", node.consequent, source, workspace);
  }

  // Else body
  if (node.alternate) {
    if (node.alternate.type === "BlockStatement") {
      connectStatementBody(block, "ELSE", node.alternate, source, workspace);
    } else if (node.alternate.type === "IfStatement") {
      // else if — put the nested if as a statement in the else body
      const elseIfBlock = ifStatementToBlock(node.alternate, source, workspace);
      if (elseIfBlock) {
        initBlock(elseIfBlock);
        const conn = block.getInput("ELSE")?.connection;
        if (conn && elseIfBlock.previousConnection) conn.connect(elseIfBlock.previousConnection);
      }
    }
  }

  return block;
}

/**
 * Convert a C-style for statement to mac_for_loop.
 * Requires `for (let VAR = INIT; ...; ...)` — the init must declare a single
 * variable. The condition and update are rendered as raw expression blocks,
 * so any valid JS is accepted.
 * Falls back to a raw JS statement if the init isn't a single let declaration.
 */
function forStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const init = node.init;

  // init must be `let VAR = EXPR`
  if (
    !init || init.type !== "VariableDeclaration" ||
    init.declarations?.length !== 1 ||
    init.declarations[0].id?.type !== "Identifier" ||
    !init.declarations[0].init
  ) {
    return rawStatementBlock(nodeSource(node, source), workspace);
  }
  const varName = init.declarations[0].id.name;

  const block = workspace.newBlock("mac_for_loop");
  block.setFieldValue(varName, "VAR");

  // Init value
  const initBlock_ = expressionToBlock(init.declarations[0].init, source, workspace);
  if (initBlock_) {
    initBlock(initBlock_);
    const conn = block.getInput("INIT")?.connection;
    if (conn && initBlock_.outputConnection) conn.connect(initBlock_.outputConnection);
  }

  // Condition — render full source text as a raw expression
  if (node.test) {
    const condBlock = expressionToBlock(node.test, source, workspace);
    if (condBlock) {
      initBlock(condBlock);
      const conn = block.getInput("CONDITION")?.connection;
      if (conn && condBlock.outputConnection) conn.connect(condBlock.outputConnection);
    }
  }

  // Update — render full source text as a raw expression
  if (node.update) {
    const updateBlock = expressionToBlock(node.update, source, workspace);
    if (updateBlock) {
      initBlock(updateBlock);
      const conn = block.getInput("UPDATE")?.connection;
      if (conn && updateBlock.outputConnection) conn.connect(updateBlock.outputConnection);
    }
  }

  // Body
  if (node.body) {
    connectStatementBody(block, "DO", node.body, source, workspace);
  }

  return block;
}

function forOfStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const block = workspace.newBlock("mac_for_of");

  // Variable name
  if (node.left.type === "VariableDeclaration" && node.left.declarations[0]?.id?.name) {
    block.setFieldValue(node.left.declarations[0].id.name, "VAR");
  }

  // Iterable expression
  const iterBlock = expressionToBlock(node.right, source, workspace);
  if (iterBlock) {
    initBlock(iterBlock);
    const conn = block.getInput("ITERABLE")?.connection;
    if (conn && iterBlock.outputConnection) conn.connect(iterBlock.outputConnection);
  }

  // Body
  if (node.body) {
    connectStatementBody(block, "DO", node.body, source, workspace);
  }

  return block;
}

/**
 * Convert a try/catch/finally statement to the mac_try_catch block.
 * Handles: try/catch, try/finally, and try/catch/finally.
 */
function tryStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const hasCatch = !!node.handler;
  const hasFinally = !!node.finalizer;

  // Must have at least catch or finally
  if (!hasCatch && !hasFinally) {
    return rawStatementBlock(nodeSource(node, source), workspace);
  }

  const block = workspace.newBlock("mac_try_catch") as any;

  // Configure the block shape via loadExtraState before connecting bodies.
  // Default shape is try+catch — adjust if different.
  if (hasFinally || !hasCatch) {
    block.loadExtraState({
      hasCatch: hasCatch,
      hasFinally: hasFinally,
    });
  }

  // Try body
  if (node.block) {
    connectStatementBody(block, "TRY", node.block, source, workspace);
  }

  // Catch body
  if (hasCatch && node.handler?.body) {
    connectStatementBody(block, "CATCH", node.handler.body, source, workspace);
  }

  // Finally body
  if (hasFinally && node.finalizer) {
    connectStatementBody(block, "FINALLY", node.finalizer, source, workspace);
  }

  return block;
}

/**
 * Convert a return statement to the mac_return block.
 */
function returnStatementToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const block = workspace.newBlock("mac_return");

  if (node.argument) {
    const valueBlock = expressionToBlock(node.argument, source, workspace);
    if (valueBlock) {
      initBlock(valueBlock);
      const conn = block.getInput("VALUE")?.connection;
      if (conn && valueBlock.outputConnection) conn.connect(valueBlock.outputConnection);
    }
  }

  return block;
}

/**
 * Convert a FunctionDeclaration to mac_function_def or mac_function_def_return.
 * Only handles simple functions with identifier params. Complex functions
 * (destructuring, nested functions, etc.) fall back to raw statement blocks.
 */
function functionDeclarationToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // Only convert simple functions: identifier params, no nested function declarations.
  // Destructuring params, rest params, default values, nested functions → raw block.
  const allParamsSimple = (node.params ?? []).every((p: any) => p.type === "Identifier");
  const bodyStmtsAll: any[] = node.body?.body ?? [];
  const hasNestedFunction = bodyStmtsAll.some((s: any) => s.type === "FunctionDeclaration");
  if (!allParamsSimple || hasNestedFunction) {
    return rawStatementBlock(nodeSource(node, source), workspace);
  }

  const bodyStmts: any[] = node.body?.body ?? [];
  const lastStmt = bodyStmts.length > 0 ? bodyStmts[bodyStmts.length - 1] : null;
  const hasReturn = lastStmt?.type === "ReturnStatement" && lastStmt.argument;

  try {
    const blockType = hasReturn ? "mac_function_def_return" : "mac_function_def";
    const block = workspace.newBlock(blockType) as any;

    // Async
    block.setFieldValue(node.async ? "async" : "sync", "ASYNC");

    // Function name
    if (node.id?.name) {
      block.setFieldValue(node.id.name, "NAME");
    }

    // Parameters
    const params: string[] = node.params.map((p: any) => p.name);
    if (params.length > 0) {
      block.loadExtraState({ paramCount: params.length, params });
    }

    // Body — if hasReturn, exclude the last statement (it goes in the RETURN input)
    const bodyStatements = hasReturn ? bodyStmts.slice(0, -1) : bodyStmts;
    if (bodyStatements.length > 0) {
      const syntheticBody = { type: "BlockStatement", body: bodyStatements };
      connectStatementBody(block, "BODY", syntheticBody, source, workspace);
    }

    // Return value (for mac_function_def_return)
    if (hasReturn && lastStmt.argument) {
      const retBlock = expressionToBlock(lastStmt.argument, source, workspace);
      if (retBlock) {
        initBlock(retBlock);
        const conn = block.getInput("RETURN")?.connection;
        if (conn && retBlock.outputConnection) conn.connect(retBlock.outputConnection);
      }
    }

    return block;
  } catch {
    // If anything goes wrong, fall back to raw statement
    return rawStatementBlock(nodeSource(node, source), workspace);
  }
}

/**
 * Convert an ArrowFunctionExpression to mac_arrow_function or mac_arrow_function_return.
 * Handles both block bodies `(x) => { ... }` and expression bodies `(x) => x + 1`.
 * Only converts simple functions with identifier params.
 */
function arrowFunctionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const allParamsSimple = (node.params ?? []).every((p: any) => p.type === "Identifier");
  if (!allParamsSimple) {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  // Expression body: (x) => x + 1 → mac_arrow_function_return with no BODY, just RETURN
  if (node.body.type !== "BlockStatement") {
    try {
      const block = workspace.newBlock("mac_arrow_function_return") as any;
      block.setFieldValue(node.async ? "async" : "sync", "ASYNC");
      const params: string[] = node.params.map((p: any) => p.name);
      if (params.length > 0) {
        block.loadExtraState({ paramCount: params.length, params });
      }
      const retBlock = expressionToBlock(node.body, source, workspace);
      if (retBlock) {
        initBlock(retBlock);
        const conn = block.getInput("RETURN")?.connection;
        if (conn && retBlock.outputConnection) conn.connect(retBlock.outputConnection);
      }
      return block;
    } catch {
      return rawExpressionBlock(nodeSource(node, source), workspace);
    }
  }

  // Block body: (x) => { ... }
  const bodyStmts: any[] = node.body.body ?? [];
  const hasNestedFunction = bodyStmts.some((s: any) => s.type === "FunctionDeclaration");
  if (hasNestedFunction) {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  const lastStmt = bodyStmts.length > 0 ? bodyStmts[bodyStmts.length - 1] : null;
  const hasReturn = lastStmt?.type === "ReturnStatement" && lastStmt.argument;

  try {
    const blockType = hasReturn ? "mac_arrow_function_return" : "mac_arrow_function";
    const block = workspace.newBlock(blockType) as any;
    block.setFieldValue(node.async ? "async" : "sync", "ASYNC");
    const params: string[] = node.params.map((p: any) => p.name);
    if (params.length > 0) {
      block.loadExtraState({ paramCount: params.length, params });
    }

    // Body — if hasReturn, exclude the last statement (it goes in the RETURN input)
    const bodyStatements = hasReturn ? bodyStmts.slice(0, -1) : bodyStmts;
    if (bodyStatements.length > 0) {
      const syntheticBody = { type: "BlockStatement", body: bodyStatements };
      connectStatementBody(block, "BODY", syntheticBody, source, workspace);
    }

    // Return value (for mac_arrow_function_return)
    if (hasReturn && lastStmt.argument) {
      const retBlock = expressionToBlock(lastStmt.argument, source, workspace);
      if (retBlock) {
        initBlock(retBlock);
        const conn = block.getInput("RETURN")?.connection;
        if (conn && retBlock.outputConnection) conn.connect(retBlock.outputConnection);
      }
    }

    return block;
  } catch {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }
}

// ── Expression converters (produce value blocks with output connections) ──

/**
 * Convert an AST expression to a value block (has output connection).
 */
function expressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  switch (node.type) {
    case "Literal":
      return literalToBlock(node, workspace);

    case "TemplateLiteral":
      return templateLiteralToBlock(node, source, workspace);

    case "Identifier":
      return identifierToBlock(node, source, workspace);

    case "MemberExpression":
      return memberExpressionToBlock(node, source, workspace);

    case "UnaryExpression":
      if (node.operator === "!") {
        return notExpressionToBlock(node, source, workspace);
      }
      return rawExpressionBlock(nodeSource(node, source), workspace);

    case "BinaryExpression":
      return binaryExpressionToBlock(node, source, workspace);

    case "LogicalExpression":
      return logicalExpressionToBlock(node, source, workspace);

    case "CallExpression":
      return callExpressionToBlock(node, source, workspace);

    case "AwaitExpression":
      return awaitExpressionToBlock(node, source, workspace);

    case "ConditionalExpression":
      // Ternary — too complex for a dedicated block, use raw
      return rawExpressionBlock(nodeSource(node, source), workspace);

    case "ArrayExpression":
      return arrayExpressionToBlock(node, source, workspace);

    case "ObjectExpression":
      return objectExpressionToBlock(node, source, workspace);

    case "ArrowFunctionExpression":
      return arrowFunctionToBlock(node, source, workspace);

    case "FunctionExpression":
      // Complex expressions — use raw
      return rawExpressionBlock(nodeSource(node, source), workspace);

    default:
      return rawExpressionBlock(nodeSource(node, source), workspace);
  }
}

function literalToBlock(node: any, workspace: Blockly.WorkspaceSvg): Blockly.Block | null {
  if (typeof node.value === "string") {
    const block = workspace.newBlock("mac_string");
    block.setFieldValue(node.value, "TEXT");
    return block;
  }
  if (typeof node.value === "number") {
    const block = workspace.newBlock("mac_number");
    block.setFieldValue(node.value, "NUM");
    return block;
  }
  if (typeof node.value === "boolean") {
    // Use raw expression for booleans
    return rawExpressionBlock(String(node.value), workspace);
  }
  return rawExpressionBlock(String(node.raw ?? node.value), workspace);
}

function templateLiteralToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // Reconstruct the template literal content (without outer backticks)
  const raw = nodeSource(node, source);
  // Strip outer backticks
  const content = raw.slice(1, -1);
  const block = workspace.newBlock("mac_template_literal");
  block.setFieldValue(content, "TEMPLATE");
  return block;
}

function identifierToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const name = node.name;
  // Check for a registered property block
  const blockType = "mac_" + name;
  if (Blockly.Blocks[blockType]) {
    return workspace.newBlock(blockType);
  }
  // Fall back to raw expression
  return rawExpressionBlock(name, workspace);
}

function memberExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const path = getMemberPath(node);
  if (!path) {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  // Check for a registered exact-match block for the full path.
  // For single-segment paths (e.g., "workflow") use it immediately.
  // For multi-segment paths, prefer namespace blocks (which show the full
  // chain with dropdowns) — the exact-match fallback is tried later.
  const blockType = "mac_" + path.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "");
  const parts = path.split(".");
  if (parts.length === 1 && Blockly.Blocks[blockType]) {
    return workspace.newBlock(blockType);
  }

  // Try progressively longer parent paths for chain/namespace blocks,
  // preferring the root-level block (shows full chain with dropdowns).
  // For "workflow.actor.system.abilities", tries:
  //   mac_workflow_ns              → selections: ["actor", "system", "abilities"]
  //   mac_workflow_actor_ns        → selections: ["system", "abilities"]
  //   mac_workflow_actor_system_ns → selections: ["abilities"]
  // The chain depth validation rejects blocks that can't resolve the full chain.
  for (let prefixLen = 1; prefixLen < parts.length; prefixLen++) {
    const prefix = parts.slice(0, prefixLen).join(".");
    const nsBlockType =
      "mac_" + prefix.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "") + "_ns";
    if (!Blockly.Blocks[nsBlockType]) continue;

    const selections = parts.slice(prefixLen);
    const block = workspace.newBlock(nsBlockType);
    try {
      if (selections.length === 1) {
        // Single level — just set the first dropdown
        block.setFieldValue(selections[0], "PROP_0");
        // Verify the dropdown accepted the value
        if (block.getFieldValue("PROP_0") !== selections[0]) {
          safeDispose(block);
          continue;
        }
      } else {
        // Multiple levels — use loadExtraState to cascade dropdowns
        (block as any).loadExtraState({ selections });
        // chainDepth_ is 0-indexed; fully resolved N selections → chainDepth_ === N-1
        const expectedDepth = selections.length - 1;
        if (((block as any).chainDepth_ ?? 0) < expectedDepth) {
          safeDispose(block);
          continue;
        }
        // Verify every dropdown actually accepted the value (loadExtraState
        // sets chainDepth_ even if setFieldValue silently fell back to default)
        let allMatch = true;
        for (let si = 0; si < selections.length; si++) {
          if (block.getFieldValue(`PROP_${si}`) !== selections[si]) {
            allMatch = false;
            break;
          }
        }
        if (!allMatch) {
          safeDispose(block);
          continue;
        }
      }
      return block;
    } catch {
      safeDispose(block);
    }
  }

  // Fallback: exact-match property block for the full path (only reached for
  // multi-segment paths where no namespace block could resolve the chain).
  // Skip for namespaceOnly roots — always use namespace blocks or raw fallback.
  if (!isNamespaceOnly(parts[0]) && Blockly.Blocks[blockType]) {
    return workspace.newBlock(blockType);
  }

  // Try reconstructing a mac_typed_var block.
  // First check for a /* @tv:TypeName */ annotation in the source (emitted by
  // the mac_typed_var code generator). Falls back to rootTree type lookup.
  if (Blockly.Blocks["mac_typed_var"] && parts.length >= 2) {
    const varName = parts[0];
    const afterExpr = source.slice(node.end);
    const tvMatch = afterExpr.match(/^\s*\/\* @tv:(\w+) \*\//);
    const typeName = tvMatch ? tvMatch[1] : getVariableType(varName);
    if (typeName) {
      const selections = parts.slice(1);
      const block = workspace.newBlock("mac_typed_var");
      try {
        (block as any).loadExtraState({ varName, type: typeName, selections });
        // tvChainDepth_ is 0-indexed; fully resolved N selections → tvChainDepth_ === N-1
        const expectedDepth = selections.length - 1;
        if ((block as any).tvChainDepth_ >= expectedDepth) {
          // Verify every dropdown actually accepted the value
          let allMatch = true;
          for (let si = 0; si < selections.length; si++) {
            if (block.getFieldValue(`TPROP_${si}`) !== selections[si]) {
              allMatch = false;
              break;
            }
          }
          if (allMatch) {
            return block;
          }
        }
        safeDispose(block);
      } catch {
        safeDispose(block);
      }
    }
  }

  return rawExpressionBlock(path, workspace);
}

function notExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const block = workspace.newBlock("mac_not");
  const valueBlock = expressionToBlock(node.argument, source, workspace);
  if (valueBlock) {
    initBlock(valueBlock);
    const conn = block.getInput("VALUE")?.connection;
    if (conn && valueBlock.outputConnection) conn.connect(valueBlock.outputConnection);
  }
  return block;
}

/** Check if any leaf in a BinaryExpression + chain is a string literal. */
function plusChainHasString(node: any): boolean {
  if (node.type === "Literal" && typeof node.value === "string") return true;
  if (node.type === "TemplateLiteral") return true;
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return plusChainHasString(node.left) || plusChainHasString(node.right);
  }
  return false;
}

/** Flatten a left-associative + chain into an ordered list of operand nodes. */
function flattenPlusChain(node: any): any[] {
  if (node.type === "BinaryExpression" && node.operator === "+") {
    return [...flattenPlusChain(node.left), ...flattenPlusChain(node.right)];
  }
  return [node];
}

/** Create a mac_string_join block from a + chain containing string operands. */
function stringConcatToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block {
  const operands = flattenPlusChain(node);
  const block = workspace.newBlock("mac_string_join") as any;

  // Adjust input count to match operands
  while (block.itemCount_ < operands.length) {
    block.addInput_();
  }
  while (block.itemCount_ > operands.length && block.itemCount_ > 0) {
    block.removeInput_();
  }

  for (let i = 0; i < operands.length; i++) {
    const operandBlock = expressionToBlock(operands[i], source, workspace);
    if (operandBlock) {
      initBlock(operandBlock);
      const conn = block.getInput(`ADD${i}`)?.connection;
      if (conn && operandBlock.outputConnection) conn.connect(operandBlock.outputConnection);
    }
  }
  return block;
}

function binaryExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // instanceof → mac_instanceof block
  if (node.operator === "instanceof") {
    const block = workspace.newBlock("mac_instanceof");
    const leftBlock = expressionToBlock(node.left, source, workspace);
    if (leftBlock) {
      initBlock(leftBlock);
      const conn = block.getInput("VALUE")?.connection;
      if (conn && leftBlock.outputConnection) conn.connect(leftBlock.outputConnection);
    }
    const rightBlock = expressionToBlock(node.right, source, workspace);
    if (rightBlock) {
      initBlock(rightBlock);
      const conn = block.getInput("TYPE")?.connection;
      if (conn && rightBlock.outputConnection) conn.connect(rightBlock.outputConnection);
    }
    return block;
  }

  // Arithmetic operators → Blockly's built-in math_arithmetic block
  const arithmeticOps: Record<string, string> = {
    "+": "ADD", "-": "MINUS", "*": "MULTIPLY", "/": "DIVIDE", "**": "POWER",
  };
  const arithmeticOp = arithmeticOps[node.operator];
  if (arithmeticOp) {
    // String concatenation: if any operand in a + chain is a string literal,
    // use mac_string_join instead of math_arithmetic (whose inputs check "Number").
    if (node.operator === "+" && plusChainHasString(node)) {
      return stringConcatToBlock(node, source, workspace);
    }
    const block = workspace.newBlock("math_arithmetic");
    block.setFieldValue(arithmeticOp, "OP");
    const leftBlock = expressionToBlock(node.left, source, workspace);
    if (leftBlock) {
      initBlock(leftBlock);
      const conn = block.getInput("A")?.connection;
      if (conn && leftBlock.outputConnection) conn.connect(leftBlock.outputConnection);
    }
    const rightBlock = expressionToBlock(node.right, source, workspace);
    if (rightBlock) {
      initBlock(rightBlock);
      const conn = block.getInput("B")?.connection;
      if (conn && rightBlock.outputConnection) conn.connect(rightBlock.outputConnection);
    }
    return block;
  }

  // Modulo → Blockly's built-in math_modulo block
  if (node.operator === "%") {
    const block = workspace.newBlock("math_modulo");
    const leftBlock = expressionToBlock(node.left, source, workspace);
    if (leftBlock) {
      initBlock(leftBlock);
      const conn = block.getInput("DIVIDEND")?.connection;
      if (conn && leftBlock.outputConnection) conn.connect(leftBlock.outputConnection);
    }
    const rightBlock = expressionToBlock(node.right, source, workspace);
    if (rightBlock) {
      initBlock(rightBlock);
      const conn = block.getInput("DIVISOR")?.connection;
      if (conn && rightBlock.outputConnection) conn.connect(rightBlock.outputConnection);
    }
    return block;
  }

  const validOps = ["===", "!==", ">", "<", ">=", "<="];
  if (!validOps.includes(node.operator)) {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  const block = workspace.newBlock("mac_compare");
  block.setFieldValue(node.operator, "OP");

  const leftBlock = expressionToBlock(node.left, source, workspace);
  if (leftBlock) {
    initBlock(leftBlock);
    const conn = block.getInput("LEFT")?.connection;
    if (conn && leftBlock.outputConnection) conn.connect(leftBlock.outputConnection);
  }

  const rightBlock = expressionToBlock(node.right, source, workspace);
  if (rightBlock) {
    initBlock(rightBlock);
    const conn = block.getInput("RIGHT")?.connection;
    if (conn && rightBlock.outputConnection) conn.connect(rightBlock.outputConnection);
  }

  return block;
}

/**
 * Flatten a chain of logical expressions with the same operator.
 * e.g. `a && b && c` (parsed as `(a && b) && c`) → [a, b, c]
 */
function flattenLogicalChain(node: any, operator: string): any[] {
  const operands: any[] = [];
  if (node.type === "LogicalExpression" && node.operator === operator) {
    operands.push(...flattenLogicalChain(node.left, operator));
    operands.push(...flattenLogicalChain(node.right, operator));
  } else {
    operands.push(node);
  }
  return operands;
}

function logicalExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  if (node.operator !== "&&" && node.operator !== "||") {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  const blockType = node.operator === "&&" ? "mac_logic_and" : "mac_logic_or";
  const operands = flattenLogicalChain(node, node.operator);

  const block = workspace.newBlock(blockType) as any;
  // Add extra inputs beyond the initial 2
  while (block.itemCount_ < operands.length) {
    block.appendValueInput(`COND${block.itemCount_}`);
    block.itemCount_++;
  }

  for (let i = 0; i < operands.length; i++) {
    const childBlock = expressionToBlock(operands[i], source, workspace);
    if (childBlock) {
      initBlock(childBlock);
      const conn = block.getInput(`COND${i}`)?.connection;
      if (conn && childBlock.outputConnection) conn.connect(childBlock.outputConnection);
    }
  }

  return block;
}

function arrayExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const elements = node.elements ?? [];
  const block = workspace.newBlock("mac_list_create") as any;

  // Adjust item count to match elements
  while (block.itemCount_ < elements.length) {
    block.appendValueInput(`ADD${block.itemCount_}`);
    block.itemCount_++;
  }
  while (block.itemCount_ > elements.length && block.itemCount_ > 0) {
    block.itemCount_--;
    block.removeInput(`ADD${block.itemCount_}`);
  }

  for (let i = 0; i < elements.length; i++) {
    if (!elements[i]) continue;
    const childBlock = expressionToBlock(elements[i], source, workspace);
    if (childBlock) {
      initBlock(childBlock);
      const conn = block.getInput(`ADD${i}`)?.connection;
      if (conn && childBlock.outputConnection) conn.connect(childBlock.outputConnection);
    }
  }

  return block;
}

function objectExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const properties = (node.properties ?? []).filter(
    (p: any) => p.type === "Property" && !p.computed
  );
  // Fall back to raw for spread elements or computed keys
  if (properties.length !== (node.properties ?? []).length) {
    return rawExpressionBlock(nodeSource(node, source), workspace);
  }

  const block = workspace.newBlock("mac_object_literal") as any;

  // Adjust property count to match
  while (block.propCount_ < properties.length) {
    block.appendValueInput(`VAL${block.propCount_}`)
      .appendField(new Blockly.FieldTextInput("key"), `KEY${block.propCount_}`)
      .appendField(":");
    block.propCount_++;
  }
  while (block.propCount_ > properties.length && block.propCount_ > 0) {
    block.propCount_--;
    block.removeInput(`VAL${block.propCount_}`);
  }

  for (let i = 0; i < properties.length; i++) {
    const prop = properties[i];
    // Get key name
    const keyName = prop.key.type === "Identifier" ? prop.key.name : String(prop.key.value ?? "key");
    block.setFieldValue(keyName, `KEY${i}`);

    // Parse and connect value
    const valueBlock = expressionToBlock(prop.value, source, workspace);
    if (valueBlock) {
      initBlock(valueBlock);
      const conn = block.getInput(`VAL${i}`)?.connection;
      if (conn && valueBlock.outputConnection) conn.connect(valueBlock.outputConnection);
    }
  }

  return block;
}

/**
 * Try to create a namespace block for a call path like "rolledItem.system.properties.has".
 * The path is split into parts; progressively longer prefixes are tested for _ns blocks.
 * When the terminal selection is a function/method, loadExtraState triggers addFunctionInputs
 * which adds FPARAM_* value inputs for the arguments.
 * Returns the block on success (with call arguments connected), or null.
 */
function tryNamespaceCallBlock(
  callPath: string,
  callNode: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const parts = callPath.split(".");
  if (parts.length < 2) return null;

  for (let prefixLen = 1; prefixLen < parts.length; prefixLen++) {
    const prefix = parts.slice(0, prefixLen).join(".");
    const nsBlockType =
      "mac_" + prefix.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "") + "_ns";
    if (!Blockly.Blocks[nsBlockType]) continue;

    const selections = parts.slice(prefixLen);
    const block = workspace.newBlock(nsBlockType);
    try {
      (block as any).loadExtraState({ selections });
      // Verify all selections were accepted
      const expectedDepth = selections.length - 1;
      if (((block as any).chainDepth_ ?? 0) < expectedDepth) {
        safeDispose(block);
        continue;
      }
      let allMatch = true;
      for (let si = 0; si < selections.length; si++) {
        if (block.getFieldValue(`PROP_${si}`) !== selections[si]) {
          allMatch = false;
          break;
        }
      }
      if (!allMatch) {
        safeDispose(block);
        continue;
      }
      // If the block gained function inputs (isCall_), it recognized the terminal
      // as a function — connect the call arguments to its FPARAM_* inputs
      if ((block as any).isCall_) {
        connectCallArguments(block, callNode, source, workspace);
      }
      return block;
    } catch {
      safeDispose(block);
    }
  }
  return null;
}

/** Method input types matching the block definition in treeToBlocks.ts */
const LIST_METHOD_INFO: Record<string, "callback" | "value" | "noArg"> = {
  map: "callback", filter: "callback", find: "callback",
  some: "callback", every: "callback", findIndex: "callback", flatMap: "callback",
  includes: "value", indexOf: "value", at: "value",
  join: "value", push: "value", concat: "value", slice: "value", fill: "value",
  reverse: "noArg", sort: "noArg", flat: "noArg",
  first: "noArg", last: "noArg", pop: "noArg", shift: "noArg",
  keys: "noArg", values: "noArg",
  forEach: "callback", // forEach uses mac_list_forEach (statement), handled separately
};

/** Helper to connect the LIST input on a list method block */
function connectListInput(
  block: Blockly.Block,
  objectNode: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): void {
  const listBlock = expressionToBlock(objectNode, source, workspace);
  if (listBlock) {
    initBlock(listBlock);
    const conn = block.getInput("LIST")?.connection;
    if (conn && listBlock.outputConnection) conn.connect(listBlock.outputConnection);
  }
}

/**
 * Try to convert expr.method(...) to a mac_list_method or mac_list_forEach block.
 * Handles callback methods (map/filter/...), value-arg methods (includes/indexOf/...),
 * and no-arg methods (first/last/reverse/...).
 * forEach is handled separately as a statement block (mac_list_forEach).
 */
function tryListMethodBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  const callee = node.callee;
  if (callee?.type !== "MemberExpression" || callee.computed) return null;
  const methodName = callee.property?.name;
  if (!methodName || !LIST_METHOD_INFO[methodName]) return null;

  const inputType = LIST_METHOD_INFO[methodName];

  // ── forEach → mac_list_forEach (statement block) ──
  if (methodName === "forEach") {
    if (node.arguments?.length !== 1) return null;
    const callback = node.arguments[0];
    if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return null;
    if (callback.params?.length !== 1 || callback.params[0].type !== "Identifier") return null;
    if (callback.body?.type !== "BlockStatement") return null;

    const block = workspace.newBlock("mac_list_forEach");
    block.setFieldValue(callback.params[0].name, "VAR");
    connectListInput(block, callee.object, source, workspace);
    connectStatementBody(block, "BODY", callback.body, source, workspace);
    return block;
  }

  // ── Callback methods → mac_list_method with method dropdown ──
  if (inputType === "callback") {
    if (node.arguments?.length !== 1) return null;
    const callback = node.arguments[0];
    if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return null;
    if (callback.params?.length !== 1 || callback.params[0].type !== "Identifier") return null;

    // Extract callback expression
    let exprNode: any = null;
    if (callback.body?.type !== "BlockStatement") {
      exprNode = callback.body;
    } else {
      const stmts = callback.body.body ?? [];
      if (stmts.length === 1 && stmts[0].type === "ReturnStatement" && stmts[0].argument) {
        exprNode = stmts[0].argument;
      }
    }
    if (!exprNode) return null;

    const block = workspace.newBlock("mac_list_method") as any;
    block.loadExtraState({ method: methodName, varName: callback.params[0].name });
    connectListInput(block, callee.object, source, workspace);

    const exprBlock = expressionToBlock(exprNode, source, workspace);
    if (exprBlock) {
      initBlock(exprBlock);
      const conn = block.getInput("ARG_EXPR")?.connection;
      if (conn && exprBlock.outputConnection) conn.connect(exprBlock.outputConnection);
    }
    return block;
  }

  // ── Value-arg methods → mac_list_method with value input ──
  if (inputType === "value") {
    if (node.arguments?.length !== 1) return null;
    const block = workspace.newBlock("mac_list_method") as any;
    block.loadExtraState({ method: methodName });
    connectListInput(block, callee.object, source, workspace);

    const argBlock = expressionToBlock(node.arguments[0], source, workspace);
    if (argBlock) {
      initBlock(argBlock);
      const conn = block.getInput("ARG_VALUE")?.connection;
      if (conn && argBlock.outputConnection) conn.connect(argBlock.outputConnection);
    }
    return block;
  }

  // ── No-arg methods → mac_list_method with empty parens ──
  if (inputType === "noArg") {
    if (node.arguments?.length !== 0) return null;
    const block = workspace.newBlock("mac_list_method") as any;
    block.loadExtraState({ method: methodName });
    connectListInput(block, callee.object, source, workspace);
    return block;
  }

  return null;
}

function callExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // Detect [literal, ...].includes(expr) pattern → mac_value_in_list block
  const callee = node.callee;
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.property?.name === "includes" &&
    callee.object?.type === "ArrayExpression" &&
    node.arguments?.length === 1 &&
    callee.object.elements.every((el: any) => el?.type === "Literal")
  ) {
    const items = callee.object.elements.map((el: any) => {
      if (typeof el.value === "string") return `"${el.value}"`;
      return String(el.value);
    }).join(", ");
    const block = workspace.newBlock("mac_value_in_list");
    block.setFieldValue(items, "ITEMS");
    const argBlock = expressionToBlock(node.arguments[0], source, workspace);
    if (argBlock) {
      initBlock(argBlock);
      const conn = block.getInput("VALUE")?.connection;
      if (conn && argBlock.outputConnection) conn.connect(argBlock.outputConnection);
    }
    return block;
  }

  // Detect Object.keys/values/entries(x) and Array.from(x)
  if (
    callee?.type === "MemberExpression" &&
    !callee.computed &&
    callee.object?.type === "Identifier" &&
    node.arguments?.length === 1
  ) {
    const objName = callee.object.name;
    const methodName = callee.property?.name;
    let utilBlockType: string | null = null;
    if (objName === "Object" && (methodName === "keys" || methodName === "values" || methodName === "entries")) {
      utilBlockType = `mac_object_${methodName}`;
    } else if (objName === "Array" && methodName === "from") {
      utilBlockType = "mac_array_from";
    }
    if (utilBlockType && Blockly.Blocks[utilBlockType]) {
      const block = workspace.newBlock(utilBlockType);
      const argBlock = expressionToBlock(node.arguments[0], source, workspace);
      if (argBlock) {
        initBlock(argBlock);
        const inputName = utilBlockType === "mac_array_from" ? "ITERABLE" : "OBJ";
        const conn = block.getInput(inputName)?.connection;
        if (conn && argBlock.outputConnection) conn.connect(argBlock.outputConnection);
      }
      return block;
    }
  }

  const callPath = getCallPath(node);
  if (callPath) {
    // Try namespace blocks first — these show the full chain with editable
    // dropdowns (e.g., workflow . targets . first) which is more useful than
    // an individual function block with a fixed label.
    const nsBlock = tryNamespaceCallBlock(callPath, node, source, workspace);
    if (nsBlock) return nsBlock;

    // Fallback: exact-match registered function block
    const blockType = "mac_" + callPath.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "");
    if (Blockly.Blocks[blockType]) {
      const block = workspace.newBlock(blockType);
      if (block.outputConnection) {
        // For multi-arg blocks (console, notifications), expand inputs to match arg count
        if ((block as any).loadExtraState && node.arguments?.length > 1) {
          (block as any).loadExtraState({ argCount: node.arguments.length });
        }
        connectCallArguments(block, node, source, workspace);
        return block;
      }
      // Statement block can't be used as a value — dispose and fall through
      safeDispose(block);
    }
  }

  // Detect list/array method calls: expr.map/filter/includes/first/etc.
  // This is a fallback after namespace blocks, so workflow.targets.first() resolves
  // as a single namespace block rather than splitting into workflow.targets + first()
  const listMethodBlock = tryListMethodBlock(node, source, workspace);
  if (listMethodBlock) return listMethodBlock;

  return rawExpressionBlock(nodeSource(node, source), workspace);
}

function awaitExpressionToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // If the inner expression is a call to a registered async function block,
  // the block's generator already includes `await` — return it directly
  // without wrapping in mac_await (which would produce `await await ...`).
  // Only use the registered block if it's a value block (has outputConnection),
  // since await expressions are always used in value context.
  if (node.argument.type === "CallExpression") {
    const callPath = getCallPath(node.argument);
    if (callPath) {
      const blockType = "mac_" + callPath.replace(/\./g, "_").replace(/[^a-zA-Z0-9_]/g, "");
      if (Blockly.Blocks[blockType] && asyncBlockTypes.has(blockType)) {
        const block = workspace.newBlock(blockType);
        if (block.outputConnection) {
          connectCallArguments(block, node.argument, source, workspace);
          return block;
        }
        // Statement block can't be used as a value — dispose and fall through
        safeDispose(block);
      }
    }
  }

  const block = workspace.newBlock("mac_await");
  const innerBlock = expressionToBlock(node.argument, source, workspace);
  if (innerBlock) {
    initBlock(innerBlock);
    const conn = block.getInput("EXPRESSION")?.connection;
    if (conn && innerBlock.outputConnection) conn.connect(innerBlock.outputConnection);
  }
  return block;
}

/**
 * Detect `new Promise(param => ...)` → mac_await_promise block.
 * Matches arrow/function expression callbacks with a single parameter.
 * The callback body is parsed into the block's BODY statement input.
 */
function tryAwaitPromiseBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block | null {
  // Must be `new Promise(callback)`
  if (
    node.type !== "NewExpression" ||
    node.callee?.type !== "Identifier" ||
    node.callee.name !== "Promise" ||
    node.arguments?.length !== 1
  ) return null;

  const callback = node.arguments[0];
  if (callback.type !== "ArrowFunctionExpression" && callback.type !== "FunctionExpression") return null;
  if (callback.params?.length !== 1 || callback.params[0].type !== "Identifier") return null;
  const paramName = callback.params[0].name;

  const block = workspace.newBlock("mac_await_promise");
  block.setFieldValue(paramName, "PARAM");

  // Expression body: `r => setTimeout(r, 1000)` — wrap as a single statement
  if (callback.body.type !== "BlockStatement") {
    const syntheticBody = {
      type: "BlockStatement",
      body: [{ type: "ExpressionStatement", expression: callback.body, start: callback.body.start, end: callback.body.end }],
    };
    connectStatementBody(block, "BODY", syntheticBody, source, workspace);
  } else {
    connectStatementBody(block, "BODY", callback.body, source, workspace);
  }

  return block;
}

// ── Helper functions ──

/** Create a raw JS statement block with the given code */
function rawStatementBlock(code: string, workspace: Blockly.WorkspaceSvg): Blockly.Block {
  const block = workspace.newBlock("mac_raw_statement");
  block.setFieldValue(code.replace(/;\s*$/, ""), "CODE");
  return block;
}

/** Create a raw JS expression block with the given code */
function rawExpressionBlock(code: string, workspace: Blockly.WorkspaceSvg): Blockly.Block {
  const block = workspace.newBlock("mac_raw_expression");
  block.setFieldValue(code, "CODE");
  return block;
}

/**
 * Get the dotted path of a member expression (e.g., "game.settings.get").
 * Returns null for computed member expressions or complex callee patterns.
 */
function getMemberPath(node: any): string | null {
  if (node.type === "Identifier") return node.name;
  if (node.type !== "MemberExpression") return null;
  // Handle computed numeric access: items[0] → "items.0"
  if (node.computed) {
    if (node.property?.type === "Literal" && typeof node.property.value === "number") {
      const objPath = getMemberPath(node.object);
      if (!objPath) return null;
      return `${objPath}.${node.property.value}`;
    }
    return null;
  }
  const objPath = getMemberPath(node.object);
  if (!objPath) return null;
  if (node.property.type !== "Identifier") return null;
  return `${objPath}.${node.property.name}`;
}

/**
 * Get the dotted path of a call expression's callee.
 */
function getCallPath(node: any): string | null {
  return getMemberPath(node.callee);
}

/**
 * Connect a BlockStatement or single statement body to a statement input.
 */
function connectStatementBody(
  parentBlock: Blockly.Block,
  inputName: string,
  bodyNode: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): void {
  const statements = bodyNode.type === "BlockStatement" ? bodyNode.body : [bodyNode];
  if (statements.length === 0) return;

  let firstBlock: Blockly.Block | null = null;
  let prevBlock: Blockly.Block | null = null;

  for (const stmt of statements) {
    const block = statementToBlock(stmt, source, workspace);
    if (!block) continue;

    initBlock(block);

    if (!firstBlock) {
      firstBlock = block;
    }

    if (prevBlock?.nextConnection && block.previousConnection) {
      prevBlock.nextConnection.connect(block.previousConnection);
    }

    prevBlock = getLastInChain(block);
  }

  if (firstBlock) {
    const conn = parentBlock.getInput(inputName)?.connection;
    if (conn && firstBlock.previousConnection) {
      conn.connect(firstBlock.previousConnection);
    }
  }
}

/**
 * Try to connect call arguments to a function block's parameter inputs.
 */
function connectCallArguments(
  block: Blockly.Block,
  callNode: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): void {
  const args = callNode.arguments ?? [];

  // Get the block's value inputs (inputs that accept value connections)
  const inputs = block.inputList.filter(
    (input: any) => input.type === Blockly.inputs.inputTypes.VALUE
  );

  for (let i = 0; i < Math.min(args.length, inputs.length); i++) {
    const argBlock = expressionToBlock(args[i], source, workspace);
    if (argBlock) {
      initBlock(argBlock);
      const conn = inputs[i].connection;
      if (conn && argBlock.outputConnection) {
        conn.connect(argBlock.outputConnection);
      }
    }
  }
}

/**
 * Convert an assignment expression to a raw statement block.
 */
function assignmentToBlock(
  node: any,
  source: string,
  workspace: Blockly.WorkspaceSvg
): Blockly.Block {
  return rawStatementBlock(nodeSource(node, source), workspace);
}
