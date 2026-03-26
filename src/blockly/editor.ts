/**
 * BlocklyEditor — manages the Blockly workspace lifecycle for a single
 * code-mirror element, handling mode switching, code generation, and
 * workspace serialization.
 */

import * as Blockly from "blockly/core";
import "blockly/blocks"; // Built-in blocks (logic, loops, math, text, etc.)
import * as En from "blockly/msg/en"; // Locale strings for standard block messages
import { javascriptGenerator } from "blockly/javascript";

// Standard blocks use message references like %{BKY_TEXT_LENGTH_TITLE} that
// need locale strings loaded to resolve into "length of %1" etc.
Blockly.setLocale(En as any);
// Override ÷ with / for readability on small screens
Blockly.Msg["MATH_DIVISION_SYMBOL"] = "/";
Blockly.Msg["MATH_MULTIPLICATION_SYMBOL"] = "*";
Blockly.Msg["MATH_MODULO_TITLE"] = "%1 % %2";
import {
  registerBlocksFromTree,
  registerBuiltinBlocks,
  clearRegisteredBlocks,
  registerPropertyBlock,
  registerFunctionBlock,
  registerNamespaceBlock,
} from "./treeToBlocks";
import { buildToolbox, getAllTemplates } from "./toolbox";
import { jsToBlocks } from "./jsToBlocks";

/** Reference to the completion tree — set during initialization */
let completionTree: Record<string, any> | null = null;

/** Track whether blocks have been registered from the tree */
let blocksRegistered = false;

/** Cached categories map from the last registration */
let cachedCategories: Map<string, string[]> = new Map();

/** Map of blockly container elements to their BlocklyEditor instances */
const editorInstances = new WeakMap<HTMLElement, BlocklyEditor>();

/**
 * Initialize the Blockly integration with the completion tree.
 * Called once after macro-autocomplete.ready completions are injected.
 */
export function initBlockly(tree: Record<string, any>): void {
  completionTree = tree;
  blocksRegistered = false;
  cachedCategories = new Map();
}

/**
 * Ensure blocks are registered from the completion tree.
 * Lazy — only runs the first time a visual editor is opened.
 * Returns the cached categories map on subsequent calls.
 */
function ensureBlocksRegistered(): Map<string, string[]> {
  if (!completionTree) {
    return new Map();
  }

  if (!blocksRegistered) {
    clearRegisteredBlocks();
    registerBuiltinBlocks();
    cachedCategories = registerBlocksFromTree(completionTree);
    blocksRegistered = true;
  }

  return cachedCategories;
}

export class BlocklyEditor {
  /** The container div that holds the Blockly workspace */
  readonly container: HTMLElement;

  /** The code-mirror element this editor is associated with */
  readonly codeMirrorElement: HTMLElement;

  /** The Blockly workspace instance */
  workspace: Blockly.WorkspaceSvg | null = null;

  /** Whether the visual editor is currently active (visible) */
  private _active = false;

  /** Cached workspace state for serialization */
  private savedState: object | null = null;

  /** The CodeMirror content captured when switching to visual mode.
   *  Preserved so switching back to text mode restores it if no blocks were placed. */
  private preservedCode: string | null = null;

  /** The code last written to CodeMirror by the visual editor (hide/generate).
   *  Used to detect whether the user edited the text while in text mode. */
  private lastCodeOutput: string | null = null;

  /** Whether the user has placed any blocks in the workspace during this visual session */
  private hasUserBlocks = false;

  /** ResizeObserver that keeps the Blockly workspace sized to the parent */
  private resizeObserver: ResizeObserver | null = null;

  /** Context-specific category specification (e.g., condition sandbox variables).
   *  Keys are category display names, values are maps of JS path → completion entry.
   *  When set, the toolbox shows only these categories instead of the global tree. */
  private contextCategorySpec: Record<string, Record<string, any>> | null = null;

  /** Cached categories from context spec registration */
  private contextCategories: Map<string, string[]> | null = null;

  constructor(codeMirrorElement: HTMLElement) {
    this.codeMirrorElement = codeMirrorElement;

    // Create the container div for Blockly
    this.container = document.createElement("div");
    this.container.className = "mac-blockly-container";
    this.container.style.display = "none";

    // Prevent keyboard events from propagating to Foundry (e.g., Delete key
    // deleting both a Blockly block and a canvas token simultaneously).
    this.container.addEventListener("keydown", (e) => e.stopPropagation());
    this.container.addEventListener("keyup", (e) => e.stopPropagation());

    // Insert after the code-mirror element
    codeMirrorElement.parentElement?.insertBefore(
      this.container,
      codeMirrorElement.nextSibling
    );

    editorInstances.set(this.container, this);
  }

  get active(): boolean {
    return this._active;
  }

  /**
   * Set context-specific categories for the Blockly toolbox.
   * Each key is a category display name (e.g., "Actor Data"), and each value
   * is a map of JS code paths to completion entries. The editor registers
   * property/function blocks for each entry and builds the toolbox from them.
   * Pass null to revert to the global tree.
   */
  setContextCategories(categories: Record<string, Record<string, any>> | null): void {
    this.contextCategorySpec = categories;
    this.contextCategories = null; // force rebuild
  }

  /**
   * Show the Blockly workspace and hide the CodeMirror editor.
   * Returns false if the user cancelled the switch (e.g., existing code warning).
   */
  show(): boolean {
    if (this._active) return true;

    // Capture the current CodeMirror content before switching
    this.preservedCode = this.readCodeMirror();
    this.hasUserBlocks = false;

    // Detect whether the user edited the text since we last wrote to CodeMirror
    const codeChanged = this.lastCodeOutput !== null &&
      this.preservedCode?.trim() !== this.lastCodeOutput.trim();

    // Ensure global blocks are registered (needed for builtins and parser)
    ensureBlocksRegistered();

    // Build toolbox: use context categories if available, otherwise global tree
    let toolboxCategories: Map<string, string[]>;
    if (this.contextCategorySpec) {
      if (!this.contextCategories) {
        this.contextCategories = this.buildContextCategories();
      }
      toolboxCategories = this.contextCategories;
    } else {
      toolboxCategories = ensureBlocksRegistered();
    }
    const toolbox = buildToolbox(toolboxCategories);

    this.codeMirrorElement.style.display = "none";
    this.container.style.display = "block";

    // Set explicit dimensions — Blockly needs measurable container
    this.updateContainerSize();

    // Watch for parent resize (window drag, Foundry app resize)
    this.startResizeObserver();

    if (!this.workspace) {
      this.workspace = Blockly.inject(this.container, {
        toolbox,
        scrollbars: true,
        trashcan: true,
        zoom: {
          controls: true,
          wheel: true,
          startScale: 0.8,
          maxScale: 2,
          minScale: 0.3,
          scaleSpeed: 1.2,
        },
        grid: {
          spacing: 20,
          length: 3,
          colour: "#ccc",
          snap: true,
        },
        move: {
          scrollbars: true,
          drag: true,
          wheel: true,
        },
        sounds: false,
        renderer: "zelos",
        theme: this.createTheme(),
      });

      // Ensure the workspace SVG is properly sized before adding blocks
      Blockly.svgResize(this.workspace);

      // Register template button callbacks
      for (const template of getAllTemplates()) {
        const ws = this.workspace;
        this.workspace.registerButtonCallback(template.callbackKey, () => {
          if (!ws) return;
          try {
            // Find the last top-level statement block to chain new blocks onto
            const topBlocks = ws.getTopBlocks(true); // ordered by position
            const lastTop = topBlocks.filter((b: Blockly.Block) => b.nextConnection).pop() ?? null;
            jsToBlocks(template.source, ws, lastTop);
            this.hasUserBlocks = true;
            // Deferred re-render — blocks may not lay out correctly until
            // the browser has reflowed after the flyout closes.
            requestAnimationFrame(() => {
              for (const block of ws.getAllBlocks(false)) {
                (block as any).initSvg?.();
                (block as any).render?.();
              }
            });
          } catch (err) {
            console.error(`macro-autocomplete | Failed to load template "${template.name}":`, err);
          }
        });
      }

      // Listen for block changes to track user blocks and sync code to CodeMirror.
      // Syncing on every change ensures the macro is executable without switching
      // back to text mode first.
      this.workspace.addChangeListener((event: Blockly.Events.Abstract) => {
        if (event.type === Blockly.Events.BLOCK_CREATE ||
            event.type === Blockly.Events.BLOCK_MOVE ||
            event.type === Blockly.Events.BLOCK_DELETE ||
            event.type === Blockly.Events.BLOCK_CHANGE) {
          this.hasUserBlocks = (this.workspace?.getTopBlocks(false).length ?? 0) > 0;
          if (this.hasUserBlocks) {
            const code = this.generateCode();
            this.updateCodeMirror(code);
            this.lastCodeOutput = code;
          }
        }
      });
    } else {
      // Workspace already exists — update toolbox in case context changed
      this.workspace.updateToolbox(toolbox as any);
    }

    // If text was edited in CodeMirror, clear workspace and reconvert
    if (codeChanged && this.workspace) {
      this.workspace.clear();
      this.savedState = null;
      if (this.preservedCode?.trim()) {
        try {
          jsToBlocks(this.preservedCode, this.workspace);
        } catch (err) {
          console.error("macro-autocomplete | Blockly: Could not convert edited code to blocks:", err);
        }
      }
      this.hasUserBlocks = this.workspace.getTopBlocks(false).length > 0;
    } else if (this.savedState && this.workspace) {
      // No text changes — restore previous workspace state
      Blockly.serialization.workspaces.load(this.savedState, this.workspace);
      this.hasUserBlocks = this.workspace.getTopBlocks(false).length > 0;
    } else if (this.preservedCode?.trim() && this.workspace) {
      // First time with existing code — try to convert
      try {
        jsToBlocks(this.preservedCode, this.workspace);
        this.hasUserBlocks = this.workspace.getTopBlocks(false).length > 0;
      } catch (err) {
        console.error("macro-autocomplete | Blockly: Could not convert existing code to blocks:", err);
      }
    }

    Blockly.svgResize(this.workspace!);

    // Deferred re-render: on the first display, block rendering can be incomplete
    // because the workspace SVG may not be fully laid out yet. Schedule a second
    // render pass after the browser has reflowed.
    const ws = this.workspace!;
    requestAnimationFrame(() => {
      for (const block of ws.getAllBlocks(false)) {
        (block as any).render?.();
      }
    });

    this._active = true;
    return true;
  }

  /**
   * Hide the Blockly workspace and show the CodeMirror editor.
   * Only overwrites CodeMirror content if the user has placed blocks;
   * otherwise restores the original code that was present before switching.
   */
  hide(): void {
    if (!this._active) return;

    if (this.workspace) {
      // Save workspace state for later restoration
      this.savedState = Blockly.serialization.workspaces.save(this.workspace);

      if (this.hasUserBlocks) {
        // User has blocks — generate code from them
        const code = this.generateCode();
        this.updateCodeMirror(code);
        this.lastCodeOutput = code;
      } else if (this.preservedCode !== null) {
        // No blocks placed — restore the original code
        this.updateCodeMirror(this.preservedCode);
        this.lastCodeOutput = this.preservedCode;
      }
      // If both are false/null, don't touch CodeMirror at all
    }

    this.stopResizeObserver();
    this.container.style.display = "none";
    this.codeMirrorElement.style.display = "";
    this._active = false;
  }

  /**
   * Toggle between CodeMirror and Blockly modes.
   */
  toggle(): void {
    if (this._active) {
      this.hide();
    } else {
      this.show();
    }
  }

  /**
   * Generate JavaScript code from the current workspace.
   * Top-level blocks are sorted by Y position so visual ordering
   * matches the generated code order.
   */
  generateCode(): string {
    if (!this.workspace) return "";

    // Get top-level blocks (those without a parent) and sort by Y position
    // so the visual top-to-bottom order determines code output order.
    const topBlocks = this.workspace.getTopBlocks(false)
      .filter((b: Blockly.Block) => !b.outputConnection)  // statement blocks only
      .sort((a: Blockly.Block, b: Blockly.Block) => {
        const ay = (a as any).getRelativeToSurfaceXY?.()?.y ?? 0;
        const by = (b as any).getRelativeToSurfaceXY?.()?.y ?? 0;
        return ay - by;
      });

    javascriptGenerator.init(this.workspace);
    const codeParts: string[] = [];
    for (const block of topBlocks) {
      const code = javascriptGenerator.blockToCode(block);
      if (typeof code === "string" && code) {
        codeParts.push(code);
      }
    }

    return codeParts.join("\n").trim();
  }

  /**
   * Build the Blockly toolbox categories from the context category spec.
   * Registers property/function blocks as needed and returns a categories map.
   */
  private buildContextCategories(): Map<string, string[]> {
    const categories = new Map<string, string[]>();
    if (!this.contextCategorySpec) return categories;

    for (const [catName, entries] of Object.entries(this.contextCategorySpec)) {
      const blocks: string[] = [];
      const sortedEntries = Object.entries(entries).sort(([a], [b]) => a.localeCompare(b));
      for (const [path, entry] of sortedEntries) {
        let blockType: string | null = null;
        if (entry.type === "function" || entry.type === "method") {
          blockType = registerFunctionBlock(path, entry);
        } else {
          const children = entry.children ?? entry.instanceChildren;
          if (children && Object.keys(children).length > 0) {
            blockType = registerNamespaceBlock(path, entry, children);
          } else {
            blockType = registerPropertyBlock(path, entry);
          }
        }
        if (blockType) blocks.push(blockType);
      }
      if (blocks.length > 0) categories.set(catName, blocks);
    }

    return categories;
  }

  /**
   * Read the current content from the CodeMirror editor.
   */
  private readCodeMirror(): string {
    const view = this.getEditorView();
    if (view?.state?.doc) {
      return view.state.doc.toString();
    }
    return "";
  }

  /**
   * Get the CodeMirror EditorView from the code-mirror element.
   */
  private getEditorView(): any {
    const cmEl = this.codeMirrorElement as any;
    if (cmEl.cmView?.view) return cmEl.cmView.view;
    if (cmEl._view) return cmEl._view;
    const cmContent = cmEl.querySelector?.(".cm-content");
    if (cmContent?.cmView?.view) return cmContent.cmView.view;
    return null;
  }

  /**
   * Update the CodeMirror editor content with generated code.
   */
  private updateCodeMirror(code: string): void {
    const view = this.getEditorView();
    if (view?.dispatch) {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: code,
        },
      });
    } else {
      console.error("macro-autocomplete | Blockly: Could not access CodeMirror EditorView to update code");
    }
  }

  /**
   * Recalculate the container dimensions from the parent's current size.
   */
  private updateContainerSize(): void {
    const parent = this.container.parentElement;
    if (parent) {
      const rect = parent.getBoundingClientRect();
      this.container.style.width = `${rect.width}px`;
      this.container.style.height = `${Math.max(rect.height - 40, 400)}px`;
    }
  }

  /**
   * Start observing the parent element for size changes.
   */
  private startResizeObserver(): void {
    this.stopResizeObserver();
    const parent = this.container.parentElement;
    if (!parent) return;
    this.resizeObserver = new ResizeObserver(() => {
      if (!this._active || !this.workspace) return;
      this.updateContainerSize();
      Blockly.svgResize(this.workspace);
    });
    this.resizeObserver.observe(parent);
  }

  /**
   * Stop observing parent size changes.
   */
  private stopResizeObserver(): void {
    if (this.resizeObserver) {
      this.resizeObserver.disconnect();
      this.resizeObserver = null;
    }
  }

  /**
   * Create a custom Blockly theme that matches Foundry's dark UI.
   */
  private createTheme(): Blockly.Theme {
    return Blockly.Theme.defineTheme("foundry", {
      name: "foundry",
      base: Blockly.Themes.Classic,
      componentStyles: {
        workspaceBackgroundColour: "#1a1a2e",
        toolboxBackgroundColour: "#16213e",
        toolboxForegroundColour: "#e0e0e0",
        flyoutBackgroundColour: "#1a1a2e",
        flyoutForegroundColour: "#e0e0e0",
        flyoutOpacity: 0.9,
        scrollbarColour: "#4a4a6a",
        scrollbarOpacity: 0.7,
        insertionMarkerColour: "#fff",
        insertionMarkerOpacity: 0.3,
        markerColour: "#fff",
        cursorColour: "#fff",
      },
      fontStyle: {
        family: "Signika, sans-serif",
        weight: "normal",
        size: 11,
      },
    });
  }

  /**
   * Clean up the Blockly workspace and DOM elements.
   */
  dispose(): void {
    this.stopResizeObserver();
    if (this.workspace) {
      this.workspace.dispose();
      this.workspace = null;
    }
    this.container.remove();
    this._active = false;
  }
}

/**
 * Get or create a BlocklyEditor for a given code-mirror element.
 */
export function getOrCreateEditor(codeMirrorElement: HTMLElement): BlocklyEditor {
  // Check if we already have an editor for the sibling container
  const existingContainer = codeMirrorElement.nextElementSibling;
  if (existingContainer instanceof HTMLElement && editorInstances.has(existingContainer)) {
    return editorInstances.get(existingContainer)!;
  }

  return new BlocklyEditor(codeMirrorElement);
}
