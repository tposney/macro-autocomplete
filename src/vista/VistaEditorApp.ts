/**
 * Vista Scene Editor — ApplicationV2 for browsing, creating, and editing
 * Ember Vista scene configurations.
 */

import {
  type VistaConfig,
  type CompositionConfig,
  type SpriteConfig,
  type LightConfig,
  type PlacementConfig,
  getAllVistas,
  getVista,
  getCustomVistas,
  getBuiltinVistas,
  isCustomVista,
  saveCustomVista,
  deleteCustomVista,
  createBlankVistaConfig,
  duplicateVistaConfig,
} from "./vistaStorage";

const MODULE_ID = "macro-autocomplete";

// ── CSS Injection ───────────────────────────────────────────────────────────

function injectVistaEditorStyles(): void {
  if (document.getElementById("mac-vista-editor-styles")) return;
  const style = document.createElement("style");
  style.id = "mac-vista-editor-styles";
  style.textContent = `
    #mac-vista-editor {
      min-width: 700px;
    }

    /* Browse wrapper — scrollable */
    .mac-vista-editor .vista-browse-wrapper {
      display: flex;
      flex-direction: column;
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.5rem;
    }

    /* Tab sections */
    .mac-vista-editor .tab {
      display: none;
      flex-direction: column;
      flex: 1;
      min-height: 0;
    }
    .mac-vista-editor .tab.active {
      display: flex;
    }
    .mac-vista-editor .tab > .scrollable {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.5rem;
    }

    /* Header bar when editing a vista */
    .mac-vista-editor .vista-editor-header {
      display: flex;
      align-items: center;
      gap: 0.75rem;
      padding: 0.5rem 0.75rem;
      border-bottom: 1px solid var(--color-border-light-tertiary);
      flex: 0 0 auto;
    }
    .mac-vista-editor .vista-editor-header a {
      cursor: pointer;
      color: var(--color-text-light-6);
    }
    .mac-vista-editor .vista-editor-header a:hover {
      color: var(--color-text-light-1);
    }
    .mac-vista-editor .vista-editor-header h3 {
      margin: 0;
      flex: 1;
    }
    .mac-vista-editor .tag {
      font-size: var(--font-size-11);
      padding: 2px 6px;
      border-radius: 3px;
      white-space: nowrap;
    }
    .mac-vista-editor .tag.custom {
      background: var(--color-level-success-bg);
      color: var(--color-level-success);
    }
    .mac-vista-editor .tag.builtin {
      background: var(--color-level-info-bg);
      color: var(--color-level-info);
    }
    .mac-vista-editor .tag.active {
      background: var(--color-level-warning-bg);
      color: var(--color-level-warning);
    }

    /* Tabs */
    .mac-vista-editor .tab {
      flex: 1;
      min-height: 0;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .mac-vista-editor .tab > .scrollable {
      flex: 1;
      min-height: 0;
      overflow-y: auto;
      padding: 0.5rem;
    }

    /* Browse toolbar */
    .vista-browse-toolbar {
      gap: 0.5rem;
      padding: 0.5rem;
      flex: 0 0 auto;
    }
    .vista-browse-toolbar button {
      flex: 0 0 auto;
    }

    /* Browse grid */
    .vista-browse-grid {
      display: grid;
      grid-template-columns: repeat(auto-fill, minmax(220px, 1fr));
      gap: 0.75rem;
      padding: 0.5rem;
    }
    .vista-card {
      border: 1px solid var(--color-border-light-tertiary);
      border-radius: 4px;
      overflow: hidden;
      background: var(--color-bg-option);
      transition: border-color 0.15s;
    }
    .vista-card:hover {
      border-color: var(--color-border-highlight);
    }
    .vista-card.custom {
      border-left: 3px solid var(--color-level-success);
    }
    .vista-card-thumb {
      height: 120px;
      overflow: hidden;
      background: #1a1a2e;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .vista-card-thumb img {
      width: 100%;
      height: 100%;
      object-fit: cover;
    }
    .vista-card-placeholder {
      font-size: 2rem;
      color: var(--color-text-dark-5);
    }
    .vista-card-body {
      padding: 0.5rem;
      display: flex;
      flex-direction: column;
      gap: 0.15rem;
    }
    .vista-card-label {
      font-weight: bold;
      font-size: var(--font-size-13);
    }
    .vista-card-meta {
      font-size: var(--font-size-11);
      color: var(--color-text-dark-5);
    }
    .vista-card-actions {
      display: flex;
      gap: 0.5rem;
      padding: 0.25rem 0.5rem 0.5rem;
    }
    .vista-card-actions a {
      cursor: pointer;
      color: var(--color-text-dark-5);
      font-size: var(--font-size-14);
    }
    .vista-card-actions a:hover {
      color: var(--color-text-light-1);
    }

    /* General tab forms */
    .mac-vista-editor .standard-form fieldset {
      margin-bottom: 0.5rem;
    }
    .mac-vista-editor .form-group.slim {
      margin: 0.15rem 0;
    }
    .mac-vista-editor .form-group.slim label {
      flex: 0 0 auto;
      min-width: 3em;
    }
    .mac-vista-editor .form-footer {
      display: flex;
      gap: 0.5rem;
      padding: 0.5rem 0;
    }
    .mac-vista-editor .form-footer button {
      flex: 1;
    }

    /* Spritesheet rows */
    .spritesheet-row .form-fields {
      display: flex;
      gap: 0.25rem;
      align-items: center;
    }
    .spritesheet-row .form-fields input {
      flex: 1;
    }
    .spritesheet-row .form-fields a {
      flex: 0 0 auto;
      cursor: pointer;
      color: var(--color-text-dark-5);
    }

    /* Compositions layout */
    .compositions-layout {
      gap: 0.75rem;
      height: 100%;
    }
    .composition-sidebar {
      flex: 0 0 200px;
      gap: 0.5rem;
      border-right: 1px solid var(--color-border-light-tertiary);
      padding-right: 0.5rem;
    }
    .composition-sidebar h4 {
      margin: 0;
    }
    .composition-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.25rem;
    }
    .composition-entry {
      display: flex;
      align-items: center;
      gap: 0.25rem;
      padding: 0.25rem 0.5rem;
      border-radius: 3px;
      cursor: pointer;
    }
    .composition-entry:hover {
      background: var(--color-bg-option-hover);
    }
    .composition-entry.active {
      background: var(--color-bg-btn);
      font-weight: bold;
    }
    .composition-entry .comp-label {
      flex: 1;
    }
    .composition-entry .comp-btn {
      flex: 0 0 auto;
      font-size: var(--font-size-11);
      color: var(--color-text-dark-5);
      cursor: pointer;
    }
    .composition-entry .comp-btn:hover {
      color: var(--color-text-light-1);
    }
    .composition-editor {
      flex: 1;
      min-width: 0;
      overflow-y: auto;
    }
    .composition-editor .hint {
      color: var(--color-text-dark-5);
      font-style: italic;
    }

    /* Sprite/Light entries */
    .sprite-entry, .light-entry {
      margin: 0.25rem 0;
      border: 1px solid var(--color-border-light-tertiary);
      border-radius: 3px;
    }
    .sprite-entry summary, .light-entry summary {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      cursor: pointer;
      background: var(--color-bg-option);
    }
    .sprite-entry summary:hover, .light-entry summary:hover {
      background: var(--color-bg-option-hover);
    }
    .sprite-id, .light-id {
      font-family: var(--font-mono);
      font-size: var(--font-size-12);
    }
    .sprite-count {
      font-size: var(--font-size-11);
      color: var(--color-text-dark-5);
    }
    .field-action {
      cursor: pointer;
      color: var(--color-text-dark-5);
      margin-left: auto;
    }
    .field-action:hover {
      color: var(--color-text-light-1);
    }
    .placements-list, .light-fields {
      padding: 0.5rem;
    }
    .placement-row {
      border-bottom: 1px solid var(--color-border-light-tertiary);
      padding-bottom: 0.35rem;
      margin-bottom: 0.35rem;
    }
    .placement-row:last-child {
      border-bottom: none;
      margin-bottom: 0;
    }
    .button.slim {
      font-size: var(--font-size-11);
      padding: 0.15rem 0.5rem;
    }

    /* Scenes tab */
    .scene-list {
      list-style: none;
      padding: 0;
      margin: 0;
      display: flex;
      flex-direction: column;
      gap: 0.35rem;
    }
    .scene-entry {
      display: flex;
      align-items: center;
      gap: 0.5rem;
      padding: 0.35rem 0.5rem;
      border: 1px solid var(--color-border-light-tertiary);
      border-radius: 3px;
    }
    .scene-name {
      flex: 1;
      font-weight: bold;
    }
    .scene-composition {
      font-size: var(--font-size-11);
      color: var(--color-text-dark-5);
    }
    .scene-actions {
      display: flex;
      gap: 0.5rem;
      align-items: center;
    }
    .scene-actions a {
      cursor: pointer;
      color: var(--color-text-dark-5);
    }
    .scene-actions a:hover {
      color: var(--color-text-light-1);
    }
  `;
  document.head.appendChild(style);
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** Find the thumbnail path for a vista (convention: thumb.webp in the first spritesheet's directory) */
function getVistaThumbnail(vista: VistaConfig): string | null {
  const defaultSheet = vista.spritesheets?.default;
  if (!defaultSheet || typeof defaultSheet !== "string") return null;
  const dir = defaultSheet.substring(0, defaultSheet.lastIndexOf("/"));
  return `${dir}/thumb.webp`;
}

/** Count how many Scene documents use a given vista ID */
function getScenesForVista(vistaId: string): any[] {
  return (game as any).scenes?.filter((s: any) => s.id === vistaId) ?? [];
}

// ── ApplicationV2 Class ─────────────────────────────────────────────────────

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

export class VistaEditorApp extends HandlebarsApplicationMixin(ApplicationV2) {
  #selectedVistaId: string | null = null;
  #selectedCompositionId: string | null = null;
  #mode: "browse" | "edit" = "browse";

  static DEFAULT_OPTIONS = {
    id: "mac-vista-editor",
    classes: ["mac-vista-editor"],
    window: {
      title: "Vista Scene Editor",
      icon: "fa-solid fa-mountain-sun",
      resizable: true,
      contentClasses: ["standard-form"],
    },
    position: {
      width: 820,
      height: 700,
    },
    tag: "form" as const,
    form: {
      submitOnChange: false,
      closeOnSubmit: false,
      handler: VistaEditorApp.#onSubmitForm,
    },
    actions: {
      selectVista: VistaEditorApp.#onSelectVista,
      createVista: VistaEditorApp.#onCreateVista,
      deleteVista: VistaEditorApp.#onDeleteVista,
      duplicateVista: VistaEditorApp.#onDuplicateVista,
      backToBrowse: VistaEditorApp.#onBackToBrowse,
      saveVista: VistaEditorApp.#onSaveVista,
      exportVista: VistaEditorApp.#onExportVista,
      importVista: VistaEditorApp.#onImportVista,
      addComposition: VistaEditorApp.#onAddComposition,
      selectComposition: VistaEditorApp.#onSelectComposition,
      deleteComposition: VistaEditorApp.#onDeleteComposition,
      duplicateComposition: VistaEditorApp.#onDuplicateComposition,
      addSprite: VistaEditorApp.#onAddSprite,
      removeSprite: VistaEditorApp.#onRemoveSprite,
      addPlacement: VistaEditorApp.#onAddPlacement,
      removePlacement: VistaEditorApp.#onRemovePlacement,
      addLight: VistaEditorApp.#onAddLight,
      removeLight: VistaEditorApp.#onRemoveLight,
      createScene: VistaEditorApp.#onCreateScene,
      deleteScene: VistaEditorApp.#onDeleteScene,
      activateScene: VistaEditorApp.#onActivateScene,
      openPlacementEditor: VistaEditorApp.#onOpenPlacementEditor,
      addSpritesheet: VistaEditorApp.#onAddSpritesheet,
      removeSpritesheet: VistaEditorApp.#onRemoveSpritesheet,
    },
  };

  static PARTS = {
    body: {
      id: "body",
      root: true,
      template: `modules/${MODULE_ID}/templates/vista-editor.hbs`,
    },
    tabs: {
      template: "templates/generic/tab-navigation.hbs",
    },
    browse: {
      id: "browse",
      template: `modules/${MODULE_ID}/templates/vista-editor-browse.hbs`,
      scrollable: [""],
    },
    general: {
      id: "general",
      template: `modules/${MODULE_ID}/templates/vista-editor-general.hbs`,
      scrollable: [""],
    },
    compositions: {
      id: "compositions",
      template: `modules/${MODULE_ID}/templates/vista-editor-compositions.hbs`,
      scrollable: [""],
    },
    scenes: {
      id: "scenes",
      template: `modules/${MODULE_ID}/templates/vista-editor-scenes.hbs`,
      scrollable: [""],
    },
  };

  static TABS = {
    primary: {
      tabs: [
        { id: "general", icon: "fa-solid fa-sliders", label: "General" },
        { id: "compositions", icon: "fa-solid fa-layer-group", label: "Compositions" },
        { id: "scenes", icon: "fa-solid fa-map", label: "Scenes" },
      ],
      initial: "general",
      labelPrefix: "",
    },
  };

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  _preFirstRender(context: any, options: any): Promise<void> {
    injectVistaEditorStyles();
    return super._preFirstRender(context, options);
  }

  _configureRenderParts(options: any): Record<string, any> {
    const parts: Record<string, any> = foundry.utils.deepClone((this.constructor as any).PARTS);
    if (this.#mode === "browse") {
      // In browse mode, only render body + browse parts
      delete parts.tabs;
      delete parts.general;
      delete parts.compositions;
      delete parts.scenes;
    } else {
      // In edit mode, don't render browse
      delete parts.browse;
    }
    return parts;
  }

  changeTab(tab: string, group: string, options?: any): void {
    console.error("Vista Editor changeTab", { tab, group, currentActive: this.tabGroups });
    super.changeTab(tab, group, options);
    const content = this.element.querySelector(".window-content");
    console.error("Vista Editor after changeTab", {
      activeTabs: content ? Array.from(content.querySelectorAll(".tab.active")).map((e: any) => e.dataset.tab) : [],
      hiddenTabs: content ? Array.from(content.querySelectorAll(".tab:not(.active)")).map((e: any) => e.dataset.tab) : [],
    });
  }

  async _prepareContext(options: any): Promise<Record<string, any>> {
    const context: Record<string, any> = {
      isBrowseMode: this.#mode === "browse",
    };

    if (this.#mode === "browse") {
      context.vistas = this.#prepareVistaList();
    } else {
      const vista = getVista(this.#selectedVistaId!);
      if (!vista) {
        this.#mode = "browse";
        context.isBrowseMode = true;
        context.vistas = this.#prepareVistaList();
        return context;
      }

      context.selectedVista = vista;
      context.tabs = this._prepareTabs("primary");

      // General tab data
      context.vista = vista;
      context.spritesheets = Object.entries(vista.spritesheets || {}).map(([key, path]) => ({
        key,
        path: Array.isArray(path) ? path.join(", ") : path,
      }));

      // Compositions tab data
      context.isCustom = isCustomVista(vista.id);
      context.compositions = Object.values(vista.compositions || {}).map((c: CompositionConfig) => ({
        ...c,
        active: c.id === this.#selectedCompositionId,
      }));

      const selectedComp = this.#selectedCompositionId
        ? vista.compositions?.[this.#selectedCompositionId]
        : null;

      if (selectedComp) {
        context.selectedComp = selectedComp;
        context.sprites = Object.entries(selectedComp.sprites || {}).map(([id, s]: [string, any]) => ({
          id,
          placementCount: s.placements?.length ?? 0,
          placements: (s.placements || []).map((p: PlacementConfig, idx: number) => ({
            ...p,
            scaleX: p.scaleX ?? 1,
            scaleY: p.scaleY ?? 1,
            alpha: p.alpha ?? 1,
            tint: p.tint ?? "#ffffff",
            sort: p.sort ?? 0,
          })),
        }));
        context.spriteCount = Object.keys(selectedComp.sprites || {}).length;
        context.lights = Object.entries(selectedComp.lights || {}).map(([id, l]: [string, any]) => ({
          id,
          ...l,
          color: l.color ?? "#ffffff",
          alpha: l.alpha ?? 1,
          animation: l.animation ?? { type: "", speed: 0, intensity: 0 },
        }));
        context.lightCount = Object.keys(selectedComp.lights || {}).length;
      }

      // Scenes tab data
      const scenes = getScenesForVista(vista.id);
      context.scenes = scenes.map((s: any) => {
        const compId = s.getFlag("ember", "composition") || Object.keys(vista.compositions || {})[0];
        return {
          id: s.id,
          name: s.name,
          compositionLabel: vista.compositions?.[compId]?.label ?? compId ?? "default",
          isActive: s.active,
        };
      });
      context.vistaLabel = vista.label;
      context.compositionChoices = Object.values(vista.compositions || {}).map((c: CompositionConfig) => ({
        id: c.id,
        label: c.label,
      }));
    }

    return context;
  }

  // ── Browse List ───────────────────────────────────────────────────────────

  #prepareVistaList(): any[] {
    const all = getAllVistas();
    return Object.values(all)
      .map((v: VistaConfig) => ({
        id: v.id,
        label: v.label,
        custom: !!v.custom,
        thumbnail: getVistaThumbnail(v),
        compositionCount: Object.keys(v.compositions || {}).length,
        sceneCount: getScenesForVista(v.id).length,
      }))
      .sort((a, b) => {
        // Custom first, then alphabetical
        if (a.custom !== b.custom) return a.custom ? -1 : 1;
        return a.label.localeCompare(b.label);
      });
  }

  // ── Action Handlers ───────────────────────────────────────────────────────

  static async #onSelectVista(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const vistaId = target.closest("[data-vista-id]")?.getAttribute("data-vista-id");
    if (!vistaId) return;
    this.#selectedVistaId = vistaId;
    this.#mode = "edit";
    // Auto-select first composition
    const vista = getVista(vistaId);
    this.#selectedCompositionId = vista ? Object.keys(vista.compositions || {})[0] ?? null : null;
    this.render();
  }

  static async #onBackToBrowse(this: VistaEditorApp): Promise<void> {
    this.#mode = "browse";
    this.#selectedVistaId = null;
    this.#selectedCompositionId = null;
    this.render();
  }

  static async #onCreateVista(this: VistaEditorApp): Promise<void> {
    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Create New Vista", icon: "fa-solid fa-plus" },
      position: { width: 400 },
      content: `
        <div class="form-group">
          <label>Vista ID</label>
          <input type="text" name="id" placeholder="myCustomVista" autofocus>
        </div>
        <div class="form-group">
          <label>Label</label>
          <input type="text" name="label" placeholder="Vista: My Custom Scene">
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Create",
        callback: (_e: Event, button: any) => {
          const fd = new FormDataExtended(button.form);
          return fd.object;
        },
      },
    });
    if (!result?.id || !result?.label) return;

    const config = createBlankVistaConfig(result.id as string, result.label as string);
    await saveCustomVista(config);
    this.#selectedVistaId = config.id;
    this.#mode = "edit";
    this.#selectedCompositionId = "default";
    this.render();
  }

  static async #onDeleteVista(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const vistaId = target.closest("[data-vista-id]")?.getAttribute("data-vista-id");
    if (!vistaId || !isCustomVista(vistaId)) return;
    const DialogV2 = foundry.applications.api.DialogV2;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Vista" },
      content: `<p>Are you sure you want to delete this custom vista configuration?</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    await deleteCustomVista(vistaId);
    if (this.#selectedVistaId === vistaId) {
      this.#mode = "browse";
      this.#selectedVistaId = null;
    }
    this.render();
  }

  static async #onDuplicateVista(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const vistaId = target.closest("[data-vista-id]")?.getAttribute("data-vista-id");
    if (!vistaId) return;
    const source = getVista(vistaId);
    if (!source) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Duplicate Vista", icon: "fa-solid fa-copy" },
      position: { width: 400 },
      content: `
        <div class="form-group">
          <label>New Vista ID</label>
          <input type="text" name="id" value="${source.id}Copy" autofocus>
        </div>
        <div class="form-group">
          <label>New Label</label>
          <input type="text" name="label" value="${source.label} (Copy)">
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Duplicate",
        callback: (_e: Event, button: any) => {
          const fd = new FormDataExtended(button.form);
          return fd.object;
        },
      },
    });
    if (!result?.id || !result?.label) return;

    const config = duplicateVistaConfig(source, result.id as string, result.label as string);
    await saveCustomVista(config);
    this.#selectedVistaId = config.id;
    this.#mode = "edit";
    this.#selectedCompositionId = Object.keys(config.compositions)[0] ?? null;
    this.render();
  }

  static async #onSaveVista(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista || !vista.custom) return;

    // Read form data from the DOM
    const formData = this.#readFormData();
    if (!formData) return;

    await saveCustomVista(formData);
    ui.notifications!.info(`Saved vista "${formData.label}".`);
    this.render();
  }

  #readFormData(): VistaConfig | null {
    const vista = getVista(this.#selectedVistaId!);
    if (!vista) return null;
    const clone = foundry.utils.deepClone(vista) as VistaConfig;

    // Read general fields from form elements if they exist
    const form = this.element;
    if (!form) return clone;

    const readVal = (name: string): string | undefined => {
      const el = form.querySelector(`[name="${name}"]`) as HTMLInputElement | null;
      return el?.value;
    };
    const readNum = (name: string): number | undefined => {
      const v = readVal(name);
      return v !== undefined && v !== "" ? Number(v) : undefined;
    };

    // Identity
    const label = readVal("label");
    if (label) clone.label = label;

    // Dimensions
    const cw = readNum("dimensions.canvas.width");
    const ch = readNum("dimensions.canvas.height");
    if (cw !== undefined) clone.dimensions.canvas.width = cw;
    if (ch !== undefined) clone.dimensions.canvas.height = ch;

    const vw = readNum("dimensions.view.width");
    const vh = readNum("dimensions.view.height");
    if (vw !== undefined) clone.dimensions.view.width = vw;
    if (vh !== undefined) clone.dimensions.view.height = vh;

    const ix = readNum("dimensions.initial.x");
    const iy = readNum("dimensions.initial.y");
    if (ix !== undefined || iy !== undefined) {
      clone.dimensions.initial = {
        x: ix ?? clone.dimensions.initial?.x ?? 0,
        y: iy ?? clone.dimensions.initial?.y ?? 0,
      };
    }

    // Token scaling
    clone.tokens.nearest.y = readNum("tokens.nearest.y") ?? clone.tokens.nearest.y;
    clone.tokens.nearest.elevation = readNum("tokens.nearest.elevation") ?? clone.tokens.nearest.elevation;
    clone.tokens.nearest.scale = readNum("tokens.nearest.scale") ?? clone.tokens.nearest.scale;
    clone.tokens.farthest.y = readNum("tokens.farthest.y") ?? clone.tokens.farthest.y;
    clone.tokens.farthest.elevation = readNum("tokens.farthest.elevation") ?? clone.tokens.farthest.elevation;
    clone.tokens.farthest.scale = readNum("tokens.farthest.scale") ?? clone.tokens.farthest.scale;
    const dp = readNum("tokens.distancePixels");
    if (dp !== undefined) clone.tokens.distancePixels = dp;

    // Spritesheets
    const ssEntries: Record<string, string> = {};
    form.querySelectorAll(".spritesheet-row").forEach((row: Element) => {
      const key = (row as HTMLElement).dataset.ssKey;
      const input = row.querySelector("input") as HTMLInputElement;
      if (key && input?.value) ssEntries[key] = input.value;
    });
    if (Object.keys(ssEntries).length > 0) clone.spritesheets = ssEntries;

    // Weather
    const we = readNum("weather.elevation");
    if (we !== undefined) clone.weather = { elevation: we };

    // Composition fields (if editing a composition)
    if (this.#selectedCompositionId && clone.compositions[this.#selectedCompositionId]) {
      const comp = clone.compositions[this.#selectedCompositionId];
      const compLabel = readVal("comp.label");
      if (compLabel) comp.label = compLabel;

      // Read sprite placements from form
      if (comp.sprites) {
        for (const [spriteId, sprite] of Object.entries(comp.sprites)) {
          for (let i = 0; i < sprite.placements.length; i++) {
            const p = sprite.placements[i];
            p.x = readNum(`sprite.${spriteId}.p.${i}.x`) ?? p.x;
            p.y = readNum(`sprite.${spriteId}.p.${i}.y`) ?? p.y;
            p.elevation = readNum(`sprite.${spriteId}.p.${i}.elevation`) ?? p.elevation;
            p.sort = readNum(`sprite.${spriteId}.p.${i}.sort`) ?? p.sort;
            p.scaleX = readNum(`sprite.${spriteId}.p.${i}.scaleX`) ?? p.scaleX;
            p.scaleY = readNum(`sprite.${spriteId}.p.${i}.scaleY`) ?? p.scaleY;
            p.alpha = readNum(`sprite.${spriteId}.p.${i}.alpha`) ?? p.alpha;
            const tint = readVal(`sprite.${spriteId}.p.${i}.tint`);
            if (tint) p.tint = tint;
          }
        }
      }

      // Read lights from form
      if (comp.lights) {
        for (const [lightId, light] of Object.entries(comp.lights)) {
          const l = light as LightConfig;
          l.x = readNum(`light.${lightId}.x`) ?? l.x;
          l.y = readNum(`light.${lightId}.y`) ?? l.y;
          l.elevation = readNum(`light.${lightId}.elevation`) ?? l.elevation;
          l.dim = readNum(`light.${lightId}.dim`) ?? l.dim;
          l.bright = readNum(`light.${lightId}.bright`) ?? l.bright;
          const color = readVal(`light.${lightId}.color`);
          if (color) l.color = color;
          l.alpha = readNum(`light.${lightId}.alpha`) ?? l.alpha;
          const animType = readVal(`light.${lightId}.animation.type`);
          const animSpeed = readNum(`light.${lightId}.animation.speed`);
          const animIntensity = readNum(`light.${lightId}.animation.intensity`);
          if (animType || animSpeed !== undefined || animIntensity !== undefined) {
            l.animation = {
              type: animType ?? l.animation?.type ?? "",
              speed: animSpeed ?? l.animation?.speed ?? 0,
              intensity: animIntensity ?? l.animation?.intensity ?? 0,
            };
          }
        }
      }
    }

    return clone;
  }

  static async #onExportVista(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const vistaId =
      target.closest("[data-vista-id]")?.getAttribute("data-vista-id") ?? this.#selectedVistaId;
    if (!vistaId) return;
    const vista = getVista(vistaId);
    if (!vista) return;
    const json = JSON.stringify(vista, null, 2);
    await (game as any).clipboard.copyPlainText(json);
    ui.notifications!.info(`Copied vista "${vista.label}" configuration to clipboard.`);
  }

  static async #onImportVista(this: VistaEditorApp): Promise<void> {
    const DialogV2 = foundry.applications.api.DialogV2;
    let jsonStr = await DialogV2.prompt({
      window: { title: "Import Vista Configuration", icon: "fa-solid fa-file-import" },
      position: { width: 500 },
      content: `<textarea name="json" rows="15" style="width:100%; font-family: var(--font-mono); font-size: var(--font-size-11);" placeholder="Paste vista JSON here...">{}</textarea>`,
      rejectClose: false,
      ok: {
        label: "Import",
        callback: (_e: Event, button: any) => button.form.json.value,
      },
    });
    if (!jsonStr) return;

    let config: VistaConfig;
    try {
      config = JSON.parse(jsonStr);
    } catch {
      ui.notifications!.error("Invalid JSON.");
      return;
    }
    if (!config.id || !config.label) {
      ui.notifications!.error("Vista config must have 'id' and 'label' fields.");
      return;
    }
    config.custom = true;
    config.managerClass = config.managerClass || "EmberVista";
    await saveCustomVista(config);
    this.#selectedVistaId = config.id;
    this.#mode = "edit";
    this.#selectedCompositionId = Object.keys(config.compositions || {})[0] ?? null;
    this.render();
    ui.notifications!.info(`Imported vista "${config.label}".`);
  }

  // ── Composition Actions ───────────────────────────────────────────────────

  static async #onSelectComposition(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const compId = target.closest("[data-comp-id]")?.getAttribute("data-comp-id");
    if (!compId) return;
    this.#selectedCompositionId = compId;
    this.render();
  }

  static async #onAddComposition(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Add Composition" },
      position: { width: 350 },
      content: `
        <div class="form-group">
          <label>ID</label>
          <input type="text" name="id" placeholder="compositionId" autofocus>
        </div>
        <div class="form-group">
          <label>Label</label>
          <input type="text" name="label" placeholder="Composition Label">
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Add",
        callback: (_e: Event, button: any) => {
          const fd = new FormDataExtended(button.form);
          return fd.object;
        },
      },
    });
    if (!result?.id || !result?.label) return;

    vista.compositions[result.id as string] = {
      id: result.id as string,
      label: result.label as string,
      sprites: {},
      lights: {},
    };
    await saveCustomVista(vista);
    this.#selectedCompositionId = result.id as string;
    this.render();
  }

  static async #onDeleteComposition(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const compId = target.closest("[data-comp-id]")?.getAttribute("data-comp-id");
    if (!compId || !this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    if (Object.keys(vista.compositions).length <= 1) {
      ui.notifications!.warn("Cannot delete the last composition.");
      return;
    }
    delete vista.compositions[compId];
    await saveCustomVista(vista);
    if (this.#selectedCompositionId === compId) {
      this.#selectedCompositionId = Object.keys(vista.compositions)[0] ?? null;
    }
    this.render();
  }

  static async #onDuplicateComposition(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const compId = target.closest("[data-comp-id]")?.getAttribute("data-comp-id");
    if (!compId || !this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom || !vista.compositions[compId]) return;

    const newId = `${compId}Copy`;
    const clone = foundry.utils.deepClone(vista.compositions[compId]) as CompositionConfig;
    clone.id = newId;
    clone.label = `${clone.label} (Copy)`;
    vista.compositions[newId] = clone;
    await saveCustomVista(vista);
    this.#selectedCompositionId = newId;
    this.render();
  }

  // ── Sprite/Light/Placement Actions ────────────────────────────────────────

  static async #onAddSprite(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    if (!comp) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Add Sprite" },
      position: { width: 350 },
      content: `
        <div class="form-group">
          <label>Sprite ID (frame name from spritesheet)</label>
          <input type="text" name="id" placeholder="SpriteName" autofocus>
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Add",
        callback: (_e: Event, button: any) => button.form.id?.value,
      },
    });
    if (!result) return;

    if (!comp.sprites) comp.sprites = {};
    comp.sprites[result] = {
      placements: [{ x: 0, y: 0, elevation: 0, scaleX: 1, scaleY: 1, alpha: 1, tint: "#ffffff" }],
    };
    await saveCustomVista(vista);
    this.render();
  }

  static async #onRemoveSprite(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const spriteId = target.closest("[data-sprite-id]")?.getAttribute("data-sprite-id");
    if (!spriteId || !this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    if (!comp?.sprites) return;
    delete comp.sprites[spriteId];
    await saveCustomVista(vista);
    this.render();
  }

  static async #onAddPlacement(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const spriteId = target.closest("[data-sprite-id]")?.getAttribute("data-sprite-id");
    if (!spriteId || !this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    const sprite = comp?.sprites?.[spriteId];
    if (!sprite) return;
    sprite.placements.push({ x: 0, y: 0, elevation: 0, scaleX: 1, scaleY: 1, alpha: 1, tint: "#ffffff" });
    await saveCustomVista(vista);
    this.render();
  }

  static async #onRemovePlacement(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const spriteId = target.closest("[data-sprite-id]")?.getAttribute("data-sprite-id");
    const placementIdx = target.closest("[data-placement-idx]")?.getAttribute("data-placement-idx");
    if (!spriteId || placementIdx === null || !this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    const sprite = comp?.sprites?.[spriteId];
    if (!sprite) return;
    sprite.placements.splice(Number(placementIdx), 1);
    await saveCustomVista(vista);
    this.render();
  }

  static async #onAddLight(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    if (!comp) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Add Light" },
      position: { width: 350 },
      content: `
        <div class="form-group">
          <label>Light ID</label>
          <input type="text" name="id" placeholder="torchLight1" autofocus>
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Add",
        callback: (_e: Event, button: any) => button.form.id?.value,
      },
    });
    if (!result) return;

    if (!comp.lights) comp.lights = {};
    (comp.lights as Record<string, LightConfig>)[result] = {
      x: 0,
      y: 0,
      elevation: 0,
      dim: 200,
      bright: 100,
      color: "#ffffff",
      alpha: 1,
    };
    await saveCustomVista(vista);
    this.render();
  }

  static async #onRemoveLight(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const lightId = target.closest("[data-light-id]")?.getAttribute("data-light-id");
    if (!lightId || !this.#selectedVistaId || !this.#selectedCompositionId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    const comp = vista.compositions[this.#selectedCompositionId];
    if (!comp?.lights) return;
    delete (comp.lights as Record<string, any>)[lightId];
    await saveCustomVista(vista);
    this.render();
  }

  // ── Spritesheet Actions ───────────────────────────────────────────────────

  static async #onAddSpritesheet(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const result = await DialogV2.prompt({
      window: { title: "Add Spritesheet" },
      position: { width: 400 },
      content: `
        <div class="form-group">
          <label>Key</label>
          <input type="text" name="key" placeholder="spritesheetKey" autofocus>
        </div>
        <div class="form-group">
          <label>Path</label>
          <input type="text" name="path" placeholder="modules/ember/assets/vistas/...">
        </div>
      `,
      rejectClose: false,
      ok: {
        label: "Add",
        callback: (_e: Event, button: any) => {
          const fd = new FormDataExtended(button.form);
          return fd.object;
        },
      },
    });
    if (!result?.key) return;
    vista.spritesheets[result.key as string] = (result.path as string) || "";
    await saveCustomVista(vista);
    this.render();
  }

  static async #onRemoveSpritesheet(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const key = target.closest("[data-ss-key]")?.getAttribute("data-ss-key");
    if (!key || !this.#selectedVistaId) return;
    if (key === "default") {
      ui.notifications!.warn("Cannot remove the default spritesheet.");
      return;
    }
    const vista = getVista(this.#selectedVistaId);
    if (!vista?.custom) return;
    delete vista.spritesheets[key];
    await saveCustomVista(vista);
    this.render();
  }

  // ── Scene Actions ─────────────────────────────────────────────────────────

  static async #onCreateScene(this: VistaEditorApp): Promise<void> {
    if (!this.#selectedVistaId) return;
    const vista = getVista(this.#selectedVistaId);
    if (!vista) return;

    const nameInput = this.element?.querySelector("#mac-new-scene-name") as HTMLInputElement;
    const compSelect = this.element?.querySelector("#mac-new-scene-composition") as HTMLSelectElement;

    const name = nameInput?.value || vista.label;
    const compId = compSelect?.value || Object.keys(vista.compositions)[0];

    // Check if a scene with this ID already exists
    const existing = (game as any).scenes.get(vista.id);
    if (existing) {
      ui.notifications!.warn(`A scene with ID "${vista.id}" already exists.`);
      return;
    }

    // Create the scene with the vista's ID
    const sceneData: any = {
      _id: vista.id,
      name,
      width: vista.dimensions.canvas.width,
      height: vista.dimensions.canvas.height,
      padding: 0,
      backgroundColor: "#000000",
      grid: { type: 0 },
      tokenVision: false,
      fogExploration: false,
      "flags.ember.composition": compId,
    };

    await Scene.create(sceneData);
    ui.notifications!.info(`Created scene "${name}" linked to vista "${vista.label}".`);
    this.render();
  }

  static async #onDeleteScene(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const sceneId = target.closest("[data-scene-id]")?.getAttribute("data-scene-id");
    if (!sceneId) return;
    const scene = (game as any).scenes.get(sceneId);
    if (!scene) return;

    const DialogV2 = foundry.applications.api.DialogV2;
    const confirmed = await DialogV2.confirm({
      window: { title: "Delete Scene" },
      content: `<p>Are you sure you want to delete scene "${scene.name}"?</p>`,
      rejectClose: false,
    });
    if (!confirmed) return;
    await scene.delete();
    this.render();
  }

  static async #onActivateScene(this: VistaEditorApp, event: Event, target: HTMLElement): Promise<void> {
    const sceneId = target.closest("[data-scene-id]")?.getAttribute("data-scene-id");
    if (!sceneId) return;
    const scene = (game as any).scenes.get(sceneId);
    if (!scene) return;
    await scene.activate();
  }

  static async #onOpenPlacementEditor(this: VistaEditorApp): Promise<void> {
    // The EmberVistaConfiguration is opened on the active scene's vista manager
    const ember = (globalThis as any).ember;
    const vistaConfig = ember?.scene;
    if (!vistaConfig) {
      ui.notifications!.warn("No active vista scene. Activate the scene first.");
      return;
    }
    // Trigger the Ember placement editor (EmberVistaConfiguration)
    // This is typically accessed via the scene HUD or a keybind
    const EmberVistaConfiguration = ember?.api?.applications?.EmberVistaConfiguration;
    if (EmberVistaConfiguration) {
      new EmberVistaConfiguration().render(true);
    } else {
      ui.notifications!.warn("EmberVistaConfiguration is not available.");
    }
  }

  // ── Form Submission ───────────────────────────────────────────────────────

  static async #onSubmitForm(this: VistaEditorApp, event: Event, form: HTMLFormElement, formData: any): Promise<void> {
    // Form submission is handled by explicit save buttons, not auto-submit
  }
}
