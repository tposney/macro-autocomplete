/**
 * Chris-Premades (CPR) completion overrides.
 *
 * The CPR module is distributed as minified code, so runtime introspection
 * produces parameter names like `e`, `t`, `a`.  This file registers a
 * `macro-autocomplete.ready` hook that patches the dynamically discovered
 * CPR completions with proper parameter names extracted from the CPR source map.
 */

interface CompletionEntry {
  type?: string;
  detail?: string;
  info?: string;
  children?: CompletionNode;
  staticChildren?: CompletionNode;
}

interface CompletionNode {
  [key: string]: CompletionEntry;
}

/**
 * Signature override: maps `chrisPremades.X.Y.Z` to a corrected `detail` string.
 * The detail format is `(params) => returnType`.
 * Only functions/methods with minified parameter names need entries here.
 */
const CPR_OVERRIDES: Record<string, Record<string, { detail: string; info?: string }>> = {
  // ── utils.actorUtils ──
  actorUtils: {
    getEffects:           { detail: "(actor, {includeItemEffects?}) => ActiveEffect[]", info: "Get all applicable effects on an actor" },
    addFavorites:         { detail: "(actor, entities, type?) => Promise<void>", info: "Add items/activities to favorites" },
    removeFavorites:      { detail: "(actor, entities, type?) => Promise<void>", info: "Remove items/activities from favorites" },
    getTokens:            { detail: "(actor) => Token[]", info: "Get all active tokens for an actor" },
    getFirstToken:        { detail: "(actor) => Token | undefined", info: "Get the first active token for an actor" },
    getLevelOrCR:         { detail: "(actor) => number", info: "Get character level or creature CR" },
    checkTrait:           { detail: "(actor, type, trait) => boolean", info: "Check if actor has a specific trait" },
    raceOrType:           { detail: "(actor) => string", info: "Get race or creature type (lowercase)" },
    typeOrRace:           { detail: "(actor) => string", info: "Get type or race via MidiQOL" },
    getAlignment:         { detail: "(actor) => string", info: "Get alignment (lowercase)" },
    getSize:              { detail: "(actor, returnString?) => number | string", info: "Get actor size" },
    hasUsedReaction:      { detail: "(actor) => boolean", info: "Check if actor has used their reaction" },
    setReactionUsed:      { detail: "(actor) => Promise<void>", info: "Mark reaction as used" },
    hasUsedBonusAction:   { detail: "(actor) => boolean", info: "Check if actor has used their bonus action" },
    hasSpellSlots:        { detail: "(actor, atLeast?) => boolean", info: "Check for available spell slots" },
    getCastableSpells:    { detail: "(actor) => Item[]", info: "Get list of castable spells" },
    polymorph:            { detail: "(origActor, newActor, options?, renderSheet?) => Promise<void>", info: "Polymorph an actor" },
    getEquippedArmor:     { detail: "(actor, types?) => Item | undefined", info: "Find equipped armor" },
    getEquippedShield:    { detail: "(actor) => Item | undefined", info: "Find equipped shield" },
    compareSize:          { detail: "(source, target, goal) => boolean", info: "Compare sizes with operators" },
    getBestAbility:       { detail: "(actor, abilities) => string", info: "Get ability with highest modifier" },
    getSidebarActor:      { detail: "(actor, {autoImport?}) => Promise<Actor>", info: "Get sidebar actor from compendium actor" },
    giveHeroicInspiration: { detail: "(actor) => Promise<void>", info: "Give heroic inspiration to actor" },
  },

  // ── utils.itemUtils ──
  itemUtils: {
    getSaveDC:              { detail: "(item) => number", info: "Get save DC from item" },
    createItems:            { detail: "(actor, updates, {favorite?, section?, parentEntity?, identifier?, castData?}) => Promise<Item[]>", info: "Create embedded items on an actor" },
    getItemDescription:     { detail: "(name) => string", info: "Fetch description from CPR journal" },
    isSpellFeature:         { detail: "(item) => boolean", info: "Check if item is a spell feature" },
    getConfig:              { detail: "(item, key) => any", info: "Get CPR config flag value" },
    setConfig:              { detail: "(item, key, value) => Promise<void>", info: "Set CPR config flag value" },
    getItemByIdentifier:    { detail: "(actor, identifier) => Item | undefined", info: "Find item by CPR identifier" },
    getAllItemsByIdentifier: { detail: "(actor, identifier) => Item[]", info: "Find all items matching identifier" },
    getVersion:             { detail: "(item) => string | number", info: "Get CPR version info" },
    isUpToDate:             { detail: "(item) => Promise<number>", info: "Check if item automation is current (-1/0/1/2)" },
    syntheticItem:          { detail: "(itemData, actor) => Promise<Item>", info: "Create a temporary item instance" },
    enchantItem:            { detail: "(item, effectData, options?) => Promise<ActiveEffect>", info: "Apply an enchantment effect to item" },
    getEquipmentState:      { detail: "(item) => number", info: "Check equipment/attunement status" },
    canUse:                 { detail: "(item) => boolean", info: "Check if item can be used" },
    cloneItem:              { detail: "(item, updates?, options?) => Item", info: "Clone an item with updates" },
    getActivity:            { detail: "(item, identifier) => Activity | undefined", info: "Get activity by identifier" },
  },

  // ── utils.effectUtils ──
  effectUtils: {
    getCastData:              { detail: "(effect) => object | undefined", info: "Get cast data from effect flags" },
    getCastLevel:             { detail: "(effect) => number | undefined", info: "Get cast level from effect" },
    getBaseLevel:             { detail: "(effect) => number | undefined", info: "Get base spell level from effect" },
    setCastData:              { detail: "(effect, data) => Promise<void>", info: "Set cast data on effect" },
    setCastLevel:             { detail: "(effect, level) => Promise<void>", info: "Set cast level on effect" },
    setBaseLevel:             { detail: "(effect, level) => Promise<void>", info: "Set base level on effect" },
    getSaveDC:                { detail: "(effect) => number | undefined", info: "Get save DC from effect" },
    setSaveDC:                { detail: "(effect, dc) => Promise<void>", info: "Set save DC on effect" },
    createEffect:             { detail: "(entity, effectData, options?, animationOptions?) => Promise<ActiveEffect[]>", info: "Create an effect on an entity" },
    createEffects:            { detail: "(entity, effectDataArray, effectOptionsArray?) => Promise<ActiveEffect[]>", info: "Create multiple effects" },
    addDependent:             { detail: "(entity, dependents, forceGM?) => Promise<void>", info: "Establish dependent relationships" },
    addMacro:                 { detail: "(effectData, type, macroList) => void", info: "Add macros to effect data" },
    getConcentrationEffect:   { detail: "(actor, item?) => ActiveEffect | undefined", info: "Get concentration effect" },
    getEffectByIdentifier:    { detail: "(actor, identifier) => ActiveEffect | undefined", info: "Find effect by CPR identifier" },
    getAllEffectsByIdentifier: { detail: "(actor, identifier) => ActiveEffect[]", info: "Find all effects matching identifier" },
    getEffectByStatusID:      { detail: "(actor, statusID) => ActiveEffect | undefined", info: "Find effect by status ID" },
    applyConditions:          { detail: "(actor, conditions, options?) => Promise<void>", info: "Apply conditions to actor" },
    getConditions:            { detail: "(effect) => string[]", info: "Extract conditions from effect" },
    toggleSidebarEffect:      { detail: "(documentId) => Promise<void>", info: "Toggle a sidebar effect" },
    getSidebarEffectData:     { detail: "(name) => object | undefined", info: "Get sidebar effect data by name" },
    getOriginItem:            { detail: "(effect) => Promise<Item | undefined>", info: "Get the item that originated the effect" },
  },

  // ── utils.workflowUtils ──
  workflowUtils: {
    bonusDamage:              { detail: "(workflow, formula, {ignoreCrit?, damageType?}) => Promise<void>", info: "Add bonus damage to workflow" },
    bonusAttack:              { detail: "(workflow, formula) => Promise<void>", info: "Add bonus to attack roll" },
    replaceDamage:            { detail: "(workflow, formula, {ignoreCrit?, damageType?}) => Promise<void>", info: "Replace workflow damage" },
    applyDamage:              { detail: "(tokens, value, damageType) => Promise<string[]>", info: "Apply damage to tokens" },
    completeActivityUse:      { detail: "(activity, config?, dialog?, message?) => Promise<Workflow>", info: "Execute an activity use" },
    completeItemUse:          { detail: "(item, config?, options?) => Promise<Workflow>", info: "Execute an item use" },
    syntheticActivityRoll:    { detail: "(activity, targets?, {options?, config?, atLevel?, consumeUsage?, consumeResources?, spellSlot?, dialog?, message?}) => Promise<Workflow>", info: "Synthetic activity roll against targets" },
    syntheticItemRoll:        { detail: "(item, targets?, {options?, config?, userId?, consumeUsage?, consumeResources?, spellSlot?}) => Promise<Workflow>", info: "Synthetic item roll against targets" },
    syntheticItemDataRoll:    { detail: "(itemData, actor, targets, {options?, config?, killAnim?}) => Promise<Workflow>", info: "Synthetic roll from raw item data" },
    syntheticActivityDataRoll: { detail: "(activityData, item, actor, targets, {options?, config?, atLevel?, consumeUsage?, consumeResources?}) => Promise<Workflow>", info: "Synthetic roll from raw activity data" },
    negateDamageItemDamage:   { detail: "(ditem) => void", info: "Zero out all damage on a damage item" },
    setDamageItemDamage:      { detail: "(ditem, damageAmount, adjustRaw?) => void", info: "Set specific damage amount" },
    modifyDamageAppliedFlat:  { detail: "(ditem, modificationAmount) => void", info: "Apply flat damage modification" },
    preventDeath:             { detail: "(ditem) => void", info: "Ensure target survives with 1 HP" },
    getDamageTypes:           { detail: "(damageRolls) => Set<string>", info: "Extract damage types from rolls" },
    getTotalDamageOfType:     { detail: "(damageDetail, actor, type) => number", info: "Get total damage of a type (respecting resistances)" },
    applyWorkflowDamage:      { detail: "(sourceToken, damageRoll, damageType, targets, {flavor?, itemCardId?, sourceItem?}) => DamageOnlyWorkflow", info: "Apply damage via DamageOnlyWorkflow" },
    updateTargets:            { detail: "(workflow, targets, {userId?}) => Promise<void>", info: "Update workflow targets" },
    removeTargets:            { detail: "(workflow, tokens, {userId?}) => Promise<void>", info: "Remove tokens from workflow targets" },
    swapAttackAbility:        { detail: "(workflow, ability?, {validTypes?, checkHigher?}) => Promise<void>", info: "Swap attack ability modifier" },
    getCastData:              { detail: "(workflow) => object", info: "Get cast data from workflow" },
    getCastLevel:             { detail: "(workflow) => number", info: "Get cast level from workflow" },
    isAttackType:             { detail: "(workflow, type?) => boolean", info: "Check workflow attack type (attack/meleeAttack/rangedAttack/etc.)" },
    getActionType:            { detail: "(workflow) => string", info: "Get action type from workflow activity" },
    handleInstantTemplate:    { detail: "(workflow) => Promise<void>", info: "Handle instant template cleanup" },
    specialItemUse:           { detail: "(item, targets, sourceFeature, {activity?, consumeUsage?, consumeResources?}) => Promise<void>", info: "Use an item with special activation override" },
    addEntityRemoval:         { detail: "(workflow, entities) => void", info: "Queue entities for removal after workflow" },
  },

  // ── utils.tokenUtils ──
  tokenUtils: {
    getDistance:             { detail: "(sourceToken, targetToken, {wallsBlock?, checkCover?}) => number", info: "Calculate distance between tokens" },
    checkCover:             { detail: "(sourceToken, targetToken, {item?, displayName?}) => number | string", info: "Determine cover bonus between tokens" },
    checkCollision:         { detail: "(token, ray) => boolean", info: "Test token collision with ray" },
    moveTokenAlongRay:      { detail: "(targetToken, ray, distance) => Promise<void>", info: "Move token along a ray direction" },
    pushToken:              { detail: "(sourceToken, targetToken, distance) => Promise<void>", info: "Push target away from source" },
    findNearby:             { detail: "(token, range, disposition, {includeIncapacitated?, includeToken?}) => Token[]", info: "Find nearby tokens by disposition (ally/enemy/neutral)" },
    checkIncapacitated:     { detail: "(token, logResult?) => boolean", info: "Check if token is incapacitated" },
    canSee:                 { detail: "(sourceToken, targetToken) => boolean", info: "Check line of sight" },
    canSense:               { detail: "(sourceToken, targetToken, senseModes?) => boolean", info: "Check sense detection" },
    getLightLevel:           { detail: "(token) => string", info: "Get light level at token (bright/dim/dark)" },
    attachToToken:          { detail: "(token, uuidsToAttach) => Promise<void>", info: "Attach entities to token" },
    detachFromToken:        { detail: "(token, uuidsToDetach) => Promise<void>", info: "Detach entities from token" },
    grappleHelper:          { detail: "(sourceToken, targetToken, item, options?) => Promise<void>", info: "Implement grapple mechanics" },
    isGrappledBy:           { detail: "(target, source) => boolean", info: "Check if target is grappled by source" },
    getMovementHitTokens:   { detail: "(startPoint, endPoint, radius, options?) => Token[]", info: "Get tokens intersected during movement" },
    checkForRoom:           { detail: "(token, gridSquares) => object | false", info: "Check available movement space" },
    findDirection:          { detail: "(room) => string", info: "Get diagonal direction from room check" },
    getLinearDistanceMoved: { detail: "(token) => number", info: "Calculate total linear distance traveled" },
    mountToken:             { detail: "(rider, target, options?) => Promise<void>", info: "Mount rider onto target via Rideable" },
  },

  // ── utils.dialogUtils ──
  dialogUtils: {
    buttonDialog:           { detail: "(title, content, buttons, {displayAsRows?, userId?}) => Promise<string | false>", info: "Dialog with labeled buttons" },
    numberDialog:           { detail: "(title, content, input?, {buttons?, userId?}) => Promise<number>", info: "Dialog with numeric input" },
    selectDialog:           { detail: "(title, content, input?, {buttons?, userId?}) => Promise<string>", info: "Dropdown select dialog" },
    selectTargetDialog:     { detail: "(title, content, targets, {type?, selectOptions?, skipDeadAndUnconscious?, coverToken?, reverseCover?, displayDistance?, maxAmount?, minAmount?, userId?, buttons?, maxes?}) => Promise<object>", info: "Token selection dialog" },
    selectDocumentDialog:   { detail: "(title, content, documents, options?) => Promise<Document | false>", info: "Single document selection dialog" },
    selectDocumentsDialog:  { detail: "(title, content, documents, options?) => Promise<Document[]>", info: "Multiple document selection dialog" },
    confirm:                { detail: "(title, content, options?) => Promise<boolean>", info: "Yes/no confirmation dialog" },
    selectHitDie:           { detail: "(actor, title?, content?, options?) => Promise<string>", info: "Hit dice selection dialog" },
    selectSpellSlot:        { detail: "(actor, title?, content?, options?) => Promise<number>", info: "Spell slot selection dialog" },
    selectDamageType:       { detail: "(damageTypes, title?, content?, options?) => Promise<string>", info: "Damage type selection dialog" },
    queuedConfirmDialog:    { detail: "(title, content, options?) => Promise<boolean>", info: "Queued confirmation dialog" },
    selectDie:              { detail: "(rolls, title?, content?, options?) => Promise<object>", info: "Select specific dice from roll results" },
  },

  // ── utils.genericUtils ──
  genericUtils: {
    sleep:                    { detail: "(ms) => Promise<void>", info: "Pause execution for ms milliseconds" },
    translate:                { detail: "(key) => string", info: "Localize a string key" },
    format:                   { detail: "(key, obj) => string", info: "Format a localized string with variables" },
    setProperty:              { detail: "(object, key, value) => boolean", info: "Set a nested property via dot notation" },
    getProperty:              { detail: "(object, key) => any", info: "Get a nested property via dot notation" },
    duplicate:                { detail: "(object) => object", info: "Shallow copy an object" },
    deepClone:                { detail: "(object) => object", info: "Deep clone an object" },
    mergeObject:              { detail: "(original, other, options?) => object", info: "Deep merge objects" },
    update:                   { detail: "(entity, updates?, options?, forceGM?) => Promise<Document>", info: "Update a document (handles permissions)" },
    remove:                   { detail: "(entity) => Promise<void>", info: "Delete an entity (handles permissions)" },
    setFlag:                  { detail: "(entity, scope, key, value) => Promise<void>", info: "Set a flag (handles permissions)" },
    unsetFlag:                { detail: "(entity, scope, key) => Promise<void>", info: "Remove a flag (handles permissions)" },
    getCPRSetting:            { detail: "(key) => any", info: "Get a cached CPR setting value" },
    setCPRSetting:            { detail: "(key, value) => Promise<void>", info: "Update a CPR setting" },
    isNewerVersion:           { detail: "(v1, v0) => boolean", info: "Compare version strings" },
    getIdentifier:            { detail: "(entity) => string | undefined", info: "Get CPR identifier from entity" },
    getRules:                 { detail: "(entity) => string", info: "Get rules version (legacy/modern)" },
    notify:                   { detail: "(message, type?, options?) => void", info: "Display a UI notification" },
    createEmbeddedDocuments:  { detail: "(parent, type, data) => Promise<Document[]>", info: "Create embedded documents via GM socket" },
    randomID:                 { detail: "(length?) => string", info: "Generate a random ID string" },
  },

  // ── utils.activityUtils ──
  activityUtils: {
    getActivityByIdentifier: { detail: "(item, identifier, {strict?}) => Activity | undefined", info: "Find activity by CPR identifier" },
    getIdentifier:           { detail: "(activity) => string | undefined", info: "Get CPR identifier for an activity" },
    setIdentifier:           { detail: "(activity, identifier) => Promise<void>", info: "Set CPR identifier on an activity" },
    withChangedDamage:       { detail: "(activity, formulaOrObj, types?, {specificIndex?}) => object", info: "Create activity data copy with altered damage" },
    duplicateActivity:       { detail: "(activity) => object", info: "Clone an activity with prepared data" },
    getConditions:           { detail: "(activity) => string[]", info: "Extract conditions from activity effects" },
    getMod:                  { detail: "(activity) => number", info: "Get ability modifier for activity" },
    getSaveDC:               { detail: "(activity) => number", info: "Calculate save DC for activity" },
    hasSave:                 { detail: "(activity) => boolean", info: "Check if activity involves a saving throw" },
    isSpellActivity:         { detail: "(activity) => boolean", info: "Check if activity is spell-based" },
    canUse:                  { detail: "(activity) => boolean", info: "Check if activity has sufficient resources" },
    isHidden:                { detail: "(activity) => boolean", info: "Check if activity should be hidden" },
  },

  // ── utils.combatUtils ──
  combatUtils: {
    currentTurn:              { detail: "() => string", info: "Get current combat round-turn as string" },
    inCombat:                 { detail: "() => boolean", info: "Check if combat is active" },
    combatStarted:            { detail: "() => boolean", info: "Check if combat has started" },
    perTurnCheck:             { detail: "(entity, name, ownTurnOnly, tokenId) => boolean", info: "Verify once-per-turn action" },
    setTurnCheck:             { detail: "(entity, name, reset?) => Promise<void>", info: "Record/clear current turn in flags" },
    getCurrentCombatantToken: { detail: "() => Token | undefined", info: "Get token of current combatant" },
    isOwnTurn:                { detail: "(token) => boolean", info: "Check if it's the token's turn" },
  },

  // ── utils.rollUtils ──
  rollUtils: {
    getCriticalFormula:   { detail: "(formula, rollData) => Promise<string>", info: "Generate critical hit damage formula" },
    contestedRoll:        { detail: "({sourceToken, targetToken, sourceRollType, targetRollType, sourceAbilities, targetAbilities, sourceRollOptions?, targetRollOptions?}) => Promise<number>", info: "Execute contested roll between tokens" },
    requestRoll:          { detail: "(token, request, ability, options?) => Promise<object>", info: "Send roll request via socket" },
    getChangedDamageRoll: { detail: "(origRoll, newType) => Promise<Roll>", info: "Convert damage roll to different type" },
    rollDice:             { detail: "(formula, {entity?, chatMessage?, flavor?, mode?, options?}) => Promise<Roll>", info: "Roll generic dice" },
    rollDiceSync:         { detail: "(formula, {entity?, options?}) => Roll", info: "Synchronous dice roll" },
    damageRoll:           { detail: "(formula, entity, options?, evaluateOptions?) => Promise<DamageRoll>", info: "Create and evaluate a damage roll" },
    addToRoll:            { detail: "(roll, formula, {rollData?}) => Promise<Roll>", info: "Append formula result to a roll" },
    remoteRoll:           { detail: "(roll, userId) => Promise<Roll>", info: "Execute roll on remote client" },
    hasDuplicateDie:      { detail: "(rolls) => boolean", info: "Check for duplicate die results" },
    replaceD20:           { detail: "(roll, number) => Roll", info: "Replace d20 result with specific number" },
    makeCritical:         { detail: "(roll) => Roll", info: "Mark roll as critical success" },
    updateDieResult:      { detail: "(roll, termIndex, resultIndex, newValue) => Roll", info: "Modify a single die result" },
  },

  // ── utils.socketUtils ──
  socketUtils: {
    gmID:             { detail: "() => string", info: "Get current GM's user ID" },
    isTheGM:          { detail: "() => boolean", info: "Check if current user is the GM" },
    hasPermission:    { detail: "(entity, userId) => boolean", info: "Check owner-level permissions" },
    firstOwner:       { detail: "(document, useId?) => User | string", info: "Get first active owner of a document" },
    remoteRollItem:   { detail: "(item, config, options, userId) => Promise<Workflow>", info: "Execute item use locally or remotely" },
  },

  // ── utils.animationUtils ──
  animationUtils: {
    sequencerCheck:     { detail: "() => boolean", info: "Check if Sequencer module is active (v3.6.0+)" },
    jb2aCheck:          { detail: "() => string | false", info: "Check which JB2A variant is active (patreon/free/false)" },
    aseCheck:           { detail: "() => boolean", info: "Check if animated-spell-effects-cartoon is active" },
    simpleAttack:       { detail: "(sourceToken, targetToken, animation, {sound?, missed?}) => void", info: "Create visual attack animation sequence" },
    colorMatrix:        { detail: "(animation, color) => object", info: "Get ColorMatrix for Sequencer effects" },
    preloadAnimations:  { detail: "(animations, showProgressBar?) => Promise<void>", info: "Preload animations for all clients" },
  },

  // ── utils.compendiumUtils ──
  compendiumUtils: {
    getCPRAutomation:       { detail: "(item, {identifier?, rules?, type?}) => Promise<object | undefined>", info: "Get CPR automation for an item" },
    getItemFromCompendium:  { detail: "(key, name, options?) => Promise<Item | undefined>", info: "Fetch item from compendium pack" },
    getActorFromCompendium: { detail: "(key, name, options?) => Promise<Actor | undefined>", info: "Fetch actor from compendium pack" },
    getAllAutomations:      { detail: "(item, options?) => Promise<object[]>", info: "Get all available automations for an item" },
    getPreferredAutomation: { detail: "(item, options?) => Promise<object | undefined>", info: "Get highest-priority automation" },
  },

  // ── utils.regionUtils ──
  regionUtils: {
    createRegions:          { detail: "(regionDatas, scene, {parentEntity?, excludeGPSRegionHandling?, origin?}) => Promise<Region[]>", info: "Create regions in a scene" },
    templateToRegionShape:  { detail: "(template, {hole?}) => object", info: "Convert template to polygon region shape" },
    getCastData:            { detail: "(region) => object | undefined", info: "Get cast data from region" },
    getCastLevel:           { detail: "(region) => number | undefined", info: "Get cast level from region" },
    getBaseLevel:           { detail: "(region) => number | undefined", info: "Get base level from region" },
    setCastData:            { detail: "(region, data) => Promise<void>", info: "Set cast data on region" },
    setCastLevel:           { detail: "(region, level) => Promise<void>", info: "Set cast level on region" },
    setBaseLevel:           { detail: "(region, level) => Promise<void>", info: "Set base level on region" },
    getSaveDC:              { detail: "(region) => number | undefined", info: "Get save DC from region" },
    setSaveDC:              { detail: "(region, dc) => Promise<void>", info: "Set save DC on region" },
    rayIntersectsRegion:    { detail: "(region, ray) => boolean", info: "Check if ray intersects region" },
    getIntersections:       { detail: "(region, A, B, boolOnly?) => object[]", info: "Find line-region intersections" },
    getOrigin:              { detail: "(region) => Promise<Document | undefined>", info: "Get source entity that created region" },
  },

  // ── utils.templateUtils ──
  templateUtils: {
    getTokensInShape:     { detail: "(shape, scene, offset?) => Set<Token>", info: "Get tokens intersecting a shape" },
    getTokensInTemplate:  { detail: "(template) => Set<Token>", info: "Get tokens within template area" },
    getTemplatesInToken:  { detail: "(token) => Set<MeasuredTemplate>", info: "Find templates overlapping token" },
    findGrids:            { detail: "(A, B, template) => Set<object>", info: "Find grid squares along ray in template" },
    placeTemplate:        { detail: "(templateData, returnTokens?) => Promise<MeasuredTemplate | Set<Token>>", info: "Create/preview a template" },
    getCastData:          { detail: "(template) => object | undefined", info: "Get cast data from template" },
    getCastLevel:         { detail: "(template) => number | undefined", info: "Get cast level from template" },
    getBaseLevel:         { detail: "(template) => number | undefined", info: "Get base level from template" },
    setCastData:          { detail: "(template, data) => Promise<void>", info: "Set cast data on template" },
    setCastLevel:         { detail: "(template, level) => Promise<void>", info: "Set cast level on template" },
    setBaseLevel:         { detail: "(template, level) => Promise<void>", info: "Set base level on template" },
    getSaveDC:            { detail: "(template) => number | undefined", info: "Get save DC from template" },
    setSaveDC:            { detail: "(template, dc) => Promise<void>", info: "Set save DC on template" },
    getName:              { detail: "(template) => string", info: "Get template name" },
    setName:              { detail: "(template, name) => Promise<void>", info: "Set template name" },
    getSourceActor:       { detail: "(template) => Actor | undefined", info: "Get actor who cast the template" },
    overlap:              { detail: "(template1, template2) => boolean", info: "Check if two templates intersect" },
    attachToTemplate:     { detail: "(template, uuidsToAttach) => Promise<void>", info: "Attach entities to template" },
    rayIntersectsTemplate: { detail: "(templateDoc, ray) => boolean", info: "Check if ray intersects template" },
    getIntersections:     { detail: "(templateObj, A, B, boolOnly?) => object[]", info: "Calculate line-template intersections" },
  },
};

/** Top-level CPR classes/statics (not under utils) */
const CPR_CLASS_OVERRIDES: Record<string, Record<string, { detail: string; info?: string }>> = {
  Summons: {
    spawn:          { detail: "(sourceActors, updates, originItem, summonerToken, options?) => Promise<Token[]>", info: "Spawn summoned creature(s)" },
    dismiss:        { detail: "(summons) => Promise<void>", info: "Remove summoned creatures" },
    dismissIfDead:  { detail: "(summons) => Promise<void>", info: "Conditionally remove dead summons" },
    getSummonItem:  { detail: "() => object", info: "Get and modify summon ability data" },
  },
  Crosshairs: {
    showCrosshairs:           { detail: "(config?, callbacks?) => Promise<object>", info: "Display interactive crosshairs" },
    collectPlaceables:        { detail: "(crosshairsData, types?, containedFilter?) => object[]", info: "Get placeables within crosshairs radius" },
    getCrosshair:             { detail: "(tag) => Crosshairs | undefined", info: "Get active crosshairs by tag" },
    getSnappedPosition:       { detail: "({x, y}, resolution?) => {x, y}", info: "Snap coordinates to grid" },
    defaultCrosshairsConfig:  { detail: "() => object", info: "Get default crosshairs configuration" },
  },
  Teleport: {
    group: { detail: "(tokens, controllingToken, options?) => Promise<void>", info: "Teleport multiple tokens as a group" },
    target: { detail: "(target, controllingToken, options?) => Promise<void>", info: "Teleport to a specific target" },
  },
  DialogApp: {
    dialog: { detail: "(title, content, inputs, buttons?, options?) => Promise<object>", info: "Create and display a CPR dialog" },
  },
};

/**
 * Apply proper parameter names to a CPR completion node.
 * Walks `node.children.utils.children.<utilGroup>.children.<func>` and
 * replaces the `detail` field with the override.
 */
function applyCPROverrides(cprNode: CompletionEntry): void {
  const utils = cprNode.children?.utils;
  if (utils?.children) {
    for (const [groupName, overrides] of Object.entries(CPR_OVERRIDES)) {
      const group = utils.children[groupName];
      if (!group?.children) continue;
      for (const [funcName, override] of Object.entries(overrides)) {
        const entry = group.children[funcName];
        if (entry) {
          entry.detail = override.detail;
          if (override.info) entry.info = override.info;
        }
      }
    }
  }

  // Top-level classes (Summons, Crosshairs, Teleport, DialogApp)
  if (cprNode.children) {
    for (const [className, overrides] of Object.entries(CPR_CLASS_OVERRIDES)) {
      const classNode = cprNode.children[className];
      // Methods may be in children or staticChildren
      const targets = [classNode?.children, classNode?.staticChildren];
      for (const target of targets) {
        if (!target) continue;
        for (const [funcName, override] of Object.entries(overrides)) {
          const entry = target[funcName];
          if (entry) {
            entry.detail = override.detail;
            if (override.info) entry.info = override.info;
          }
        }
      }
    }
  }
}

// Hook into macro-autocomplete after all completions are built — only if chris-premades is active
Hooks.once("init", () => {
  if (!game.modules?.get("chris-premades")?.active) return;
  (Hooks as any).once("macro-autocomplete.ready", (api: any) => {
    const cprNode = api.tree.chrisPremades;
    if (!cprNode) return;
    applyCPROverrides(cprNode);
    console.log("macro-autocomplete | Applied CPR parameter name overrides");
  });
});
