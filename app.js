const STORAGE_KEY = "boardgame_tracker_v2";

let state = load();
let selectedTokenId = null;
let reachable = [];
let attackCells = [];
let pendingAbility = null;
let pendingSpawn = null;
let pathPreview = [];
let editMode = false;
let suppressReplacePrompt = false;
let busy = false;
let undoStack = [];
let buildMode = null;

/* ---- Partie LAN (WebRTC 1v1) : hôte = Équipe A, client = Équipe B ---- */
let lanMode = false;
let lanRole = null;
let rtcPc = null;
let rtcDc = null;
let lanConnected = false;
let lanSeq = 0;
let lanApplying = false;

/* ---- Partie en ligne (matchmaking + relais WebSocket) ---- */
let onlineMode = false;
let onlineWs = null;
let onlineSetupPhase = false;
let onlineRemoteDeck = null;
let onlineRemoteStarters = null;
let onlineLocalStarters = null;
let onlineStartersRequested = false;

let fx = emptyFx();

function emptyFx() {
  return { hits: [], deaths: [], heals: [], abilities: [], casters: [], entered: [], cellFx: [] };
}

function fxHit(id, dmg) { fx.hits.push({ id, dmg }); }
function fxDeath(id) { fx.deaths.push(id); }
function fxHeal(id, amount) { fx.heals.push({ id, amount: amount || 1 }); }
const SE7EN_DEBUG_7 = false;
const MOMS_MAX_TRANSFUSION = 8;

function cAtkOf(charId) {
  const c = charById(charId);
  return c ? c.atk : 0;
}

function fxCaster(id) { fx.casters.push(id); }
function fxAbility(id) { fx.abilities.push(id); fxCaster(id); }
function fxEnter(id) { fx.entered.push(id); }
function fxCell(x, y, kind) { fx.cellFx.push({ x, y, kind }); }

function projFromTo(fromX, fromY, toX, toY, cls, then, opts = {}) {
  const board = document.getElementById("board");
  const el = document.createElement("div");
  el.className = "proj " + cls + (opts.slow ? " proj-slow" : "") + (opts.leadIn ? " proj-leadin" : "");
  el.style.setProperty("--from-l", ((fromX + 0.5) / GAME.map.cols) * 100 + "%");
  el.style.setProperty("--from-t", ((fromY + 0.5) / GAME.map.rows) * 100 + "%");
  el.style.setProperty("--dst-l", ((toX + 0.5) / GAME.map.cols) * 100 + "%");
  el.style.setProperty("--dst-t", ((toY + 0.5) / GAME.map.rows) * 100 + "%");
  if (opts.leadIn) {
    el.style.setProperty("--lead-l", opts.leadIn[0] + "%");
    el.style.setProperty("--lead-t", opts.leadIn[1] + "%");
  }
  const ang = (Math.atan2(toY - fromY, toX - fromX) * 180) / Math.PI;
  el.style.setProperty("--rot", ang + "deg");
  board.appendChild(el);
  setTimeout(() => {
    el.remove();
    if (then) then();
  }, opts.duration || 470);
}

/* Point de départ prolongé derrière la cible : le projectile surgit de loin. */
function leadInPoint(fromX, fromY, toX, toY, extraCells) {
  const dx = toX - fromX;
  const dy = toY - fromY;
  const dist = Math.max(1, Math.hypot(dx, dy));
  const sx = fromX - (dx / dist) * extraCells;
  const sy = fromY - (dy / dist) * extraCells;
  return [
    ((sx + 0.5) / GAME.map.cols) * 100,
    ((sy + 0.5) / GAME.map.rows) * 100
  ];
}

const CUSTOM_MAP_KEY = "boardgame_map_custom_v1";
const FIXED_MAPS_KEY = "boardgame_map_fixed_v1";
const LEGACY_FIXED_FIRST_KEY = "boardgame_map_fixed_map1_v1";

function loadFixedMaps() {
  try {
    return JSON.parse(localStorage.getItem(FIXED_MAPS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function migrateLegacyFixed() {
  try {
    const legacy = JSON.parse(localStorage.getItem(LEGACY_FIXED_FIRST_KEY));
    if (legacy && GAME.maps.map1) {
      const all = loadFixedMaps();
      if (!all.map1) all.map1 = legacy;
      localStorage.setItem(FIXED_MAPS_KEY, JSON.stringify(all));
      localStorage.removeItem(LEGACY_FIXED_FIRST_KEY);
    }
  } catch (e) {}
}

function applyFixedMaps() {
  migrateLegacyFixed();
  const all = loadFixedMaps();
  Object.keys(all).forEach((mapId) => {
    const fixed = all[mapId];
    const m = GAME.maps[mapId];
    if (!m || !fixed) return;
    if (Array.isArray(fixed.edges)) m.edgesWalls = fixed.edges.slice();
    if (Array.isArray(fixed.fire)) m.fireCells = fixed.fire.map((p) => p.slice());
    if (Array.isArray(fixed.heal)) m.healCells = fixed.heal.map((p) => p.slice());
    if (Array.isArray(fixed.speed)) m.speedCells = fixed.speed.map((p) => p.slice());
    if (Array.isArray(fixed.void)) m.voidCells = fixed.void.map((p) => p.slice());
    if (fixed.name) m.name = fixed.name;
    if (GAME.activeMap === mapId) {
      GAME.edgeSet = new Set(m.edgesWalls);
      GAME.fireCells = m.fireCells;
    }
  });
}

function saveFixedMapFor(mapId, name) {
  const m = GAME.maps[mapId];
  if (!m || !name) return;
  const all = loadFixedMaps();
  all[mapId] = {
    name,
    edges: m.edgesWalls.slice(),
    fire: m.fireCells.map((p) => p.slice()),
    heal: (m.healCells || []).map((p) => p.slice()),
    speed: (m.speedCells || []).map((p) => p.slice()),
    void: (m.voidCells || []).map((p) => p.slice())
  };
  localStorage.setItem(FIXED_MAPS_KEY, JSON.stringify(all));
}

function loadCustomMaps() {
  try {
    return JSON.parse(localStorage.getItem(CUSTOM_MAP_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function applyCustomMapFor(name) {
  const m = GAME.maps[name];
  if (!m) return;
  const custom = loadCustomMaps()[name];
  if (custom && Array.isArray(custom.edges)) {
    m.edgesWalls = custom.edges.slice();
    m.fireCells = (custom.fire || []).map((p) => p.slice());
    m.healCells = (custom.heal || []).map((p) => p.slice());
    m.speedCells = (custom.speed || []).map((p) => p.slice());
    m.voidCells = (custom.void || []).map((p) => p.slice());
  }
  if (GAME.activeMap === name) {
    GAME.edgeSet = new Set(m.edgesWalls);
    GAME.fireCells = m.fireCells;
  }
}

function saveCustomMapFor(name) {
  const m = GAME.maps[name];
  if (!m) return;
  const all = loadCustomMaps();
  all[name] = {
    edges: m.edgesWalls.slice(),
    fire: m.fireCells.map((p) => p.slice()),
    heal: (m.healCells || []).map((p) => p.slice()),
    speed: (m.speedCells || []).map((p) => p.slice()),
    void: (m.voidCells || []).map((p) => p.slice())
  };
  localStorage.setItem(CUSTOM_MAP_KEY, JSON.stringify(all));
}

const NEW_MAPS_KEY = "boardgame_map_new_v1";

function loadNewMaps() {
  try {
    return JSON.parse(localStorage.getItem(NEW_MAPS_KEY)) || {};
  } catch (e) {
    return {};
  }
}

function isUserMap(id) {
  return id ? Object.prototype.hasOwnProperty.call(loadNewMaps(), id) : false;
}

function makeDefaultZones() {
  return {
    A: [[0,3],[1,3],[2,3],[0,4],[1,4],[2,4],[0,5],[1,5],[2,5],[0,6],[1,6],[2,6]],
    B: [[14,3],[13,3],[12,3],[14,4],[13,4],[12,4],[14,5],[13,5],[12,5],[14,6],[13,6],[12,6]]
  };
}

function createBlankMap(name) {
  const id = "user-" + Date.now();
  const cols = 15;
  const rows = 10;
  const tiles = [];
  for (let y = 0; y < rows; y++) tiles.push(new Array(cols).fill(0));
  return {
    id,
    name: name || "Nouveau terrain",
    cols,
    rows,
    tiles,
    edgesWalls: [],
    fireCells: [],
    healCells: [],
    speedCells: [],
    voidCells: [],
    startZones: makeDefaultZones(),
    objectives: {
      A: { x: 2, y: 4, hp: 20 },
      B: { x: 12, y: 4, hp: 20 }
    }
  };
}

function saveUserMap(id) {
  const m = GAME.maps[id];
  if (!m || !isUserMap(id)) return false;
  const store = loadNewMaps();
  store[id] = {
    id,
    name: m.name,
    cols: m.cols,
    rows: m.rows,
    tiles: (m.tiles || []).map((r) => r.slice()),
    edgesWalls: (m.edgesWalls || []).slice(),
    fireCells: (m.fireCells || []).map((p) => p.slice()),
    healCells: (m.healCells || []).map((p) => p.slice()),
    speedCells: (m.speedCells || []).map((p) => p.slice()),
    voidCells: (m.voidCells || []).map((p) => p.slice()),
    startZones: m.startZones,
    objectives: m.objectives
  };
  localStorage.setItem(NEW_MAPS_KEY, JSON.stringify(store));
  return true;
}

function deleteUserMap(id) {
  const store = loadNewMaps();
  if (!store[id]) return false;
  delete store[id];
  localStorage.setItem(NEW_MAPS_KEY, JSON.stringify(store));
  return true;
}

function loadUserMapsIntoGame() {
  const store = loadNewMaps();
  Object.keys(store).forEach((id) => {
    GAME.maps[id] = store[id];
  });
}

function persistActiveMapEdits() {
  if (isUserMap(GAME.activeMap)) saveUserMap(GAME.activeMap);
  else saveCustomMapFor(GAME.activeMap);
}

applyFixedMaps();
applyCustomMapFor(GAME.activeMap);
loadUserMapsIntoGame();

function defaultState() {
  return {
    mapName: GAME.activeMap,
    decks: { A: [], B: [] },
    starters: { A: [], B: [] },
    reserve: { A: [], B: [] },
    tokens: [],
    walls: [],
    arkWalls: [],
    guardZones: [],
    objectives: {
      A: GAME.objectives.A.hp,
      B: GAME.objectives.B.hp
    },
    objectivePos: { A: null, B: null },
    phase: "placement",
    placement: { A: false, B: false },
    placingPlayer: "A",
    placingStage: "objective",
    placingQueue: { A: [], B: [] },
    turn: "A",
    turnCount: 1,
    shrinkStep: 0,
    log: [],
    healingBlocked: false,
    rapidoBuff: null,
    bettaCharges: 2,
    scrabTriggered: {},
    specialCells: [],
    swapCd: { A: 0, B: 0 },
    mode: "classic",
    winner: null
  };
}

/* Mode Rampage : 3 champions contre 3, sans réserve ni objectif. La partie se
   gagne en éliminant tous les champions adverses ; à chaque élimination, les
   alliés du champion tombé remontent à 75 % de leurs PV (arrondi au supérieur). */
function isRampage() {
  return state.mode === "rampage";
}

function rampageFloor(hp) {
  return Math.ceil(hp * 0.75);
}

function save() {
  if (lanMode && lanRole === "client") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (e) {}
  if (lanMode && lanRole === "host" && lanConnected && !lanApplying) lanBroadcast();
}

function pushUndo() {
  if (busy) return;
  undoStack.push(JSON.stringify(state));
  if (undoStack.length > 50) undoStack.shift();
}

function undoLast() {
  if (lanMode && lanRole === "client") return;
  if (busy) return;
  if (!undoStack.length) {
    alert("Rien à annuler.");
    return;
  }
  const snap = JSON.parse(undoStack.pop());
  Object.keys(state).forEach((k) => delete state[k]);
  Object.assign(state, snap);
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
    pendingAbility = null;
    pendingSpawn = null;
    busy = false;
  fx = emptyFx();
  save();
  log("↩︎ Action annulée.");
  renderBoard();
}

function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.decks) {
        if (parsed.mapName && GAME.maps[parsed.mapName]) setActiveMap(parsed.mapName);
        parsed.walls = parsed.walls || [];
        parsed.arkWalls = (parsed.arkWalls || []).map((w) => (typeof w === "string" ? { key: w, hp: 1 } : w));
        parsed.guardZones = parsed.guardZones || [];
        parsed.objectives = parsed.objectives || {
          A: GAME.objectives.A.hp,
          B: GAME.objectives.B.hp
        };
        parsed.objectivePos = parsed.objectivePos || { A: null, B: null };
        parsed.phase = parsed.phase || (parsed.tokens && parsed.tokens.length ? "playing" : "placement");
        parsed.placement = parsed.placement || { A: false, B: false };
        parsed.placingPlayer = parsed.placingPlayer || "A";
        parsed.placingStage = parsed.placingStage || "objective";
        parsed.placingQueue = parsed.placingQueue || { A: [], B: [] };
        parsed.turnCount = parsed.turnCount || 1;
        parsed.shrinkStep = parsed.shrinkStep || 0;
        if ((parsed.tokens || []).some((t) => t.player === "A")) parsed.placement.A = true;
        if ((parsed.tokens || []).some((t) => t.player === "B")) parsed.placement.B = true;
        parsed.rapidoBuff = parsed.rapidoBuff || null;
        parsed.bettaCharges = typeof parsed.bettaCharges === "number"
          ? parsed.bettaCharges
          : Math.max(0, 2 - (parsed.bettaTagUses || 0));
        parsed.scrabTriggered = parsed.scrabTriggered || {};
        parsed.specialCells = parsed.specialCells || [];
        parsed.swapCd = parsed.swapCd || { A: 0, B: 0 };
        parsed.mode = parsed.mode === "rampage" ? "rampage" : "classic";
        parsed.winner = parsed.winner || null;
        parsed.tokens.forEach((t) => {
          t.cd = t.cd || 0;
          t.hasMoved = t.hasMoved || false;
          t.hasAttacked = t.hasAttacked || false;
          t.abilityUsed = t.abilityUsed || false;
          t.buffs = t.buffs || { abyss: false, braut: false };
          t.scrabTaken = t.scrabTaken || 0;
          t.poison = t.poison || 0;
          t.jayAura = t.jayAura || false;
          t.jayAuraTurns = t.jayAuraTurns || 0;
          t.rainActive = t.rainActive || false;
          t.healCellUsed = t.healCellUsed || false;
          t.speedTurnBoost = t.speedTurnBoost || false;
          t.speedUsed = t.speedUsed || false;
          if ((t.bettaRegen || 0) > 0 && !(t.bettaRoundsLeft > 0)) t.bettaRoundsLeft = 8;
          if (t.movLeft == null || t.movLeft < 0) t.movLeft = null;
        });
        return parsed;
      }
    }
  } catch (e) {}
  return defaultState();
}

const charById = (id) => GAME.characters.find((c) => c.id === id);
const tokenById = (id) => state.tokens.find((t) => t.id === id);

function roleLabel(role) {
  const labels = {
    "colosse": "Colosse",
    "assassin": "Assassin",
    "soutien": "Soutien",
    "expert": "Expert",
    "mage": "Mage",
    "guerrier": "Guerrier",
    "rayageur": "Ravageur",
    "ravageur": "Ravageur"
  };
  return labels[role] || role;
}

/* ---------- Modes de partie / composition des équipes ---------- */

const CLASS_ORDER = ["assassin", "colosse", "expert", "ravageur", "soutien"];

function charRole(id) {
  const c = charById(id);
  return c ? c.role : "";
}

function teamHasRole(player, role) {
  return state.decks[player].some((id) => charRole(id) === role);
}

/* Taille d'équipe : 3 champions (3 classes distinctes) en Rampage, sinon
   une équipe de 5 (une championne par classe). */
function teamSizeTarget() {
  return isRampage() ? 3 : CLASS_ORDER.length;
}

function teamComplete(player) {
  const deck = state.decks[player] || [];
  if (deck.length < teamSizeTarget()) return false;
  if (isRampage()) {
    const roles = new Set(deck.map((id) => charRole(id)));
    return roles.size === deck.length;
  }
  return CLASS_ORDER.every((r) => teamHasRole(player, r));
}

/* Équipe aléatoire de `size` champions de classes distinctes (au moins 3
   classes disponibles par champion, donc toujours satisfiable). */
function randomTeam(size, exclude) {
  const used = new Set(exclude || []);
  const roles = CLASS_ORDER.slice();
  for (let i = roles.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [roles[i], roles[j]] = [roles[j], roles[i]];
  }
  const team = [];
  for (const role of roles) {
    if (team.length >= size) break;
    const pool = GAME.characters.filter((c) => c.role === role && !used.has(c.id));
    if (!pool.length) continue;
    const pick = pool[Math.floor(Math.random() * pool.length)];
    team.push(pick.id);
    used.add(pick.id);
  }
  return team;
}

function randomFullTeam(exclude) {
  return randomTeam(CLASS_ORDER.length, exclude);
}

function randomStarters(team) {
  const pool = team.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, Math.min(3, pool.length));
}

function openPlayMode() {
  askChoicePrompt({
    icon: "🎮",
    title: "Nouvelle partie",
    text: "Choisissez un mode de jeu.",
    hint: "Normal : choisir le terrain puis composer les équipes (1 champion de chaque classe). Aléatoire : terrain et équipes tirés au sort. Rampage : 3c3 sans réserve ni objectif, éliminez toute l'équipe adverse.",
    cancel: "Annuler",
    options: [
      { label: "Mode normal", value: "normal" },
      { label: "🎲 Mode aléatoire", value: "random" },
      { label: "💥 Rampage (3c3)", value: "rampage" }
    ]
  }).then((val) => {
    if (val === "normal") openTerrainPicker("classic");
    else if (val === "random") startRandomGame("classic");
    else if (val === "rampage") openTerrainPicker("rampage");
    else showHome();
  });
}

function openTerrainPicker(mode) {
  const ids = Object.keys(GAME.maps).filter((id) => GAME.maps[id]);
  if (!ids.length) {
    alert("Aucun terrain disponible.");
    showHome();
    return;
  }
  const options = ids.map((id) => ({ label: GAME.maps[id].name, value: id }));
  options.push({ label: "🎲 Au hasard", value: "__random__" });
  askChoicePrompt({
    icon: "🗺️",
    title: mode === "rampage" ? "Rampage — choisir le terrain" : "Choisir le terrain",
    text: mode === "rampage"
      ? "Terrain de la partie Rampage (3c3, sans réserve ni objectif)."
      : "Sur quel terrain voulez-vous jouer ?",
    cancel: "Annuler",
    options
  }).then((val) => {
    if (!val) {
      showHome();
      return;
    }
    let id = val;
    if (id === "__random__") id = ids[Math.floor(Math.random() * ids.length)];
    startNormalGame(id, mode === "rampage" ? "rampage" : "classic");
  });
}

function startNormalGame(mapId, mode) {
  setActiveMap(mapId);
  state = defaultState();
  state.mode = mode === "rampage" ? "rampage" : "classic";
  undoStack = [];
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
  pendingAbility = null;
  pendingSpawn = null;
  save();
  renderDecks();
  refreshMapSelectOptions();
  chooseSelectionMethod();
}

/* Choix de la méthode de composition des équipes : draft, aléatoire, libre. */
function chooseSelectionMethod() {
  askChoicePrompt({
    icon: "🧩",
    title: "Sélection des champions",
    text: isRampage()
      ? "Rampage : 3 champions de 3 classes différentes."
      : "Mode normal : 5 champions, un par classe.",
    hint: "Tour par tour : chacun choisit à son tour (sans doublon de classe). Aléatoire : équipes tirées au sort. Libre : chaque équipe se compose librement.",
    cancel: "Annuler",
    options: [
      { label: "🔁 Tour par tour (draft)", value: "draft" },
      { label: "🎲 Aléatoire", value: "random" },
      { label: "✍️ Composition libre", value: "free" }
    ]
  }).then((val) => {
    if (val === "draft") beginDraft();
    else if (val === "random") randomSelectTeams();
    else if (val === "free") beginTeamBuild();
    else showHome();
  });
}

function randomSelectTeams() {
  state.decks = { A: randomTeam(teamSizeTarget(), null) };
  state.decks.B = randomTeam(teamSizeTarget(), state.decks.A);
  state.starters = isRampage()
    ? { A: state.decks.A.slice(), B: state.decks.B.slice() }
    : { A: randomStarters(state.decks.A), B: randomStarters(state.decks.B) };
  buildMode = null;
  renderBuildBanner();
  save();
  renderDecks();
  startGame();
}

function beginTeamBuild() {
  buildMode = { player: "A" };
  state.decks = { A: [], B: [] };
  save();
  renderDecks();
  hideHome();
  document.querySelector('[data-tab="library"]').click();
  renderLibrary();
}

function renderBuildBanner() {
  const banner = document.getElementById("build-banner");
  if (!banner) return;
  if (!buildMode) {
    banner.style.display = "none";
    banner.innerHTML = "";
    return;
  }
  if (onlineMode && !buildMode.draft) buildMode.player = lanLocalTeam();
  const cur = buildMode.player;
  const draft = !!buildMode.draft;
  const target = teamSizeTarget();
  const filled = state.decks[cur].length;
  const remaining = CLASS_ORDER.filter((r) => !teamHasRole(cur, r)).map(roleLabel);
  const doneA = teamComplete("A");
  const doneB = teamComplete("B");
  banner.style.display = "flex";
  const teamsHtml = onlineMode
    ? `<span class="build-teams"><span class="build-team-btn active">Équipe ${cur}</span></span>`
    : draft
      ? `<span class="build-teams"><button class="build-cancel">Annuler</button></span>`
      : `<span class="build-teams">
      <button class="build-team-btn ${cur === "A" ? "active" : ""} ${doneA ? "done" : ""}" data-team="A">A${doneA ? " ✓" : ""}</button>
      <button class="build-team-btn ${cur === "B" ? "active" : ""} ${doneB ? "done" : ""}" data-team="B">B${doneB ? " ✓" : ""}</button>
      <button class="build-cancel">Annuler</button>
    </span>`;
  const progressText = isRampage()
    ? `${filled}/${target} champions · 3 classes différentes`
    : (remaining.length ? `Classes restantes : <strong>${remaining.join(", ")}</strong>` : "Équipe complète !");
  banner.innerHTML = `
    <span class="build-title player-${cur.toLowerCase()}">${draft ? "Draft — " : ""}Équipe ${cur} — ${filled}/${target}</span>
    <span class="build-progress">${progressText}</span>
    ${teamsHtml}
  `;
  if (!onlineMode && !draft) {
    banner.querySelectorAll(".build-team-btn").forEach((b) => {
      b.addEventListener("click", () => {
        buildMode.player = b.dataset.team;
        renderLibrary();
      });
    });
  }
  if (!onlineMode) {
    const cb = banner.querySelector(".build-cancel");
    if (cb) cb.addEventListener("click", cancelBuild);
  }
}

function pickForBuild(charId) {
  if (!buildMode) return;
  if (buildMode.draft) return draftPick(charId);
  const cur = buildMode.player;
  const other = cur === "A" ? "B" : "A";
  const deck = state.decks[cur];
  const idx = deck.indexOf(charId);
  if (idx >= 0) {
    deck.splice(idx, 1);
  } else {
    if (state.decks[other].includes(charId)) {
      alert("Ce Champion est déjà dans l'autre équipe.");
      return;
    }
    const c = charById(charId);
    if (teamHasRole(cur, c.role)) {
      alert(`L'équipe ${cur} a déjà un ${roleLabel(c.role)}.`);
      return;
    }
    if (deck.length >= teamSizeTarget()) {
      alert(`L'équipe ${cur} est déjà complète.`);
      return;
    }
    deck.push(charId);
  }
  save();
  renderDecks();
  if (onlineMode) {
    onlineSend({ type: "live-deck", team: cur, deck: state.decks[cur].slice() });
    renderLibrary();
    if (teamComplete(cur)) onlineLocalBuildDone();
    return;
  }
  if (teamComplete(cur) && cur === "A") buildMode.player = "B";
  renderLibrary();
  if (teamComplete("A") && teamComplete("B")) finishBuild();
}

/* ---------- Draft (sélection tour par tour) ---------- */

function beginDraft() {
  state.decks = { A: [], B: [] };
  state.starters = { A: [], B: [] };
  buildMode = { player: "A", draft: true };
  save();
  renderDecks();
  hideHome();
  const tab = document.querySelector('[data-tab="library"]');
  if (tab) tab.click();
  renderLibrary();
}

/* Valide un choix de draft : champion libre, classe non déjà possédée. */
function draftCanPick(player, charId) {
  const other = player === "A" ? "B" : "A";
  const c = charById(charId);
  if (!c) return false;
  const deck = state.decks[player] || [];
  if (deck.includes(charId)) return false;
  if ((state.decks[other] || []).includes(charId)) return false;
  if (teamHasRole(player, c.role)) return false;
  if (deck.length >= teamSizeTarget()) return false;
  return true;
}

function draftPick(charId) {
  if (!buildMode || !buildMode.draft) return;
  const cur = buildMode.player;
  if (onlineMode && cur !== lanLocalTeam()) return;
  const other = cur === "A" ? "B" : "A";
  if (state.decks[cur].includes(charId)) return;
  if (state.decks[other].includes(charId)) {
    alert("Ce Champion est déjà pris par l'adversaire.");
    return;
  }
  const c = charById(charId);
  if (teamHasRole(cur, c.role)) {
    alert(`L'équipe ${cur} a déjà un ${roleLabel(c.role)}.`);
    return;
  }
  if (state.decks[cur].length >= teamSizeTarget()) return;

  if (onlineMode && lanRole === "client") {
    onlineSend({ type: "draft-pick", charId });
    return;
  }
  state.decks[cur].push(charId);
  save();
  if (onlineMode) { onlineDraftAfterPick(); return; }
  afterDraftPickLocal();
}

/* En local, bascule vers l'autre équipe tant qu'elle n'est pas complète. */
function afterDraftPickLocal() {
  if (teamComplete("A") && teamComplete("B")) { finishDraft(); return; }
  const cur = buildMode.player;
  const other = cur === "A" ? "B" : "A";
  buildMode.player = teamComplete(other) ? cur : other;
  renderLibrary();
}

function finishDraft() {
  buildMode = null;
  renderBuildBanner();
  if (isRampage()) {
    state.starters = { A: state.decks.A.slice(), B: state.decks.B.slice() };
    save();
    startGame();
  } else {
    openStarterDialog({ askMap: false });
  }
}

function cancelBuild() {
  buildMode = null;
  renderBuildBanner();
  renderLibrary();
  showHome();
}

function finishBuild() {
  if (!teamComplete("A") || !teamComplete("B")) return;
  buildMode = null;
  renderBuildBanner();
  renderDecks();
  save();
  if (isRampage()) {
    state.starters = { A: state.decks.A.slice(), B: state.decks.B.slice() };
    save();
    startGame();
  } else {
    openStarterDialog({ askMap: false });
  }
}

function startRandomGame(mode) {
  const ids = Object.keys(GAME.maps).filter((id) => GAME.maps[id]);
  if (!ids.length) {
    alert("Aucun terrain disponible.");
    showHome();
    return;
  }
  const id = ids[Math.floor(Math.random() * ids.length)];
  setActiveMap(id);
  state = defaultState();
  state.mode = mode === "rampage" ? "rampage" : "classic";
  buildMode = null;
  renderBuildBanner();
  state.decks = { A: randomTeam(teamSizeTarget(), null) };
  state.decks.B = randomTeam(teamSizeTarget(), state.decks.A);
  state.starters = isRampage()
    ? { A: state.decks.A.slice(), B: state.decks.B.slice() }
    : { A: randomStarters(state.decks.A), B: randomStarters(state.decks.B) };
  undoStack = [];
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
  pendingAbility = null;
  pendingSpawn = null;
  save();
  renderDecks();
  startGame();
}

function isTurnOf(player) {
  return state.winner === null && state.turn === player;
}

function swapCooldown(player) {
  return (state.swapCd && state.swapCd[player]) || 0;
}

function setSwapCooldown(player, val) {
  if (!state.swapCd) state.swapCd = { A: 0, B: 0 };
  state.swapCd[player] = val;
}

function passiveBlockHere(x, y, forPlayer) {
  if (x < 0 || y < 0 || y >= GAME.map.rows || x >= GAME.map.cols) return true;
  if (GAME.map.tiles[y][x] === 1) return true;
  if (isVoidCell(x, y)) return true;
  for (const w of state.walls) if (w.x === x && w.y === y) return true;
  for (const gz of state.guardZones) {
    if (Math.abs(gz.x - x) <= 1 && Math.abs(gz.y - y) <= 1) {
      if (gz.player !== forPlayer) return true;
    }
  }
  const sp = specialCellAt(x, y);
  if (sp && sp.type === "block") return true;
  if (objectiveCellAt(x, y)) return true;
  return false;
}

function isPassable(x, y, forPlayer) {
  return !passiveBlockHere(x, y, forPlayer);
}

function isBlockedLoS(x, y) {
  if (x < 0 || y < 0 || y >= GAME.map.rows || x >= GAME.map.cols) return true;
  if (GAME.map.tiles[y][x] === 1) return true;
  for (const w of state.walls) if (w.x === x && w.y === y) return true;
  if ((state.tokens || []).some((t) => !t.dead && t.x === x && t.y === y)) return true;
  for (const gz of state.guardZones) {
    if (Math.abs(gz.x - x) <= 1 && Math.abs(gz.y - y) <= 1) return true;
  }
  return false;
}

function edgeKey(x1, y1, x2, y2) {
  return `${Math.min(x1, x2)},${Math.min(y1, y2)}-${Math.max(x1, x2)},${Math.max(y1, y2)}`;
}

function edgeWalled(x1, y1, x2, y2) {
  if (x1 === x2 && y1 === y2) return false;
  if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) return false;
  const key = edgeKey(x1, y1, x2, y2);
  if (GAME.edgeSet.has(key)) return true;
  if ((state.arkWalls || []).some((w) => w && w.key === key)) return true;
  return false;
}

function arkWallBetween(x1, y1, x2, y2) {
  if (x1 === x2 && y1 === y2) return null;
  if (Math.abs(x1 - x2) + Math.abs(y1 - y2) !== 1) return null;
  const key = edgeKey(x1, y1, x2, y2);
  return (state.arkWalls || []).find((w) => w && w.key === key) || null;
}

function inScrabGelZone(sx, sy, tx, ty) {
  return Math.abs(tx - sx) <= 3 && Math.abs(ty - sy) <= 3;
}

function hasClearLoS(x1, y1, x2, y2) {
  if (x1 === x2 && y1 === y2) return true;
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx !== dy && dx !== 0 && dy !== 0) return false;
  const sx = dx === 0 ? 0 : x1 < x2 ? 1 : -1;
  const sy = dy === 0 ? 0 : y1 < y2 ? 1 : -1;
  const steps = Math.max(dx, dy);
  for (let i = 1; i < steps; i++) {
    const cx = x1 + i * sx;
    const cy = y1 + i * sy;
    const px = x1 + (i - 1) * sx;
    const py = y1 + (i - 1) * sy;
    if (edgeWalled(px, py, cx, cy)) return false;
    if (sx !== 0 && sy !== 0) {
      if (edgeWalled(px, py, cx, py) && edgeWalled(px, py, px, cy)) return false;
    }
    if (isBlockedLoS(cx, cy)) return false;
  }
  return true;
}

function distanceCheb(x1, y1, x2, y2) {
  return Math.max(Math.abs(x2 - x1), Math.abs(y2 - y1));
}

function distanceManhattan(tok, x2, y2) {
  return Math.abs(x2 - tok.x) + Math.abs(y2 - tok.y);
}

/* Règle du jeu : aucune diagonale. Seules les lignes droites (horizontales ou
   verticales) sont autorisées pour les attaques et les portées de capacités. */
function inStraightLine(x1, y1, x2, y2, dist) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx !== 0 && dy !== 0) return false;
  return Math.max(dx, dy) <= dist;
}

function inGuardZone(x, y) {
  return state.guardZones.some((z) => Math.abs(z.x - x) <= 1 && Math.abs(z.y - y) <= 1);
}

function lineCrossesGuardZone(x1, y1, x2, y2) {
  const dx = Math.abs(x2 - x1);
  const dy = Math.abs(y2 - y1);
  if (dx !== dy && dx !== 0 && dy !== 0) return false;
  const sx = dx === 0 ? 0 : x1 < x2 ? 1 : -1;
  const sy = dy === 0 ? 0 : y1 < y2 ? 1 : -1;
  const steps = Math.max(dx, dy);
  for (let i = 1; i < steps; i++) {
    if (inGuardZone(x1 + i * sx, y1 + i * sy)) return true;
  }
  return false;
}

function tokenAt(x, y) {
  return state.tokens.find((t) => !t.dead && t.x === x && t.y === y) || null;
}

function cellHasEntity(x, y) {
  if (state.tokens.some((t) => !t.dead && t.x === x && t.y === y)) return true;
  if (objectiveCellAt(x, y)) return true;
  return false;
}

function movementBudget(tok) {
  if (tok.movLeft != null) return tok.movLeft;
  return movementOf(tok);
}

function reachableFrom(x, y, movement, player) {
  const seen = new Set();
  const result = [];
  const queue = [[x, y, 0]];
  seen.add(`${x},${y}`);
  while (queue.length) {
    const [cx, cy, d] = queue.shift();
    if (d > 0) result.push([cx, cy]);
    if (d >= movement) continue;
    for (const [dx, dy] of [[1,0],[-1,0],[0,1],[0,-1]]) {
      const nx = cx + dx, ny = cy + dy;
      const key = `${nx},${ny}`;
      if (seen.has(key)) continue;
      if (!isPassable(nx, ny, player)) continue;
      if (edgeWalled(cx, cy, nx, ny)) continue;
      if (cellHasEntity(nx, ny)) continue;
      seen.add(key);
      queue.push([nx, ny, d + 1]);
    }
  }
  return result;
}

/* Trajet réellement emprunté jusqu'à (tx, ty), calculé avec EXACTEMENT les mêmes
   règles que reachableFrom (murs, bords, champions, aucune diagonale).
   Dijkstra : chaque case avance de 1000 et chaque case en feu ajoute 1, donc le
   trajet reste le plus court possible et n'évite le feu qu'à égalité de distance.
   Le même chemin sert de prévisualisation au survol et de déplacement au clic. */
function pathTo(tok, tx, ty) {
  if (tx === tok.x && ty === tok.y) return [[tok.x, tok.y]];
  const cols = GAME.map.cols;
  const rows = GAME.map.rows;
  const startKey = `${tok.x},${tok.y}`;
  const best = new Map([[startKey, 0]]);
  const prev = new Map([[startKey, null]]);
  const queue = [{ x: tok.x, y: tok.y, cost: 0 }];
  let endKey = null;
  while (queue.length) {
    queue.sort((a, b) => a.cost - b.cost);
    const cur = queue.shift();
    const curKey = `${cur.x},${cur.y}`;
    if (best.get(curKey) !== cur.cost) continue;
    if (cur.x === tx && cur.y === ty) {
      endKey = curKey;
      break;
    }
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = cur.x + dx;
      const ny = cur.y + dy;
      if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
      const nKey = `${nx},${ny}`;
      if (nKey === startKey) continue;
      if (!isPassable(nx, ny, tok.player)) continue;
      if (edgeWalled(cur.x, cur.y, nx, ny)) continue;
      if (cellHasEntity(nx, ny)) continue;
      const cost = cur.cost + 1000 + (isFire(nx, ny) ? 1 : 0);
      if (best.has(nKey) && best.get(nKey) <= cost) continue;
      best.set(nKey, cost);
      prev.set(nKey, [cur.x, cur.y]);
      queue.push({ x: nx, y: ny, cost });
    }
  }
  if (!endKey) return null;
  const path = [];
  let cursor = [tx, ty];
  while (cursor) {
    path.unshift(cursor);
    cursor = prev.get(`${cursor[0]},${cursor[1]}`);
  }
  return path;
}

function speedBoostAvailable(tok) {
  return !tok.speedTurnBoost && !tok.speedUsed;
}

function movementOf(tok) {
  const c = charById(tok.charId);
  if (state.guardZones.some((z) => z.ownerId === tok.id)) return 0;
  let m = c.mouvement;
  if (tok.speedTurnBoost) m *= 2;
  return m;
}

function attackCellsOf(tok) {
  const c = charById(tok.charId);
  const cells = [];
  if (state.guardZones.some((z) => Math.abs(z.x - tok.x) <= 1 && Math.abs(z.y - tok.y) <= 1)) {
    return cells;
  }
  for (let y = 0; y < GAME.map.rows; y++) {
    for (let x = 0; x < GAME.map.cols; x++) {
      if (state.guardZones.some((z) => Math.abs(z.x - x) <= 1 && Math.abs(z.y - y) <= 1)) continue;
      if (x === tok.x && y === tok.y) continue;
      if (inStraightLine(tok.x, tok.y, x, y, c.range)) {
        if (hasClearLoS(tok.x, tok.y, x, y)) cells.push([x, y]);
      }
    }
  }
  (state.arkWalls || []).forEach((w) => {
    if (!w) return;
    const [ka, kb] = w.key.split("-");
    if (!ka || !kb) return;
    const [ax, ay] = ka.split(",").map(Number);
    const [bx, by] = kb.split(",").map(Number);
    const near = tok.x === ax && tok.y === ay;
    const farX = near ? bx : tok.x === bx && tok.y === by ? ax : -1;
    const farY = near ? by : tok.x === bx && tok.y === by ? ay : -1;
    if (farX < 0) return;
    if (state.guardZones.some((z) => Math.abs(z.x - farX) <= 1 && Math.abs(z.y - farY) <= 1)) return;
    if (!cells.some(([cx, cy]) => cx === farX && cy === farY)) cells.push([farX, farY]);
  });
  return cells;
}

/* ---------- Onglets ---------- */

document.querySelectorAll(".tab-btn[data-tab]").forEach((btn) => {
  btn.addEventListener("click", () => {
    if (document.body.classList.contains("bigscreen") && btn.dataset.tab !== "board") {
      setBigScreen(false);
    }
    document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
    document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
    btn.classList.add("active");
    document.getElementById("tab-" + btn.dataset.tab).classList.add("active");
    if (btn.dataset.tab === "board") renderBoard();
    if (btn.dataset.tab === "maps") renderMapGallery();
    hideHome();
  });
});

/* ---------- Librairie ---------- */

const libSearch = document.getElementById("lib-search");
const libRole = document.getElementById("lib-role");
libSearch.addEventListener("input", renderLibrary);
libRole.addEventListener("change", renderLibrary);

function renderRoleOptions() {
  const select = document.getElementById("lib-role");
  select.innerHTML = '<option value="">Tous les rôles</option>';
  Array.from(new Set(GAME.characters.map((c) => c.role))).forEach((role) => {
    const opt = document.createElement("option");
    opt.value = role;
    opt.textContent = roleLabel(role);
    select.appendChild(opt);
  });
}

function renderLibrary() {
  const list = document.getElementById("library-list");
  list.innerHTML = "";
  const q = libSearch.value.toLowerCase();
  const r = libRole.value;
  const chars = GAME.characters.filter(
    (c) => (r === "" || c.role === r) && (q === "" || c.name.toLowerCase().includes(q))
  );
  if (!chars.length) {
    list.innerHTML = '<p class="empty-msg">Aucun Champion.</p>';
  }
  chars.forEach((c) => {
    const card = document.createElement("div");
    card.className = "char-card";
    card.style.setProperty("--card-color", CAST_COLORS[c.id] || "#c5d3e8");
    card.style.setProperty("--card-tint", (CAST_COLORS[c.id] || "#c5d3e8") + "26");

    let btnLabel = "Ajouter au deck";
    let btnDisabled = false;
    if (buildMode) {
      const cur = buildMode.player;
      const other = cur === "A" ? "B" : "A";
      const inCurrent = state.decks[cur].includes(c.id);
      const inOther = state.decks[other].includes(c.id);
      const roleFull = teamHasRole(cur, c.role);
      const notMyTurn = buildMode.draft && onlineMode && cur !== lanLocalTeam();
      if (notMyTurn) {
        card.classList.add("build-disabled");
        btnLabel = "Tour de l'adversaire";
        btnDisabled = true;
      } else if (inCurrent) {
        card.classList.add("build-picked");
        btnLabel = `Retirer de l'équipe ${cur}`;
      } else if (inOther || roleFull) {
        card.classList.add("build-disabled");
        btnLabel = inOther ? "Déjà dans l'autre équipe" : `${roleLabel(c.role)} déjà pris`;
        btnDisabled = true;
      } else {
        btnLabel = `Ajouter à l'équipe ${cur}`;
      }
    }
    card.innerHTML = `
      <div class="char-top">
        <div class="char-avatar">${esc(c.name.charAt(0))}</div>
        <div class="char-head">
          <span class="char-name">${c.id === "calix" ? '<span class="char-brick" title="Création">🧱</span>' : ""}${esc(c.name)}</span>
          <span class="char-role">${c.number ? "n°" + c.number + " · " : ""}${roleLabel(c.role)}</span>
        </div>
      </div>
      <div class="char-stats">
        <span>PV ${c.hp}</span><span>ATQ ${c.atk}</span><span>DÉP ${c.mouvement}</span><span>PORTÉE ${c.range}</span>
      </div>
      <div class="char-ability"><strong>${esc(c.ability.name)}</strong> — ${esc(c.ability.desc)}</div>
      ${c.passive && c.passive.name ? `<div class="char-passive"><strong>Passif : ${esc(c.passive.name)}</strong> — ${esc(c.passive.desc)}</div>` : ""}
      ${buildMode ? `<button class="btn-add" data-id="${c.id}"${btnDisabled ? " disabled" : ""}>${btnLabel}</button>` : ""}
    `;
    list.appendChild(card);
    const addBtn = card.querySelector(".btn-add");
    if (addBtn) {
      addBtn.addEventListener("click", () => {
        if (btnDisabled) return;
        pickForBuild(c.id);
      });
    }
  });
  renderBuildBanner();
}

function renderDecks() {
  // L'onglet Decks a été retiré ; plus de rendu nécessaire.
}

/* ---------- Détail Champion ---------- */

const dialog = document.getElementById("char-dialog");
document.getElementById("dialog-close").addEventListener("click", () => dialog.close());

function openCharDialog(c, currentHp) {
  const cnt = document.getElementById("char-dialog-content");
  const cc = CAST_COLORS[c.id] || "#c5d3e8";
  cnt.style.setProperty("--card-color", cc);
  cnt.style.setProperty("--card-tint", cc + "26");
  cnt.innerHTML = `
    <div class="char-top">
      <div class="char-avatar">${esc(c.name.charAt(0))}</div>
      <div>
        <h2>${c.id === "calix" ? '<span class="char-brick" title="Création">🧱</span>' : ""}${esc(c.name)}</h2>
        <p class="char-role">${c.number ? "n°" + c.number + " · " : ""}${roleLabel(c.role)}</p>
      </div>
    </div>
    <div class="char-stats">
      <span>PV ${currentHp != null ? `${currentHp}/${c.hp}` : c.hp}</span><span>ATQ ${c.atk}</span><span>DÉP ${c.mouvement}</span><span>PORTÉE ${c.range}</span>
    </div>
    <div class="char-ability"><strong>${esc(c.ability.name)}</strong> — ${esc(c.ability.desc)}</div>
    ${c.passive && c.passive.name ? `<div class="char-passive"><strong>Passif : ${esc(c.passive.name)}</strong> — ${esc(c.passive.desc)}</div>` : ""}
  `;
  dialog.showModal();
}

/* ---------- Boîte de confirmation (remplace confirm/alert) ---------- */

const askDialog = document.getElementById("ask-dialog");
const askTitle = document.getElementById("ask-title");
const askText = document.getElementById("ask-text");
const askHint = document.getElementById("ask-hint");
const askYes = document.getElementById("ask-yes");
const askNo = document.getElementById("ask-no");
const askChoice = document.getElementById("ask-choice");

let askResolver = null;

function askConfirm(opts) {
  const o = typeof opts === "string" ? { text: opts } : opts || {};
  askTitle.textContent = o.title || "Confirmation";
  askText.textContent = o.text || "";
  askHint.textContent = o.hint || "";
  askHint.style.display = o.hint ? "block" : "none";
  askYes.textContent = o.yes || "Oui";
  askNo.textContent = o.no || "Non";
  if (o.icon) askDialog.querySelector(".ask-icon").textContent = o.icon;
  if (o.yes) askYes.style.display = "";
  else askYes.style.display = "none";
  askChoice.innerHTML = "";
  askChoice.style.display = "none";
  askDialog.showModal();
  return new Promise((resolve) => {
    askResolver = resolve;
  });
}

/* Fenêtre de choix multiple (ex : quantité de PV à donner). */
function askChoicePrompt(opts) {
  const o = opts || {};
  askTitle.textContent = o.title || "Choisissez";
  askText.textContent = o.text || "";
  askHint.textContent = o.hint || "";
  askHint.style.display = o.hint ? "block" : "none";
  if (o.icon) askDialog.querySelector(".ask-icon").textContent = o.icon;
  askYes.style.display = "none";
  askNo.textContent = o.cancel || "Annuler";
  askNo.style.display = "";
  askChoice.innerHTML = "";
  askChoice.style.display = "flex";
  (o.options || []).forEach((opt) => {
    const b = document.createElement("button");
    b.className = "ask-btn ask-btn-primary";
    b.textContent = opt.label;
    b.addEventListener("click", () => closeAsk(opt.value));
    askChoice.appendChild(b);
  });
  askDialog.showModal();
  return new Promise((resolve) => {
    askResolver = resolve;
  });
}

function closeAsk(value) {
  if (!askDialog.open) return;
  askDialog.close();
  askChoice.innerHTML = "";
  askChoice.style.display = "none";
  if (askResolver) {
    const r = askResolver;
    askResolver = null;
    r(value);
  }
}

/* CALIX : deux temps (type, puis case) sans await, comme les autres capacités. */
function askCalixType(tokenId, avail) {
  askTitle.textContent = "Création";
  askText.textContent = "Quelle case spéciale CALIX pose-t-il ?";
  askHint.textContent = avail
    .map((t) => `${CALIX_TYPE_LABEL[t]} : ${calixQuotaLeft(tokenId, t)} restante(s)`)
    .join(" — ");
  askHint.style.display = "block";
  askDialog.querySelector(".ask-icon").textContent = "🧱";
  askYes.style.display = "none";
  askNo.textContent = "Annuler";
  askNo.style.display = "";
  askChoice.innerHTML = "";
  askChoice.style.display = "flex";
  avail.forEach((t) => {
    const b = document.createElement("button");
    b.className = "ask-btn ask-btn-primary";
    b.textContent = CALIX_TYPE_LABEL[t];
    b.addEventListener("click", () => {
      closeAsk(true);
      if (pendingAbility && pendingAbility.type === "calix") {
        pendingAbility.cellType = t;
        log(`CALIX va poser une case ${CALIX_TYPE_LABEL[t]} : choisissez une case libre du terrain.`);
        renderBoard();
      }
    });
    askChoice.appendChild(b);
  });
  askDialog.showModal();
}

askYes.addEventListener("click", () => closeAsk(true));
askNo.addEventListener("click", () => {
  const wasCalix = pendingAbility && pendingAbility.type === "calix" && !pendingAbility.cellType;
  closeAsk(false);
  if (wasCalix) {
    pendingAbility = null;
    log("CALIX annule sa création.");
    renderBoard();
  }
});
askDialog.addEventListener("cancel", (e) => {
  e.preventDefault();
  closeAsk(false);
});

/* ---------- Titulaires ---------- */

const starterDialog = document.getElementById("starter-dialog");

function openStarterDialog(opts) {
  const askMap = !opts || opts.askMap !== false;
  const content = document.getElementById("starter-content");
  content.innerHTML = "";
  ["A", "B"].forEach((player) => {
    const col = document.createElement("div");
    col.className = "starter-col";
    col.innerHTML = `<h3>Équipe ${player} — choisissez 3 titulaires</h3>`;
    state.decks[player].forEach((id) => {
      const c = charById(id);
      if (!c) return;
      const chip = document.createElement("button");
      chip.className = "starter-chip";
      chip.dataset.player = player;
      chip.textContent = `${c.name} (${roleLabel(c.role)})`;
      chip.addEventListener("click", () => {
        chip.classList.toggle("picked");
        updateStarterConfirm();
      });
      col.appendChild(chip);
    });
    content.appendChild(col);
  });

  const confirmBtn = document.getElementById("starter-confirm");
  confirmBtn.disabled = true;
  confirmBtn.onclick = async () => {
    const picks = { A: [], B: [] };
    document.querySelectorAll(".starter-chip.picked").forEach((chip) => {
      picks[chip.dataset.player].push(chip.textContent.split(" (")[0]);
    });
    const byId = (name) => GAME.characters.find((c) => c.name === name).id;
    const starters = { A: picks.A.map(byId), B: picks.B.map(byId) };

    const mapIds = Object.keys(GAME.maps).filter((id) => GAME.maps[id]);
    let wantRandom = false;
    if (askMap && mapIds.length > 1) {
      wantRandom = await askConfirm({
        icon: "🎲",
        title: "Terrain au hasard",
        text: "Voulez-vous jouer sur un terrain tiré au hasard ?",
        hint: "Non = garder le terrain actuel : « " + GAME.maps[GAME.activeMap].name + " ».",
        yes: "Oui, au hasard",
        no: "Non"
      });
    }

    const keepDecks = { A: state.decks.A.slice(), B: state.decks.B.slice() };
    if (wantRandom) {
      randomMapFor();
      state.decks = keepDecks;
      save();
      renderDecks();
    }
    state.starters = starters;
    save();
    starterDialog.close();
    startGame();
  };
  updateStarterConfirm();
  starterDialog.showModal();
}

function updateStarterConfirm() {
  const picked = { A: 0, B: 0 };
  document.querySelectorAll(".starter-chip.picked").forEach((chip) => picked[chip.dataset.player]++);
  const confirmBtn = document.getElementById("starter-confirm");
  const decks = { A: state.decks.A.length, B: state.decks.B.length };
  const okA = picked.A === Math.min(3, decks.A);
  const okB = picked.B === Math.min(3, decks.B);
  confirmBtn.disabled = !(okA && okB);
  if (okA && okB) confirmBtn.textContent = "Déployer les équipes";
}

/* ---------- Partie / Plateau ---------- */

function startGame() {
  state.tokens = [];
  state.walls = [];
  state.arkWalls = [];
  state.guardZones = [];
  state.reserve = { A: [], B: [] };
  state.turn = "A";
  state.turnCount = 1;
  state.shrinkStep = 0;
  state.log = [];
  state.healingBlocked = false;
  state.objectives = {
    A: GAME.objectives.A.hp,
    B: GAME.objectives.B.hp
  };
  state.objectivePos = { A: null, B: null };
  state.phase = "placement";
  state.placement = { A: false, B: false };
  state.placingPlayer = "A";
  state.placingStage = isRampage() ? "champion" : "objective";
  state.placingQueue = {
    A: state.starters.A.slice(),
    B: state.starters.B.slice()
  };
  state.rapidoBuff = null;
  state.bettaCharges = 2;
  state.scrabTriggered = {};
  state.specialCells = [];
  state.swapCd = { A: 0, B: 0 };
  state.winner = null;
  if (!isRampage()) {
    ["A", "B"].forEach((player) => {
      const inReserve = state.decks[player].filter((id) => !state.starters[player].includes(id));
      inReserve.forEach((charId) => {
        const c = charById(charId);
        if (!c) return;
        state.reserve[player].push({ charId, hp: c.hp });
      });
    });
    log("Phase de placement : chaque équipe doit placer son objectif puis ses 3 titulaires dans sa zone.");
  } else {
    log("Rampage (3c3) : pas d'objectif ni de réserve. Placez vos 3 champions, éliminez toute l'équipe adverse.");
  }
  selectedTokenId = null;
    reachable = [];
    attackCells = [];
    pendingAbility = null;
    pendingSpawn = null;
    save();
    renderBoard();
    document.querySelector('[data-tab="board"]').click();
}

function objectiveDef(player) {
  const o = GAME.objectives[player];
  const pos = state.objectivePos ? state.objectivePos[player] : null;
  /* Sans objectif posé (notamment en Rampage) on renvoie une case impossible,
     pour qu'aucune attaque ne puisse viser un objectif fantôme. */
  if (!pos) return { x: -1, y: -1, hp: o.hp };
  return { x: pos.x, y: pos.y, hp: o.hp };
}

function checkWinnerFromObjective(attackerPlayer) {
  if (isRampage()) return;
  const defeated = turnOfOther(attackerPlayer);
  if (state.objectives[defeated] <= 0) {
    state.winner = attackerPlayer;
    log(`L'objectif de l'équipe ${defeated} est détruit ! Victoire de l'équipe ${attackerPlayer}.`);
  }
}

function allDead(player) {
  return state.tokens.every((t) => t.player !== player || t.dead);
}

const NEXUS_SVG =
  '<svg class="nexus" viewBox="0 0 40 40" aria-hidden="true">' +
  '<circle class="nx-track" cx="20" cy="20" r="16"/>' +
  '<circle class="nx-gauge" cx="20" cy="20" r="16"/>' +
  '<g class="nx-reticle">' +
  '<line x1="20" y1="1" x2="20" y2="7"/><line x1="20" y1="33" x2="20" y2="39"/>' +
  '<line x1="1" y1="20" x2="7" y2="20"/><line x1="33" y1="20" x2="39" y2="20"/>' +
  "</g>" +
  '<path class="nx-core" d="M20 11 L27.79 15.5 L27.79 24.5 L20 29 L12.21 24.5 L12.21 15.5 Z"/>' +
  '<path class="nx-inner" d="M20 15 L24.5 17.5 L24.5 22.5 L20 25 L15.5 22.5 L15.5 17.5 Z"/>' +
  '<g class="nx-cracks">' +
  '<path class="nx-crack-1" d="M12.6 15.8 L17 19.4 L15.1 21.4 L19.6 25.2"/>' +
  '<path class="nx-crack-2" d="M27.4 16.4 L23.4 18.9 L26 21 L22 24.6"/>' +
  "</g>" +
  "</svg>";

const HB_PALETTE = {
  idle: ["rgba(167, 139, 250, 0.2)", "rgba(167, 139, 250, 0.075)", "rgba(167, 139, 250, 0.7)"],
  blue: ["rgba(79, 140, 255, 0.2)", "rgba(79, 140, 255, 0.075)", "rgba(79, 140, 255, 0.7)"],
  yellow: ["rgba(255, 183, 77, 0.2)", "rgba(255, 183, 77, 0.075)", "rgba(255, 183, 77, 0.7)"],
  red: ["rgba(255, 107, 107, 0.2)", "rgba(255, 107, 107, 0.075)", "rgba(255, 107, 107, 0.7)"]
};

function updateHeartbeat() {
  const el = document.querySelector(".heartbeat");
  if (!el) return;
  const tok = tokenById(selectedTokenId);
  const c = tok && !tok.dead ? charById(tok.charId) : null;
  const ratio = c && c.hp > 0 ? tok.hp / c.hp : null;
  const key = ratio === null ? "idle" : ratio > 0.6 ? "blue" : ratio > 0.3 ? "yellow" : "red";
  const [core, soft, line] = HB_PALETTE[key];
  el.style.setProperty("--hb-core", core);
  el.style.setProperty("--hb-soft", soft);
  el.style.setProperty("--hb-line", line);
}

/* ---------- Aperçu du trajet au survol ----------
   Montre exactement les cases qui seront traversées si le joueur clique sur la
   case survolée : le trajet affiché et le trajet appliqué sont calculés par la
   même fonction pathTo, donc l'aperçu est une promesse tenue. Les cases de feu
   du trajet ressortent, car chacune coûte 1 dégât. */
function showPathPreview(x, y) {
  clearPathPreview();
  if (busy || editMode || pendingAbility || state.winner || state.phase !== "playing") return;
  const sel = tokenById(selectedTokenId);
  if (!sel || sel.dead || !isTurnOf(sel.player)) return;
  if (!reachable.some(([rx, ry]) => rx === x && ry === y)) return;
  /* cellClick attaque avant de se déplacer : sur ces cases-là, pas d'aperçu de
     trajet, puisque le clic n'aurait pas pour effet de déplacer le champion. */
  if (canAttackAt(x, y) && arkWallBetween(sel.x, sel.y, x, y)) return;
  const path = pathTo(sel, x, y);
  if (!path) return;
  const board = document.getElementById("board");
  path.slice(1).forEach(([px, py]) => {
    const el = board.querySelector(`.cell[data-x="${px}"][data-y="${py}"]`);
    if (!el) return;
    el.classList.add("path-trail");
    if (isFire(px, py)) el.classList.add("path-fire");
    pathPreview.push(el);
  });
}

function clearPathPreview() {
  pathPreview.forEach((el) => {
    el.classList.remove("path-trail", "path-fire");
  });
  pathPreview = [];
}

function renderBoard() {
  const board = document.getElementById("board");
  board.innerHTML = "";
  pathPreview = [];
  board.style.gridTemplateColumns = `repeat(${GAME.map.cols}, 1fr)`;
  board.style.gridTemplateRows = `repeat(${GAME.map.rows}, 1fr)`;

  const occupied = {};
  state.tokens.filter((t) => !t.dead).forEach((t) => {
    const key = `${t.x},${t.y}`;
    (occupied[key] = occupied[key] || []).push(t);
  });

  const reachSet = new Set(reachable.map(([x, y]) => `${x},${y}`));
  const atkSet = new Set(attackCells.map(([x, y]) => `${x},${y}`));
  const dangerSet = dangerCellSet();

  const selTok = tokenById(selectedTokenId);
  const selOwnTurn = selTok && !selTok.dead && isTurnOf(selTok.player);
  const speedSpent = selOwnTurn && selTok.speedUsed;

  const scrabTok = pendingAbility && pendingAbility.type === "scrab" ? tokenById(pendingAbility.tokenId) : null;
  const scrabTargetSet = new Set();
  if (pendingAbility && pendingAbility.type === "scrab") {
    (pendingAbility.targets || []).forEach((id) => {
      const t = tokenById(id);
      if (t && !t.dead) scrabTargetSet.add(`${t.x},${t.y}`);
    });
  }

  const se7enSet = new Set();
  if (pendingAbility && pendingAbility.type === "se7en") {
    const st = tokenById(pendingAbility.tokenId);
    if (st) {
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dx !== 0 && dy !== 0) continue;
          se7enSet.add(`${st.x + dx},${st.y + dy}`);
        }
      }
    }
  }

  const allyHealSet = new Set();
  if (pendingAbility && pendingAbility.targets) {
    pendingAbility.targets.forEach((tid) => {
      const t = tokenById(tid);
      if (t) allyHealSet.add(`${t.x},${t.y}`);
    });
  }

  /* CALIX : surligne uniquement les cases à portée où elle a le droit de poser. */
  const calixRangeSet = new Set();
  if (pendingAbility && pendingAbility.type === "calix") {
    const calixTok = tokenById(pendingAbility.tokenId);
    if (calixTok) {
      const calixChar = charById(calixTok.charId);
      for (let dy = -calixChar.range; dy <= calixChar.range; dy++) {
        for (let dx = -calixChar.range; dx <= calixChar.range; dx++) {
          if (dx === 0 && dy === 0) continue;
          if (dx !== 0 && dy !== 0) continue;
          const cx = calixTok.x + dx;
          const cy = calixTok.y + dy;
          if (calixPlaceBlock(cx, cy, calixTok.player, calixTok)) continue;
          calixRangeSet.add(`${cx},${cy}`);
        }
      }
    }
  }

  const jayAura = new Set();
  state.tokens.forEach((t) => {
    if (t.charId !== "jay" || t.dead || !t.jayAura) return;
    for (let dy = -2; dy <= 2; dy++) {
      for (let dx = -2; dx <= 2; dx++) {
        jayAura.add(`${t.x + dx},${t.y + dy}`);
      }
    }
  });

  const xixzAura = new Set();
  state.tokens.forEach((t) => {
    if (t.charId !== "xixz" || t.dead) return;
    for (let dy = -1; dy <= 1; dy++) {
      for (let dx = -1; dx <= 1; dx++) {
        xixzAura.add(`${t.x + dx},${t.y + dy}`);
      }
    }
  });

  for (let y = 0; y < GAME.map.rows; y++) {
    for (let x = 0; x < GAME.map.cols; x++) {
      const cell = document.createElement("div");
      cell.className = "cell";
      cell.dataset.x = x;
      cell.dataset.y = y;

      const inGuardA = state.guardZones.some((gz) => gz.player === "A" && Math.abs(gz.x - x) <= 1 && Math.abs(gz.y - y) <= 1);
      const inGuardB = state.guardZones.some((gz) => gz.player === "B" && Math.abs(gz.x - x) <= 1 && Math.abs(gz.y - y) <= 1);
      if (inGuardA) cell.classList.add("guard-zone", "guard-a");
      if (inGuardB) cell.classList.add("guard-zone", "guard-b");

      if (GAME.map.tiles[y][x] === 1) {
        cell.classList.add("wall");
      } else {
        if (GAME.startZones.A.some(([zx, zy]) => zx === x && zy === y)) cell.classList.add("spawn-a");
        if (GAME.startZones.B.some(([zx, zy]) => zx === x && zy === y)) cell.classList.add("spawn-b");
      }

      if (state.phase === "placement") {
        if (inSpawnZone(state.placingPlayer, x, y)) cell.classList.add("placement-zone");
        if (cellPlaceable(x, y)) cell.classList.add("placeable");
      }

      if (isBurned(x, y)) cell.classList.add("shrink-burned");
      else if (dangerSet.has(`${x},${y}`)) cell.classList.add("shrink-danger");

      const dw = state.walls.find((w) => w.x === x && w.y === y);
      if (dw) {
        const dwEl = document.createElement("div");
        dwEl.className = "dwall";
        dwEl.textContent = dw.hp;
        dwEl.title = "Mur (1 PV)";
        cell.appendChild(dwEl);
      }

      if (isFire(x, y) && !specialCellAt(x, y)) {
        const fe = document.createElement("div");
        fe.className = "fire";
        if (isBurned(x, y)) {
          fe.classList.add("shrink-fire");
          fe.title = "Zone de feu (rétrécissement) : 1 dégât au passage et au début du tour — passage autorisé";
        } else {
          fe.title = "Case en feu : 1 dégât au passage";
        }
        cell.appendChild(fe);
      }

      if (isHealCell(x, y)) {
        const he = document.createElement("div");
        he.className = "special-heal";
        he.textContent = "✚";
        he.title = "Case de soin : +1 PV au passage ou à l'arrêt (non cumulable)";
        cell.appendChild(he);
      }

      if (isSpeedCell(x, y)) {
        const se = document.createElement("div");
        se.className = speedSpent ? "special-speed speed-spent" : "special-speed";
        se.textContent = "⚡";
        se.title = speedSpent
          ? "Case de vitesse déjà utilisée par ce champion ce tour (non cumulable)"
          : "Case de vitesse : double la mobilité restante si on s'y arrête (1 boost par tour) — ou au début du tour suivant si on y a fini son tour précédent";
        cell.appendChild(se);
      }

      if (isVoidCell(x, y)) {
        const ve = document.createElement("div");
        ve.className = "special-void";
        ve.title = "Case de vide : impassable, ligne de vue non bloquée";
        cell.appendChild(ve);
      }

      const sp = specialCellAt(x, y);
      if (sp) {
        const se = document.createElement("div");
        const owner = sp.ownerName || "KOGA";
        if (sp.type === "fire") {
          se.className = "fire";
          se.title = `Case en feu (${owner}) : 1 dégât au passage`;
        } else if (sp.type === "heal") {
          se.className = "special-heal";
          se.textContent = "✚";
          se.title = `Case soin (${owner}) : +1 PV au passage`;
        } else if (sp.type === "speed") {
          se.className = "special-speed";
          se.textContent = "⚡";
          se.title = `Case de vitesse (${owner}) : double la mobilité restante si on s'y arrête`;
        } else {
          se.className = "special-block";
          se.textContent = "✖";
          se.title = `Case vide (${owner}) : impossible de s'y arrêter ou de la traverser`;
        }
        cell.appendChild(se);
      }

      if (edgeWalled(x, y, x, y - 1)) {
        const bar = document.createElement("div");
        bar.className = "ewall ewall-h";
        if (arkWallBetween(x, y, x, y - 1)) {
          bar.classList.add("ewall-ark");
          bar.title = "Mur d'ARK (1 PV) — attaquable";
        }
        cell.appendChild(bar);
      }
      if (edgeWalled(x, y, x - 1, y)) {
        const bar = document.createElement("div");
        bar.className = "ewall ewall-v";
        if (arkWallBetween(x, y, x - 1, y)) {
          bar.classList.add("ewall-ark");
          bar.title = "Mur d'ARK (1 PV) — attaquable";
        }
        cell.appendChild(bar);
      }

      if (editMode) {
        const strip = (cls, title, fn) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "estrip " + cls;
          b.title = title;
          b.addEventListener("click", (e) => {
            e.stopPropagation();
            fn();
          });
          return b;
        };
        cell.appendChild(strip("estrip estrip-top", "Ajouter / retirer le mur en haut", () => toggleEditWall(x, y, x, y - 1)));
        cell.appendChild(strip("estrip estrip-right", "Ajouter / retirer le mur à droite", () => toggleEditWall(x, y, x + 1, y)));
        cell.appendChild(strip("estrip estrip-bottom", "Ajouter / retirer le mur en bas", () => toggleEditWall(x, y, x, y + 1)));
        cell.appendChild(strip("estrip estrip-left", "Ajouter / retirer le mur à gauche", () => toggleEditWall(x, y, x - 1, y)));
        const fb = strip("efire", "Ajouter / retirer le feu", () => toggleEditFire(x, y));
        fb.textContent = "♨";
        cell.appendChild(fb);
        const hb = strip("eheal", "Ajouter / retirer la case de soin", () => toggleEditCellList("healCells", x, y));
        hb.textContent = "✚";
        cell.appendChild(hb);
        const sb = strip("espeed", "Ajouter / retirer la case de vitesse", () => toggleEditCellList("speedCells", x, y));
        sb.textContent = "⚡";
        cell.appendChild(sb);
        const vb = strip("evoid", "Ajouter / retirer la case de vide", () => toggleEditCellList("voidCells", x, y));
        vb.textContent = "∅";
        cell.appendChild(vb);
      }

      ["A", "B"].forEach((player) => {
        const o = objectiveDef(player);
        if (state.phase === "placement" && !state.objectivePos[player]) return;
if (x === o.x && y === o.y) {
          const ratio = Math.max(0, Math.min(1, state.objectives[player] / o.hp));
          const obj = document.createElement("div");
          obj.className = "objective objective-" + player.toLowerCase();
          if (ratio <= 0.34) obj.classList.add("nx-hurt-2");
          else if (ratio <= 0.67) obj.classList.add("nx-hurt-1");
          if (ratio <= 0) obj.classList.add("nx-dead");
          obj.style.setProperty("--hp", String(ratio));
          obj.innerHTML = NEXUS_SVG;
          obj.title = `Objectif de l'équipe ${player} - ${state.objectives[player]}/${o.hp} PV`;
          cell.appendChild(obj);
          const ohp = document.createElement("div");
          ohp.className = "objective-hp objective-hp-" + player.toLowerCase();
          ohp.textContent = `${state.objectives[player]}/${o.hp}`;
          ohp.title = `Points de vie de l'objectif de l'équipe ${player}`;
          cell.appendChild(ohp);
        }
      });

      if (reachSet.has(`${x},${y}`)) cell.classList.add("reachable");
      if (atkSet.has(`${x},${y}`)) cell.classList.add("attackable");
      if (scrabTok && inScrabGelZone(scrabTok.x, scrabTok.y, x, y)) cell.classList.add("scrab-zone");
      if (scrabTargetSet.has(`${x},${y}`)) cell.classList.add("scrab-target");
      if (jayAura.has(`${x},${y}`)) cell.classList.add("jay-aura");
      if (xixzAura.has(`${x},${y}`)) cell.classList.add("xixz-aura");
      if (se7enSet.has(`${x},${y}`)) cell.classList.add("se7en-target");
      if (allyHealSet.has(`${x},${y}`)) cell.classList.add("ally-heal-target");
      if (calixRangeSet.has(`${x},${y}`)) cell.classList.add("calix-range");

      const toks = occupied[`${x},${y}`];
      if (toks) {
        toks.forEach((t, i) => {
          const tok = document.createElement("div");
          tok.className = `token player-${t.player}`;
          tok.textContent = charById(t.charId).name.slice(0, 8);
          if (t.charId === "calix") {
            const brick = document.createElement("span");
            brick.className = "token-brick";
            brick.textContent = "🧱";
            brick.title = "Création";
            tok.appendChild(brick);
          }
          if (t.charId === "fakie") {
            tok.classList.add("token-fakie");
            tok.dataset.name = tok.textContent;
          }
          tok.title = `${charById(t.charId).name} — ${t.hp}/${charById(t.charId).hp} PV`;
          if (t.id === selectedTokenId) tok.classList.add("selected");
          if (i > 0) tok.style.transform = `translate(${i * 9}px, ${i * 9}px)`;
          tok.addEventListener("click", (e) => {
            e.stopPropagation();
            handleTokenClick(t);
          });
          const fxHitEnt = fx.hits.find((h) => h.id === t.id);
          const fxDeadEnt = fx.deaths.includes(t.id);
          const fxHealEnt = fx.heals.find((h) => h.id === t.id);
          const fxCasterEnt = fx.casters.includes(t.id);
          const fxAbiEnt = fx.abilities.includes(t.id);
          const fxEnterEnt = fx.entered.includes(t.id);
          const AURA_MAP = { jay: "aura-jay", rapido: "aura-rapido", xixz: "aura-xixz" };
          if (AURA_MAP[t.charId] && (t.charId !== "jay" || t.jayAura)) tok.classList.add("aura", AURA_MAP[t.charId]);
          if (t.buffs.abyss) tok.classList.add("buff-abyss");
          if (t.buffs.braut) tok.classList.add("buff-braut");
          if (t.buffs.vini) tok.classList.add("buff-vini");
          if (fxEnterEnt) tok.classList.add("anim-spawn");
          if (fxHitEnt) {
            tok.classList.add("anim-hit");
            if (fxHitEnt.dmg > 0) {
              const dm = document.createElement("span");
              dm.className = "dmg-float";
              dm.textContent = "-" + fxHitEnt.dmg;
              tok.appendChild(dm);
            }
          }
          if (fxDeadEnt) tok.classList.add("anim-death");
          if (fxHealEnt) {
            tok.classList.add("anim-heal");
            const hm = document.createElement("span");
            hm.className = "heal-float";
            hm.textContent = "+" + fxHealEnt.amount;
            tok.appendChild(hm);
          }
          if (fxCasterEnt) tok.classList.add("anim-lunge");
          if (fxAbiEnt) {
            tok.classList.add("anim-cast");
            const br = document.createElement("span");
            br.className = "fx-ring";
            br.style.setProperty("--cast-color", CAST_COLORS[t.charId] || "#c5d3e8");
            tok.appendChild(br);
          }
if (t.charId === "guard") {
            tok.textContent = "";
            const guy = document.createElement("div");
            guy.className = "guard-guy";
            const armL = document.createElement("span");
            armL.className = "guard-arm arm-l";
            const armR = document.createElement("span");
            armR.className = "guard-arm arm-r";
            const legL = document.createElement("span");
            legL.className = "guard-leg leg-l";
            const legR = document.createElement("span");
            legR.className = "guard-leg leg-r";
            const belly = document.createElement("span");
            belly.className = "guard-belly";
            const nm = document.createElement("span");
            nm.className = "guard-name";
            nm.textContent = charById(t.charId).name.slice(0, 8);
            const head = document.createElement("span");
            head.className = "guard-head";
            const dotL = document.createElement("span");
            dotL.className = "guard-dot dot-l";
            const dotR = document.createElement("span");
            dotR.className = "guard-dot dot-r";
            head.appendChild(dotL);
            head.appendChild(dotR);
            belly.appendChild(nm);
            guy.appendChild(armL);
            guy.appendChild(armR);
            guy.appendChild(legL);
            guy.appendChild(legR);
            guy.appendChild(belly);
            guy.appendChild(head);
            tok.appendChild(guy);
          }
          if (t.charId === "rapido") {
            const arrows = document.createElement("div");
            arrows.className = "rapido-arrows";
            for (let k = 1; k <= 3; k++) {
              const a = document.createElement("span");
              a.className = "rapido-arrow r" + k;
              arrows.appendChild(a);
            }
            tok.appendChild(arrows);
          }
          if (t.charId === "braut") {
            const mouth = document.createElement("div");
            mouth.className = "braut-mouth";
            const lips = document.createElement("span");
            lips.className = "braut-lips";
            const hole = document.createElement("span");
            hole.className = "braut-mouth-hole";
            const teeth = document.createElement("span");
            teeth.className = "braut-teeth";
            const tongue = document.createElement("span");
            tongue.className = "braut-tongue";
            hole.appendChild(teeth);
            hole.appendChild(tongue);
            mouth.appendChild(lips);
            mouth.appendChild(hole);
            tok.appendChild(mouth);
          }
          if (t.charId === "prince") {
            const rain = document.createElement("div");
            rain.className = "prince-rain";
            const drops = [8, 20, 34, 48, 62, 76, 90];
            drops.forEach((left, i) => {
              const d = document.createElement("span");
              d.className = "prince-drop";
              d.style.left = left + "%";
              d.style.animationDelay = (i * 0.11).toFixed(2) + "s";
              rain.appendChild(d);
            });
            tok.appendChild(rain);
          }
if (t.charId === "cazou") {
            tok.textContent = "";
            const pack = document.createElement("div");
            pack.className = "cazou-puppets";
            const hand = document.createElement("span");
            hand.className = "cazou-hand";
            pack.appendChild(hand);
            const letters = charById(t.charId).name.split("");
            const tops = [54, 46, 40, 46, 54];
            const lefts = [9, 27, 45, 63, 81];
            letters.forEach((ch, i) => {
              const str = document.createElement("span");
              str.className = "cazou-string";
              const sx = 50;
              const sy = 15;
              const dx = lefts[i] - sx;
              const dy = (tops[i] - 8) - sy;
              const len = Math.sqrt(dx * dx + dy * dy);
              const ang = Math.atan2(dx, dy) * 180 / Math.PI;
              str.style.left = sx + "%";
              str.style.top = sy + "%";
              str.style.height = Math.max(6, len) + "%";
              str.style.transform = `translateX(-50%) rotate(${ang}deg)`;
              const pup = document.createElement("span");
              pup.className = "cazou-puppet";
              pup.textContent = ch;
              pup.style.left = lefts[i] + "%";
              pup.style.top = tops[i] + "%";
              pup.style.animationDelay = (i * 0.18).toFixed(2) + "s";
              pack.appendChild(str);
              pack.appendChild(pup);
            });
            tok.appendChild(pack);
          }
          if (t.charId === "dicrum") {
            const scope = document.createElement("div");
            scope.className = "dicrum-scope";
            const ticks = [
              ["n"], ["s"], ["e"], ["w"]
            ];
            ticks.forEach(([pos]) => {
              const t = document.createElement("span");
              t.className = "dicrum-tick tick-" + pos;
              scope.appendChild(t);
            });
            tok.appendChild(scope);
          }
          if (t.charId === "betta") {
            const heart = document.createElement("div");
            heart.className = "betta-heart";
            tok.appendChild(heart);
          }
          if (t.charId === "moms") {
            const heart = document.createElement("div");
            heart.className = "betta-heart moms-heart";
            tok.appendChild(heart);
          }
          if (t.charId === "ranium") {
            const cloud = document.createElement("div");
            cloud.className = "ranium-cloud";
            tok.appendChild(cloud);
            const drop = document.createElement("div");
            drop.className = "ranium-drop";
            drop.dataset.count = String(t.poison || 0);
            if ((t.poison || 0) > 0) {
              for (let k = 0; k < Math.min(3, t.poison); k++) {
                const b = document.createElement("span");
                b.className = "ranium-bubble b" + k;
                drop.appendChild(b);
              }
            }
            tok.appendChild(drop);
          }
          if ((t.poison || 0) > 0) {
            const badge = document.createElement("div");
            badge.className = "poison-badge";
            badge.textContent = "☠ " + t.poison;
            badge.title = `Empoisonné : ${t.poison} dégât(s) par tour`;
            tok.appendChild(badge);
          }
          if (t.charId === "ad") {
            const plus = document.createElement("div");
            plus.className = "ad-plus";
            const v = document.createElement("span");
            v.className = "ad-stem ad-v";
            const h = document.createElement("span");
            h.className = "ad-stem ad-h";
            plus.appendChild(v);
            plus.appendChild(h);
            tok.appendChild(plus);
          }
          if (t.charId === "scrab") {
            const snow = document.createElement("div");
            snow.className = "scrab-snow";
            for (let k = 0; k < 3; k++) {
              const arm = document.createElement("span");
              arm.className = "scrab-snow-arm arm" + k;
              snow.appendChild(arm);
            }
            const hub = document.createElement("span");
            hub.className = "scrab-snow-hub";
            snow.appendChild(hub);
            tok.appendChild(snow);
          }
          if (t.charId === "koga") {
            const branches = document.createElement("div");
            branches.className = "koga-branches";
            for (let k = 1; k <= 4; k++) {
              const b = document.createElement("span");
              b.className = "koga-branch b" + k;
              branches.appendChild(b);
            }
            tok.appendChild(branches);
          }
          if (t.charId === "ark") {
            const skull = document.createElement("div");
            skull.className = "ark-skull";
            const head = document.createElement("span");
            head.className = "ark-skull-head";
            const el = document.createElement("span");
            el.className = "ark-skull-eye eye-l";
            const er = document.createElement("span");
            er.className = "ark-skull-eye eye-r";
            const nose = document.createElement("span");
            nose.className = "ark-skull-nose";
            const teeth = document.createElement("span");
            teeth.className = "ark-skull-teeth";
            skull.appendChild(head);
            skull.appendChild(el);
            skull.appendChild(er);
            skull.appendChild(nose);
            skull.appendChild(teeth);
            tok.appendChild(skull);
          }
          if (t.charId === "abyss") {
            const waves = document.createElement("div");
            waves.className = "abyss-waves";
            for (let k = 1; k <= 3; k++) {
              const w = document.createElement("span");
              w.className = "w" + k;
              waves.appendChild(w);
            }
            tok.appendChild(waves);
          }
          if (t.charId === "jay") {
            const eye = document.createElement("div");
            eye.className = "jay-eye";
            const core = document.createElement("span");
            core.className = "jay-eye-core";
            eye.appendChild(core);
            tok.appendChild(eye);
          }
          if (t.charId === "xixz") {
            const shield = document.createElement("div");
            shield.className = "xixz-shield";
            shield.title = "Pacif : -1 dégât pour les alliés dans l'aura 3×3";
            shield.innerHTML = '<span class="xixz-shield-core">✚</span>';
            tok.appendChild(shield);
          }
          if (t.charId === "se7en") {
            const chip = document.createElement("div");
            chip.className = "se7en-chip";
            chip.innerHTML =
              '<span class="se7en-chip-corner tl">♠</span>' +
              '<span class="se7en-chip-corner br">♣</span>' +
              '<span class="se7en-chip-face">7</span>';
            chip.title = "Se7en — jeton de poker";
            tok.appendChild(chip);
          }
          if (t.charId === "vini") {
            const gl = document.createElement("div");
            gl.className = "vini-glasses";
            const l1 = document.createElement("span");
            l1.className = "vini-glasses-lens lens-l";
            const b = document.createElement("span");
            b.className = "vini-glasses-bridge";
            const l2 = document.createElement("span");
            l2.className = "vini-glasses-lens lens-r";
            gl.appendChild(l1);
            gl.appendChild(b);
            gl.appendChild(l2);
            tok.appendChild(gl);
          }
          if (t.hp < charById(t.charId).hp) {
            const hpEl = document.createElement("span");
            hpEl.className = "token-hp";
            hpEl.textContent = t.hp;
            tok.appendChild(hpEl);
          }
          if (t.cd > 0) {
            const cdEl = document.createElement("span");
            cdEl.className = "token-cd";
            cdEl.textContent = "Cd " + t.cd;
            tok.appendChild(cdEl);
          }
          if ((t.stunned || 0) > 0) {
            tok.classList.add("token-stunned");
            const st = document.createElement("span");
            st.className = "stun-badge";
            tok.appendChild(st);
          }
          if ((t.bettaRegen || 0) > 0) {
            const rg = document.createElement("span");
            rg.className = "token-regen";
            rg.textContent = "✚";
            rg.title = `Enchantement de BETTA — ${Math.max(0, t.bettaRoundsLeft || 0)} manche(s) restante(s)`;
            tok.appendChild(rg);
          }
          cell.appendChild(tok);
        });
      }

      fx.cellFx.forEach((cf) => {
        if (cf.x === x && cf.y === y) {
          const ov = document.createElement("div");
          ov.className = "cell-fx fx-" + cf.kind;
          cell.appendChild(ov);
        }
      });

      fx.deaths.forEach((id) => {
        const dt = state.tokens.find((t) => t.id === id);
        if (dt && dt.x === x && dt.y === y) {
          const ghost = document.createElement("div");
          ghost.className = `token player-${dt.player} anim-death`;
          ghost.textContent = charById(dt.charId).name.slice(0, 8);
          cell.appendChild(ghost);
        }
      });

      cell.addEventListener("click", () => cellClick(x, y));
      cell.addEventListener("mouseenter", () => showPathPreview(x, y));
      cell.addEventListener("mouseleave", clearPathPreview);
      board.appendChild(cell);
    }
  }

  if (pendingSpawn) {
    freeSpawnCells(pendingSpawn.player).forEach(([sx, sy]) => {
      const el = board.querySelector(`.cell[data-x="${sx}"][data-y="${sy}"]`);
      if (el) el.classList.add("spawn-choice");
    });
  }

  /* Manipulation de CAZOU : 1er clic = surligne les champions adverses
     cliquables, 2e clic = surligne les cases libres de destination. */
  if (pendingAbility && pendingAbility.type === "cazou") {
    const cazou = tokenById(pendingAbility.tokenId);
    if (cazou) {
      if (!pendingAbility.selected) {
        state.tokens
          .filter((t) => !t.dead && t.player !== cazou.player)
          .forEach((t) => {
            const el = board.querySelector(`.cell[data-x="${t.x}"][data-y="${t.y}"]`);
            if (el) el.classList.add("cazou-pick");
          });
      } else {
        for (let cy = 0; cy < GAME.map.rows; cy++) {
          for (let cx = 0; cx < GAME.map.cols; cx++) {
            if (!cazouCellFree(cx, cy, cazou.player)) continue;
            const el = board.querySelector(`.cell[data-x="${cx}"][data-y="${cy}"]`);
            if (el) el.classList.add("cazou-cell");
          }
        }
      }
    }
  }

  const turnLabel = document.getElementById("turn-label");
  if (state.phase === "placement") {
    turnLabel.textContent = `Placement — Équipe ${state.placingPlayer}`;
    turnLabel.className = "player-" + state.placingPlayer.toLowerCase();
  } else {
    const shrinkNext = nextShrinkInfo();
    const shrinkHint = shrinkNext ? ` · Feu au tour ${shrinkNext.round}` : "";
    turnLabel.textContent = state.winner
      ? (state.winner === "draw" ? "Match nul !" : `Victoire de l'équipe ${state.winner} !`)
      : `Tour ${state.turnCount} — Équipe ${state.turn}${shrinkHint}`;
    turnLabel.className = "player-" + state.turn.toLowerCase();
  }

  const objEl = document.getElementById("objective-hp");
  if (isRampage()) {
    objEl.style.display = "none";
  } else {
    objEl.style.display = "";
    objEl.innerHTML = `
    Objectif <span class="player-a-txt">A</span> : <strong class="a">${state.objectives.A}</strong>/${GAME.objectives.A.hp}
    &nbsp;·&nbsp;
    Objectif <span class="player-b-txt">B</span> : <strong class="b">${state.objectives.B}</strong>/${GAME.objectives.B.hp}
  `;
  }
  const win = document.getElementById("win-overlay");
  win.classList.toggle("show", !!state.winner);
  win.classList.toggle("team-a", state.winner === "A");
  win.classList.toggle("team-b", state.winner === "B");
  if (state.winner) {
    const winTitle = win.querySelector("h2");
    const winText = win.querySelector(".win-text");
    if (state.winner === "draw") {
      winTitle.textContent = "Match nul !";
      winText.textContent = "Les deux objectifs ont été détruits par le feu au même moment.";
    } else {
      winTitle.textContent = `Victoire de l'équipe ${state.winner} !`;
      winText.textContent = isRampage()
        ? `L'équipe ${state.winner} élimine tous les champions adverses et remporte la partie !`
        : `L'équipe ${state.winner} détruit l'objectif adverse et remporte la partie !`;
    }
  }

  const blockBtn = document.getElementById("reserve-block");
  blockBtn.classList.toggle("active", state.healingBlocked);
  blockBtn.textContent = state.healingBlocked
    ? "Soins bloqués (PRINCE)"
    : "Activer le blocage des soins";

  const nextBtn = document.getElementById("next-turn");
  nextBtn.disabled = state.phase === "placement" || !!state.winner;
  nextBtn.textContent = state.phase === "placement"
    ? "Placement en cours…"
    : "Passer au tour suivant";

  if (fx.rapidoEnter) {
    const sx = fx.rapidoEnter.x;
    const sy = fx.rapidoEnter.y;
    const spots = [[sx, sy]];
    const tryAdd = (dx, dy) => {
      const nx = sx + dx;
      const ny = sy + dy;
      if (nx >= 0 && ny >= 0 && nx < GAME.map.cols && ny < GAME.map.rows) spots.push([nx, ny]);
    };
    tryAdd(-1, 0); tryAdd(1, 0); tryAdd(0, -1); tryAdd(0, 1);
    spots.forEach(([bx, by]) => {
      const boltCell = board.querySelector(`.cell[data-x="${bx}"][data-y="${by}"]`);
      if (boltCell) {
        const ov = document.createElement("div");
        ov.className = "cell-fx fx-bolt";
        boltCell.appendChild(ov);
      }
    });
    const bn = document.createElement("div");
    bn.className = "rapido-banner";
    bn.textContent = "Rapide comme l'éclair";
    document.body.appendChild(bn);
    setTimeout(() => bn.remove(), 1100);
  }

  if (state.healingBlocked) {
    const overlay = document.createElement("div");
    overlay.className = "board-rain";
    for (let i = 0; i < 46; i++) {
      const d = document.createElement("span");
      d.className = "board-drop";
      d.style.left = ((i * 37 + 11) % 100) + "%";
      d.style.animationDelay = ((i * 0.09) % 1.4).toFixed(2) + "s";
      d.style.animationDuration = (0.85 + (i % 3) * 0.18).toFixed(2) + "s";
      d.style.setProperty("--fall-dist", board.clientHeight + 60 + "px");
      overlay.appendChild(d);
    }
    board.appendChild(overlay);
    const rainBadge = document.createElement("div");
    rainBadge.className = "rain-badge";
    rainBadge.textContent = "🌧 Aucun soin possible";
    rainBadge.title = "Purple Rain de PRINCE : tous les soins sont bloqués jusqu'à une élimination.";
    board.appendChild(rainBadge);
  }

  renderRosters();
  renderLog();
  updateHeartbeat();
  updatePlacementBanner();
  fx = emptyFx();

  if (lanMode && lanRole === "host" && lanConnected && !lanApplying && !onlineSetupPhase) {
    lanBroadcast();
  }
}

function inSpawnZone(player, x, y) {
  return GAME.startZones[player].some(([sx, sy]) => sx === x && sy === y);
}

function objectiveCellAt(x, y) {
  return ["A", "B"].some((p) => {
    const pos = state.objectivePos ? state.objectivePos[p] : null;
    return pos && pos.x === x && pos.y === y;
  });
}

function cellPlaceable(x, y) {
  if (state.phase !== "placement") return false;
  const player = state.placingPlayer;
  if (state.placement[player]) return false;
  if (!inSpawnZone(player, x, y)) return false;
  if (objectiveCellAt(x, y)) return false;
  if (state.tokens.some((t) => !t.dead && t.x === x && t.y === y)) return false;
  return isPassable(x, y, player);
}

function placeAt(x, y) {
  const player = state.placingPlayer;
  if (state.placement[player]) return;
  if (!inSpawnZone(player, x, y)) {
    alert(`Choisissez une case dans la zone de départ de l'équipe ${player}.`);
    return;
  }
  if (!isPassable(x, y, player)) {
    alert("Case occupée par un obstacle.");
    return;
  }
  if (state.tokens.some((t) => !t.dead && t.x === x && t.y === y)) {
    alert("Case déjà occupée par un champion.");
    return;
  }
  if (objectiveCellAt(x, y)) {
    alert("Un objectif est déjà posé sur cette case.");
    return;
  }
  pushUndo();

  if (state.placingStage === "objective") {
    if (state.objectivePos[player]) {
      alert("Objectif déjà placé.");
      return;
    }
    state.objectivePos[player] = { x, y };
    state.placingStage = "champion";
    fxCell(x, y, "objective");
    log(`Équipe ${player} place son objectif en (${x + 1}, ${y + 1}).`);
  } else {
    const queue = state.placingQueue[player];
    if (!queue.length) return;
    const charId = queue.shift();
    const c = charById(charId);
    const newId = `${player}-${charId}-${Date.now()}`;
    state.tokens.push({
      id: newId,
      charId,
      player,
      x,
      y,
      hp: c.hp,
      dead: false,
      cd: 0,
      hasMoved: false,
      hasAttacked: false,
      abilityUsed: false,
      buffs: { abyss: false, braut: false },
      scrabTaken: 0,
      poison: 0,
      jayAura: false,
      jayAuraTurns: 0,
      rainActive: false
    });
    fxEnter(newId);
    log(`Équipe ${player} place ${c.name} en (${x + 1}, ${y + 1}).`);
    if (!queue.length) {
      state.placingStage = isRampage() ? "champion" : "objective";
      state.placement[player] = true;
      if (player === "A") {
        state.placingPlayer = "B";
        log(isRampage()
          ? "Équipe A terminée. Équipe B : placez vos 3 champions."
          : "Équipe A terminée. Équipe B : placez votre objectif puis vos titulaires.");
      } else {
        state.phase = "playing";
        state.placingPlayer = "A";
        log(isRampage() ? "Placement terminé. La partie Rampage commence !" : "Placement terminé. La partie commence !");
      }
    }
  }
  save();
  renderBoard();
}

function updatePlacementBanner() {
  const banner = document.getElementById("placement-banner");
  if (!banner) return;
  if (state.phase !== "placement") {
    banner.style.display = "none";
    return;
  }
  banner.style.display = "block";
  banner.className = "player-" + state.placingPlayer.toLowerCase();
  const player = state.placingPlayer;
  const queue = state.placingQueue[player] || [];
  const upcoming = queue.length ? ` Titulaires à poser ensuite : ${queue.map((id) => charById(id).name).join(", ")}.` : "";
  if (state.placingStage === "objective") {
    banner.textContent = `Placement — Équipe ${player} : cliquez sur une case libre de votre zone pour poser votre OBJECTIF ◆${upcoming}`;
  } else {
    banner.textContent = `Placement — Équipe ${player} : placez ${queue.length} champion(s) restant(s) : ${queue.map((id) => charById(id).name).join(", ")}`;
  }
}

function toggleEditWall(x1, y1, x2, y2) {
  if (x2 < 0 || y2 < 0 || x2 >= GAME.map.cols || y2 >= GAME.map.rows) return;
  const key = edgeKey(x1, y1, x2, y2);
  const idx = GAME.map.edgesWalls.indexOf(key);
  if (idx >= 0) GAME.map.edgesWalls.splice(idx, 1);
  else GAME.map.edgesWalls.push(key);
  GAME.edgeSet = new Set(GAME.map.edgesWalls);
  persistActiveMapEdits();
  renderBoard();
}

function toggleEditFire(x, y) {
  const idx = GAME.map.fireCells.findIndex(([fx, fy]) => fx === x && fy === y);
  if (idx >= 0) GAME.map.fireCells.splice(idx, 1);
  else GAME.map.fireCells.push([x, y]);
  persistActiveMapEdits();
  renderBoard();
}

function toggleEditCellList(list, x, y) {
  const arr = (GAME.map[list] = GAME.map[list] || []);
  const idx = arr.findIndex(([cx, cy]) => cx === x && cy === y);
  if (idx >= 0) arr.splice(idx, 1);
  else arr.push([x, y]);
  persistActiveMapEdits();
  renderBoard();
}

function canAttackAt(x, y) {
  return attackCells.some(([ax, ay]) => ax === x && ay === y);
}

function handleTokenClick(t) {
  if (busy) return;
  if (editMode) return;
  if (pendingAbility) {
    resolvePendingOnCell(t.x, t.y);
    return;
  }
  if (state.phase === "placement" || state.winner) {
    openCharDialog(charById(t.charId), t.hp);
    return;
  }
  if (selectedTokenId) {
    const sel = tokenById(selectedTokenId);
    if (sel && sel.player !== t.player && canAttackAt(t.x, t.y)) {
      attackAt(t.x, t.y);
      return;
    }
  }
  if (t.player === state.turn && !t.dead) {
    if ((t.stunned || 0) > 0) {
      openCharDialog(charById(t.charId), t.hp);
      return;
    }
    if (selectedTokenId === t.id) {
      deselect();
      return;
    }
    selectToken(t.id);
    return;
  }
  openCharDialog(charById(t.charId), t.hp);
}

function cellClick(x, y) {
  if (busy) return;
  if (editMode) return;
  if (pendingSpawn) {
    commitSpawnPlacement(x, y);
    return;
  }
  if (state.phase === "placement") {
    placeAt(x, y);
    return;
  }
  if (state.winner) {
    alert("La partie est terminée. Relancez une partie.");
    return;
  }
  if (pendingAbility) {
    resolvePendingOnCell(x, y);
    return;
  }
  if (selectedTokenId) {
    const stok = tokenById(selectedTokenId);
    if (stok && canAttackAt(x, y) && arkWallBetween(stok.x, stok.y, x, y)) {
      attackAt(x, y);
      return;
    }
  }
  if (selectedTokenId && reachable.some(([rx, ry]) => rx === x && ry === y)) {
    moveToken(selectedTokenId, x, y);
    return;
  }
  if (selectedTokenId && canAttackAt(x, y)) {
    attackAt(x, y);
    return;
  }
  const tok = state.tokens.find((t) => !t.dead && t.x === x && t.y === y && t.player === state.turn);
  if (tok) selectToken(tok.id);
  else if (selectedTokenId) deselect();
}

function selectToken(id) {
  const tok = tokenById(id);
  if (!tok) return;
  selectedTokenId = id;
  if (isTurnOf(tok.player)) {
    const spent = tok.hasAttacked || tok.abilityUsed;
    const frozen = state.guardZones.some((z) => Math.abs(z.x - tok.x) <= 1 && Math.abs(z.y - tok.y) <= 1);
    reachable = frozen || tok.abilityUsed ? [] : reachableFrom(tok.x, tok.y, movementBudget(tok), tok.player);
    attackCells = spent ? [] : attackCellsOf(tok);
  } else {
    reachable = [];
    attackCells = [];
  }
  pendingAbility = null;
  renderBoard();
}

function deselect() {
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
  renderBoard();
}

/* ---------- Rétrécissement de la carte (zone de feu) ----------
   Le feu gagne du terrain par couches, à la fin d'un TOUR COMPLET (A+B).
   Barème : 10 (longueur 1), 20 (longueur 2), 25 (largeur 1),
   30 (longueur 3), 35 (largeur 2), 45 (largeur 3).
   "longueur" = bords haut/bas, "largeur" = bords gauche/droite. */
const SHRINK_SCHEDULE = [
  { round: 10, axis: "length", layer: 1 },
  { round: 20, axis: "length", layer: 2 },
  { round: 25, axis: "width", layer: 1 },
  { round: 30, axis: "length", layer: 3 },
  { round: 35, axis: "width", layer: 2 },
  { round: 45, axis: "width", layer: 3 }
];

/* Rampage : le feu démarre au tour 3 puis avance tous les 3 tours. */
const SHRINK_SCHEDULE_RAMPAGE = [
  { round: 3, axis: "length", layer: 1 },
  { round: 6, axis: "length", layer: 2 },
  { round: 9, axis: "width", layer: 1 },
  { round: 12, axis: "length", layer: 3 },
  { round: 15, axis: "width", layer: 2 },
  { round: 18, axis: "width", layer: 3 }
];

function activeShrinkSchedule() {
  return isRampage() ? SHRINK_SCHEDULE_RAMPAGE : SHRINK_SCHEDULE;
}

function shrinkCellsFor(entry) {
  const cells = [];
  const rows = GAME.map.rows;
  const cols = GAME.map.cols;
  const i = entry.layer - 1;
  if (entry.axis === "length") {
    var l1 = [i, rows - 1 - i];
    for (var a = 0; a < l1.length; a++) {
      var yy = l1[a];
      if (yy < 0 || yy >= rows) continue;
      for (var x = 0; x < cols; x++) cells.push([x, yy]);
    }
  } else {
    var w1 = [i, cols - 1 - i];
    for (var b = 0; b < w1.length; b++) {
      var xx = w1[b];
      if (xx < 0 || xx >= cols) continue;
      for (var y = 0; y < rows; y++) cells.push([xx, y]);
    }
  }
  return cells;
}

let _burnCache = null;
let _burnCacheKey = "";
function burnedCellSet() {
  const key = (state && state.shrinkStep) + "|" + (state && state.mode) + "|" + (GAME.activeMap || "") + "|" + (GAME.map.cols || 0) + "x" + (GAME.map.rows || 0);
  if (_burnCacheKey !== key) {
    _burnCache = new Set();
    const s = state && state.shrinkStep || 0;
    const schedule = activeShrinkSchedule();
    for (let k = 0; k < s && k < schedule.length; k++) {
      shrinkCellsFor(schedule[k]).forEach(([x, y]) => _burnCache.add(x + "," + y));
    }
    _burnCacheKey = key;
  }
  return _burnCache;
}

function isBurned(x, y) {
  return burnedCellSet().has(x + "," + y);
}

/* Couche qui va s'embraser : prévenue un tour (complet) à l'avance. */
function dangerCellSet() {
  var mapSet = {};
  var arr = [];
  try {
    if (typeof state === "undefined" || typeof SHRINK_SCHEDULE === "undefined") {
      return { size: 0, has: function () { return false; } };
    }
    if (!state) return { size: 0, has: function () { return false; } };
    var step = state.shrinkStep;
    if (step < 0) step = 0;
    var next = activeShrinkSchedule()[step];
    if (!next) return { size: 0, has: function () { return false; } };
    var tcount = (typeof state.turnCount === "number") ? state.turnCount : 0;
    var diff = next.round - tcount;
    if (diff > 1 || diff < 0) return { size: 0, has: function () { return false; } };
    var cells = shrinkCellsFor(next);
    for (var i = 0; i < cells.length; i++) {
      var c = cells[i];
      var k = c[0] + "," + c[1];
      if (!mapSet[k]) {
        mapSet[k] = true;
        arr.push(k);
      }
    }
  } catch (e) {
    return { size: 0, has: function () { return false; } };
  }
  return {
    size: arr.length,
    has: function (k) { return mapSet[k] === true; }
  };
}

function nextShrinkInfo() {
  return activeShrinkSchedule()[state.shrinkStep] || null;
}

/* Le feu frappe les objectifs de façon symétrique : dès que l'un des deux
   objectifs est atteint par le feu, les DEUX subissent 1 dégât au même moment,
   afin qu'aucun ne meure avant l'autre (égalité au temps). */
function burnObjectivesSimultaneous() {
  var sides = ["A", "B"];
  var anyFire = false;
  for (var i = 0; i < sides.length; i++) {
    var s = sides[i];
    var pos = state.objectivePos ? state.objectivePos[s] : null;
    if (!pos) continue;
    if (state.objectives[s] <= 0) continue;
    if (isFire(pos.x, pos.y)) { anyFire = true; break; }
  }
  if (!anyFire) return;
  for (var j = 0; j < sides.length; j++) {
    var t = sides[j];
    if (state.objectives[t] <= 0) continue;
    state.objectives[t] = Math.max(0, state.objectives[t] - 1);
    log(`L'objectif de l'équipe ${t} est sur une case en feu : 1 dégât (${state.objectives[t]} PV).`);
  }
  if (state.objectives.A <= 0 && state.objectives.B <= 0) {
    if (!state.winner) state.winner = "draw";
    log(`Les deux objectifs sont détruits en même temps par le feu : match nul !`);
  } else if (state.objectives.A <= 0 && !state.winner) {
    state.winner = "B";
    log(`L'objectif de l'équipe A est détruit par le feu ! Victoire de l'équipe B.`);
  } else if (state.objectives.B <= 0 && !state.winner) {
    state.winner = "A";
    log(`L'objectif de l'équipe B est détruit par le feu ! Victoire de l'équipe A.`);
  }
}

/* Applique, en fin de tour complet, toutes les couches dont le tour est atteint. */
function applyShrinkRound(completedRound) {
  const schedule = activeShrinkSchedule();
  while (state.shrinkStep < schedule.length && schedule[state.shrinkStep].round <= completedRound) {
    const ev = schedule[state.shrinkStep];
    state.shrinkStep++;
    if (state.winner) break;
    log(`Le feu gagne du terrain — ${ev.axis === "length" ? "bords haut/bas" : "bords gauche/droite"} (couche ${ev.layer}).`);
    if (state.winner) break;
  }
}

function isFire(x, y) {
  if ((GAME.map.fireCells || []).some(([fx, fy]) => fx === x && fy === y)) return true;
  const sp = specialCellAt(x, y);
  if (sp && sp.type === "fire") return true;
  return isBurned(x, y);
}

function specialCellAt(x, y) {
  return (state.specialCells || []).find((s) => s.x === x && s.y === y) || null;
}

function isHealCell(x, y) {
  return (GAME.map.healCells || []).some(([hx, hy]) => hx === x && hy === y);
}

function isSpeedCell(x, y) {
  if ((GAME.map.speedCells || []).some(([sx, sy]) => sx === x && sy === y)) return true;
  const sp = specialCellAt(x, y);
  return !!sp && sp.type === "speed";
}

function isVoidCell(x, y) {
  return (GAME.map.voidCells || []).some(([vx, vy]) => vx === x && vy === y);
}

function kogaDeathZone(x, y) {
  const order = ["block", "heal", "fire", "speed"];
  const labels = {
    block: "case vide (impassable)",
    heal: "case soin",
    fire: "case en feu",
    speed: "case de vitesse"
  };
  let type = "block";
  try {
    const ans = prompt(
      "KOGA est éliminé : quelle case laisse-t-il sur sa case de mort ?\n\n" +
        order.map((t, i) => `${i + 1}. ${labels[t]}`).join("\n")
    );
    const idx = parseInt(ans, 10) - 1;
    if (!isNaN(idx) && idx >= 0 && idx < order.length) type = order[idx];
  } catch (e) {}
  (state.specialCells = state.specialCells || []).push({ x, y, type, ownerId: null });
  log(`KOGA laisse une ${labels[type]} sur sa case de mort (${x + 1}, ${y + 1}).`);
  fxCell(x, y, type === "block" ? "earth" : type === "heal" ? "aura" : type === "speed" ? "gold" : "objective");
}

/* ---------- Cases de CALIX ---------- */

const CALIX_QUOTA = { block: 1, fire: 2, heal: 1, speed: 1 };

const CALIX_TYPE_LABEL = {
  block: "vide",
  fire: "en feu",
  heal: "soin",
  speed: "de vitesse"
};

function calixCellsOf(tokenId) {
  return (state.specialCells || []).filter((s) => s.ownerId === tokenId);
}

function calixQuotaLeft(tokenId, type) {
  const used = calixCellsOf(tokenId).filter((s) => s.type === type).length;
  return Math.max(0, (CALIX_QUOTA[type] || 0) - used);
}

function calixAvailableTypes(tokenId) {
  return Object.keys(CALIX_QUOTA).filter((t) => calixQuotaLeft(tokenId, t) > 0);
}

function calixRemoveCells(tokenId) {
  const removed = calixCellsOf(tokenId);
  state.specialCells = (state.specialCells || []).filter((s) => s.ownerId !== tokenId);
  return removed;
}

/* Raison pour laquelle CALIX ne peut pas poser de case ici ("" = placement possible).
   fromTok = lanceur : la case doit obligatoirement être à sa portée (ligne droite,
   aucune diagonale, comme toutes les portées du jeu). */
function calixPlaceBlock(x, y, player, fromTok) {
  if (x < 0 || y < 0 || x >= GAME.map.cols || y >= GAME.map.rows) return "hors du plateau";
  if (fromTok) {
    const c = charById(fromTok.charId);
    if (!inStraightLine(fromTok.x, fromTok.y, x, y, c.range)) return "hors de portée";
  }
  if (GAME.map.tiles[y] && GAME.map.tiles[y][x] === 1) return "mur du terrain";
  if (state.tokens.some((t) => !t.dead && t.x === x && t.y === y)) return "champion présent";
  if (objectiveCellAt(x, y)) return "objectif";
  if (specialCellAt(x, y)) return "case spéciale déjà posée";
  if (state.walls.some((w) => w.x === x && w.y === y)) return "mur de GUARD";
  if (isVoidCell(x, y)) return "case de vide du terrain";
  if (
    (GAME.map.fireCells || []).some(([a, b]) => a === x && b === y) ||
    (GAME.map.healCells || []).some(([a, b]) => a === x && b === y) ||
    (GAME.map.speedCells || []).some(([a, b]) => a === x && b === y)
  ) return "effet de terrain";
  for (const gz of state.guardZones) {
    if (Math.abs(gz.x - x) <= 1 && Math.abs(gz.y - y) <= 1) return "dôme de GUARD";
  }
  return "";
}

function calixCanPlace(x, y, player, fromTok) {
  return calixPlaceBlock(x, y, player, fromTok) === "";
}

/* ---------- Poison de RANIUM ---------- */

/* Un soin (case, JAY, A.D., BETTA, MOM'S, KOGA) dissipe toutes les couches. */
function healToken(tok, amount, source) {
  if (!tok || tok.dead || amount <= 0) return 0;
  const max = charById(tok.charId).hp;
  if (tok.hp >= max) return 0;
  // Purple Rain de PRINCE : aucun soin n'est possible sur le terrain.
  if (state.healingBlocked) {
    log(`Soin impossible : la Purple Rain de PRINCE bloque tous les soins (${source || "source inconnue"}).`);
    return 0;
  }
  const before = tok.hp;
  tok.hp = Math.min(max, tok.hp + amount);
  const gained = tok.hp - before;
  if (gained > 0) clearPoison(tok, source);
  return gained;
}

function clearPoison(tok, source) {
  if (!tok || !(tok.poison > 0)) return;
  const layers = tok.poison;
  tok.poison = 0;
  fxCell(tok.x, tok.y, "aura");
  log(
    `${charById(tok.charId).name} est soigné : le poison de RANIUM se dissipe${source ? " (" + source + ")" : ""} (${layers} couche(s) retirée(s)).`
  );
}

/* Dégâts de poison appliqués au début du tour de la victime. */
function applyPoisonDamage(tok) {
  if (!tok || tok.dead || !(tok.poison > 0)) return;
  const layers = tok.poison;
  log(`${charById(tok.charId).name} subit ${layers} dégât(s) de poison.`);
  applyDamageToToken(tok, layers, null, { poison: true });
}

function kogaAttackHeal(k) {
  if (!k || k.dead) return;
  const c = charById(k.charId);
  if (!c || c.id !== "koga" || k.hp >= c.hp) return;
  if (healToken(k, 1) > 0) {
    fxHeal(k.id, 1);
    log(`KOGA récupère 1 PV après son attaque (${k.hp}/${c.hp} PV).`);
  }
}

/* 1 dégât si (x, y) est une case en feu. `staying` = le champion n'a pas bougé,
   il reste dans le feu au début de son tour. Renvoie vrai si des dégâts ont été infligés. */
function fireAt(tok, x, y, staying) {
  if (!tok || tok.dead) return false;
  if (!isFire(x, y)) return false;
  const name = charById(tok.charId).name;
  log(staying
    ? `${name} (${tok.player}) est toujours sur une case en feu : 1 dégât.`
    : `${name} (${tok.player}) traverse une case en feu : 1 dégât.`);
  applyDamageToToken(tok, 1, null, { terrain: true });
  return true;
}

/* Soins uniquement sur la case où le champion s'arrête (case soin du terrain et
   case soin posée par KOGA ou CALIX). Le feu, lui, se compte par case traversée. */
function healCellKindAt(x, y) {
  if (isHealCell(x, y)) return true;
  const sp = specialCellAt(x, y);
  return !!sp && sp.type === "heal";
}

function healCellOnStop(tok) {
  if (!tok || tok.dead || tok.healCellUsed) return;
  const max = charById(tok.charId).hp;
  if (tok.hp >= max) return;
  const sp = specialCellAt(tok.x, tok.y);
  const isSpecial = !!sp && sp.type === "heal";
  if (!isSpecial && !isHealCell(tok.x, tok.y)) return;
  if (healToken(tok, 1, "case soin") > 0) {
    tok.healCellUsed = true;
    fxHeal(tok.id, 1);
    if (isSpecial) {
      log(`${charById(tok.charId).name} est soigné de 1 PV par une ${sp.ownerName === "CALIX" ? "case de CALIX" : "case soin de KOGA"} (${tok.hp}/${max} PV).`);
    } else {
      log(`${charById(tok.charId).name} est soigné de 1 PV par la case soin (${tok.hp}/${max} PV).`);
    }
  }
}

function checkFire(tok) {
  if (!tok || tok.dead) return;
  fireAt(tok, tok.x, tok.y);
  healCellOnStop(tok);
}

function moveToken(id, x, y) {
  const tok = tokenById(id);
  const c = charById(tok.charId);
  if (tok.abilityUsed) {
    alert(`${c.name} a déjà utilisé sa capacité ce tour : il ne peut plus se déplacer.`);
    return;
  }
  if (cellHasEntity(x, y)) {
    alert("Case déjà occupée par un champion ou un objectif.");
    return;
  }
  const path = pathTo(tok, x, y);
  if (!path) {
    alert(`Aucun trajet possible pour ${c.name} jusqu'à cette case.`);
    return;
  }
  pushUndo();
  const steps = path.length - 1;
  log(`${c.name} (${tok.player}) se déplace en (${x + 1}, ${y + 1}).`);
  tok.x = x;
  tok.y = y;
  const gz = state.guardZones.find((z) => z.ownerId === id);
  if (gz) {
    gz.x = x;
    gz.y = y;
  }
  let left = Math.max(0, movementBudget(tok) - steps);
  if (isSpeedCell(x, y) && speedBoostAvailable(tok) && left > 0) {
    tok.speedUsed = true;
    left = left * 2;
    tok.movLeft = left;
    tok.hasMoved = false;
    log(`${c.name} s'arrête sur une case de vitesse : sa mobilité restante est doublée (${left} case(s) restante(s) pour ce tour).`);
  } else {
    tok.movLeft = left;
    tok.hasMoved = true;
  }
  /* 1 dégât par case de feu traversée : la case de départ n'est pas traversée,
     la case d'arrivée l'est (arrivée et déplacement réel sont le même trajet). */
  for (const [px, py] of path.slice(1)) {
    if (fireAt(tok, px, py) && tok.dead) break;
  }
  if (!tok.dead) healCellOnStop(tok);
  reselectAfter();
}

function reselectAfter() {
  const tok = tokenById(selectedTokenId);
  if (tok) {
    selectedTokenId = null;
    if (!tok.dead && isTurnOf(tok.player)) {
      selectToken(tok.id);
    } else {
      deselect();
    }
  } else {
    deselect();
  }
}

/* ---------- Dégâts et attaques ---------- */

/* Pacif : la cible est-elle un allié protégé par l'aura 3x3 d'un XIXZ vivant ? */
function xixzPacifActive(target) {
  if (target.dead) return false;
  return state.tokens.some((z) => {
    if (z.dead || z.charId !== "xixz") return false;
    if (z.player !== target.player) return false;
    return Math.abs(z.x - target.x) <= 1 && Math.abs(z.y - target.y) <= 1;
  });
}

function applyDamageToToken(target, amount, sourceToken, opts = {}) {
  if (target.dead || amount <= 0) return;
  let dmg = amount;

  if (target.buffs.abyss) {
    dmg = Math.floor(dmg / 2);
    target.buffs.abyss = false;
    log(`${charById(target.charId).name} (${target.player}) réduit les dégâts de moitié (ABYSS) → ${dmg}.`);
  }

  // Pacif de XIXZ : -1 dégât pour les alliés dans l'aura 3x3 (XIXZ inclus).
  // Ne s'applique ni au poison, ni au feu du terrain, ni aux sacrifices sur soi-même.
  if (!opts.poison && !opts.terrain && !opts.self && xixzPacifActive(target)) {
    dmg = Math.max(0, dmg - 1);
    log(`${charById(target.charId).name} (${target.player}) subit 1 dégât de moins (Pacif de XIXZ) → ${dmg}.`);
  }

  const oldHp = target.hp;
  target.hp = Math.max(0, target.hp - dmg);
  log(`${charById(target.charId).name} (${target.player}) subit ${dmg} dégâts (${oldHp}→${target.hp} PV).`);
  fxHit(target.id, dmg);

  if (target.buffs.vini && dmg > 0 && sourceToken && !opts.reflected && sourceToken.id !== target.id) {
    target.buffs.vini = false;
    fxCell(target.x, target.y, "flare");
    fxCell(sourceToken.x, sourceToken.y, "flare");
    log(`${charById(target.charId).name} (VINI) réfléchit les ${dmg} dégâts vers ${charById(sourceToken.charId).name} (effet consommé).`);
    applyDamageToToken(sourceToken, dmg, target, { reflected: true });
  }

if (target.hp <= 0 && !target.dead) {
    target.dead = true;
    if (selectedTokenId === target.id) {
      selectedTokenId = null;
      reachable = [];
      attackCells = [];
    }
    fxDeath(target.id);
    log(`${charById(target.charId).name} (${target.player}) est éliminé.`);
    applyEliminationSideEffects(target);
    handleReserveReplacementOnDeath(target);
    checkDeathWipe(target);
  }
  save();
  renderBoard();
}

function turnOfOther(player) {
  return player === "A" ? "B" : "A";
}

function enterFromReserve(player, incoming, px, py) {
  const incomingChar = charById(incoming.charId);
  const newId = `${player}-${incomingChar.id}-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  state.tokens.push({
    id: newId,
    charId: incomingChar.id,
    player,
    x: px,
    y: py,
    hp: incoming.hp,
    dead: false,
    cd: 0,
    hasMoved: false,
    hasAttacked: false,
    abilityUsed: false,
    buffs: { abyss: false, braut: false },
    scrabTaken: 0,
    poison: 0,
    jayAura: false,
    jayAuraTurns: 0,
    rainActive: false
  });
  let msg = `${incomingChar.name} entre en jeu depuis la réserve.`;
  if (incomingChar.id === "rapido") {
    fx.rapidoEnter = { x: px, y: py };
    msg += " RAPIDO bondit sur le terrain.";
  }
  fxEnter(newId);
  log(msg);
  return newId;
}

/* Cases réellement posables d'une zone de départ : libres, praticables, sans
   objectif dessus. Sert au placement automatique et au choix à la souris. */
function freeSpawnCells(player) {
  const occupied = new Set(
    state.tokens.filter((t) => !t.dead).map((t) => `${t.x},${t.y}`)
  );
  if (state.objectivePos) {
    for (const p of ["A", "B"]) {
      const o = state.objectivePos[p];
      if (o) occupied.add(`${o.x},${o.y}`);
    }
  }
  return GAME.startZones[player].filter(
    ([sx, sy]) => isPassable(sx, sy, player) && !occupied.has(`${sx},${sy}`)
  );
}

function findFreeSpawnCell(player) {
  const free = freeSpawnCells(player);
  if (free.length) return free[0];
  return GAME.startZones[player].find(([sx, sy]) => isPassable(sx, sy, player)) || null;
}

function spawnChoiceAt(x, y) {
  if (!pendingSpawn) return false;
  return freeSpawnCells(pendingSpawn.player).some(([sx, sy]) => sx === x && sy === y);
}

/* Vérifie qu'une équipe n'a plus aucun champion en jeu. Renvoyée à chaque mort,
   et reprise dès qu'un remplacement en zone de départ est abandonné. */
function checkTeamWipe() {
  if (state.winner || state.phase !== "playing") return;
  ["A", "B"].forEach((p) => {
    if (!allDead(p)) return;
    state.winner = turnOfOther(p);
    log(`Tous les champions de l'équipe ${p} sont éliminés. Victoire de l'équipe ${state.winner}.`);
  });
}

function handleReserveReplacementOnDeath(deadToken) {
  if (suppressReplacePrompt) return;
  const player = deadToken.player;
  const reserve = state.reserve[player];
  if (!reserve.length) return;
  const list = reserve.map((r, i) => `${i + 1}. ${charById(r.charId).name} (${r.hp} PV)`).join("\n");
  const chosen = prompt(
    `${charById(deadToken.charId).name} (équipe ${player}) est éliminé. Remplacer par un champion de la réserve ?\n\n${list}\n\n(Annuler = ne pas remplacer)`
  );
  if (chosen === null) return;
  const idx = parseInt(chosen, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= reserve.length) return;
  if (!freeSpawnCells(player).length) {
    alert("Aucune case libre dans la zone de départ pour le remplaçant.");
    return;
  }
  pendingSpawn = { mode: "replace", player, reserveIdx: idx };
  log(`${charById(reserve[idx].charId).name} va remplacer ${charById(deadToken.charId).name} : cliquez une case libre de la zone de départ pour le poser. (Échap pour annuler)`);
  renderBoard();
}

  function applyEliminationSideEffects(deadToken) {
    state.guardZones = state.guardZones.filter((z) => z.ownerId !== deadToken.id);
    if ((deadToken.bettaRegen || 0) > 0) {
      deadToken.bettaRegen = 0;
      deadToken.bettaRoundsLeft = 0;
      deadToken.bettaOwnerId = null;
      log(`${charById(deadToken.charId).name} tombe avec l'Enchantement de BETTA : celui-ci est perdu définitivement (${state.bettaCharges || 0}/2 en stock).`);
    }
  if (state.healingBlocked) {
    state.healingBlocked = false;
    state.tokens.forEach((t) => {
      if (t.rainActive) {
        t.rainActive = false;
        t.cd = 7;
      }
    });
    log("Un champion est éliminé : les soins de nouveau possibles (PRINCE). Le cooldown de PRINCE (7) commence maintenant.");
  }
  if (deadToken.charId === "koga") {
    kogaDeathZone(deadToken.x, deadToken.y);
  }
  if (deadToken.charId === "calix") {
    const removed = calixRemoveCells(deadToken.id);
    if (removed.length) {
      log(`CALIX est éliminé : ses ${removed.length} case(s) spéciale(s) sont retirées du terrain.`);
    }
  }
  if (isRampage()) rampageHealAllies(deadToken.player);
}

/* Rampage : quand un champion tombe, les champions alliés encore en jeu
   remontent à 75 % de leurs PV maximum (arrondi au supérieur). Ceux qui sont
   déjà au-dessus ne sont pas touchés. */
function rampageHealAllies(team) {
  state.tokens.forEach((t) => {
    if (t.dead || t.player !== team) return;
    const max = charById(t.charId).hp;
    const floor = rampageFloor(max);
    if (t.hp < floor) {
      const before = t.hp;
      t.hp = floor;
      fxHeal(t.id, t.hp - before);
      log(`${charById(t.charId).name} (${team}) se remobilise : ${before}→${t.hp} PV (75 % de ${max}).`);
    }
  });
}

/* Fin de partie par élimination : déclenchée à chaque mort, sauf si un
   remplacement en zone de départ est en cours (le champion n'est pas encore
   posé, l'équipe n'est donc pas encore vaincue). */
function checkDeathWipe(deadToken) {
  if (pendingSpawn && pendingSpawn.mode === "replace" && pendingSpawn.player === deadToken.player) return;
  checkTeamWipe();
}

function rapidoFlurryStep(tok, target) {
  if (!tok.flurry) return false;
  if (!tok.flurrySecond) {
    tok.flurrySecond = true;
    tok.hasAttacked = false;
    tok.hasMoved = false;
    tok.abilityUsed = false;
    tok.movLeft = null;
    log("RAPIDO enchaîne : 2ème attaque de 3 dégâts, il peut de nouveau se déplacer avant de frapper.");
    return true;
  }
  tok.flurry = false;
  tok.flurrySecond = false;
  if (target && !target.dead) {
    target.stunned = 1;
    fxCell(target.x, target.y, "lock");
    log(`${charById(target.charId).name} (${target.player}) est paralysé par Déferlement pendant un tour.`);
  }
  return false;
}

function attackAt(x, y) {
  const tok = tokenById(selectedTokenId);
  if (!tok || tok.hasAttacked || tok.abilityUsed) return;
  const c = charById(tok.charId);
  if (state.guardZones.some((z) => Math.abs(z.x - tok.x) <= 1 && Math.abs(z.y - tok.y) <= 1)) {
    alert("Vous êtes dans une zone impénétrable (GUARD).");
    return;
  }
  const wall = arkWallBetween(tok.x, tok.y, x, y);
  if (wall) {
    pushUndo();
    const idx = (state.arkWalls || []).indexOf(wall);
    if (idx >= 0) state.arkWalls.splice(idx, 1);
    tok.hasAttacked = true;
    fxCaster(tok.id);
    fxCell(x, y, "earth");
    log(`${charById(tok.charId).name} détruit un mur d'ARK (1 PV).`);
    const continuing = rapidoFlurryStep(tok, null);
    save();
    renderBoard();
    if (continuing) reselectAfter();
    return;
  }
  if (!inStraightLine(tok.x, tok.y, x, y, c.range) || !hasClearLoS(tok.x, tok.y, x, y)) {
    alert("Cible hors portée : les attaques se font uniquement en ligne droite ou verticale (aucune diagonale), sur une case non obstruée par un mur ou un champion.");
    return;
  }
  pushUndo();

  const dw = state.walls.find((w) => w.x === x && w.y === y);
  if (dw) {
    dw.hp -= 1;
    log(`${charById(tok.charId).name} détruit un mur (ARK).`);
    if (dw.hp <= 0) state.walls = state.walls.filter((w) => w !== dw);
    tok.hasAttacked = true;
    fxCaster(tok.id);
    rapidoFlurryStep(tok, null);
    save();
    renderBoard();
    return;
  }

  const enemyObj = objectiveDef(turnOfOther(tok.player));
  if (x === enemyObj.x && y === enemyObj.y) {
    const dmg = attackValue(tok, null);
    tok.hasAttacked = true;
    busy = true;
    fxCaster(tok.id);
    if (tok.charId === "dicrum") fxCell(tok.x, tok.y, "muzzle");
    save();
    projFromTo(tok.x, tok.y, x, y, ATTACK_PROJ[tok.charId] || "proj-slash", () => {
      busy = false;
      state.objectives[turnOfOther(tok.player)] -= dmg;
      log(`${charById(tok.charId).name} attaque l'objectif adverse : ${dmg} dégâts (il reste ${Math.max(0, state.objectives[turnOfOther(tok.player)])} PV).`);
      kogaAttackHeal(tok);
      const continuing = rapidoFlurryStep(tok, null);
      checkWinnerFromObjective(tok.player);
      renderBoard();
      if (continuing) reselectAfter();
    });
    return;
  }

  const target = state.tokens.find((t) => !t.dead && t.x === x && t.y === y);
  if (target) {
    const dmg = attackValue(tok, target);
    tok.hasAttacked = true;
    busy = true;
    fxCaster(tok.id);
    const impact = ATTACK_IMPACT[tok.charId] || (dmg >= 7 ? "slash-big" : "slash");
    fxCell(x, y, impact);
    if (tok.charId === "dicrum") fxCell(tok.x, tok.y, "muzzle");
    save();
    projFromTo(tok.x, tok.y, x, y, ATTACK_PROJ[tok.charId] || "proj-slash", () => {
      busy = false;
      kogaAttackHeal(tok);
      const continuing = rapidoFlurryStep(tok, target);
      applyDamageToToken(target, dmg, tok);
      if (continuing) reselectAfter();
    });
    return;
  }
}

function attackValue(attacker, target) {
  const c = charById(attacker.charId);
  if (attacker.charId === "rapido" && attacker.flurry) return 3;
  if (!target) return c.atk;
  let dmg = c.atk;
  if (attacker.buffs.braut) {
    attacker.buffs.braut = false;
    if (charById(target.charId).role === "colosse") {
      dmg = 7;
      log(`${c.name} (BRAUT) : Frappe dévastatrice inflige 7 dégâts au Colosse ${charById(target.charId).name} (effet consommé).`);
    } else {
      dmg = 6;
      log(`${c.name} (BRAUT) : Frappe dévastatrice inflige 6 dégâts à ${charById(target.charId).name} (effet consommé).`);
    }
  }
  return dmg;
}

/* ---------- Capacités ---------- */

const BANNER_COLORS = {
  ark: "#a3e635", guard: "#fbbf24", abyss: "#22d3ee", braut: "#fb923c",
  fakie: "#67e8f9", dicrum: "#fca5a5", ad: "#86efac", cazou: "#d8b4fe",
  prince: "#c084fc", scrab: "#a5f3fc", betta: "#93c5fd", vini: "#6ee7b7",
  se7en: "#f472b6", moms: "#fb7185", ranium: "#a3e635", calix: "#d9a066",
  xixz: "#fde047"
};

const CAST_COLORS = {
  ark: "#a3e635", guard: "#fbbf24", abyss: "#22d3ee", braut: "#fb923c",
  fakie: "#67e8f9", dicrum: "#fca5a5", ad: "#86efac", cazou: "#d8b4fe",
  prince: "#c084fc", scrab: "#a5f3fc", betta: "#93c5fd", vini: "#6ee7b7",
  jay: "#66ffb0", rapido: "#ffd97a", koga: "#b7ff9e", se7en: "#f472b6",
  moms: "#fb7185", ranium: "#a3e635", calix: "#d9a066", xixz: "#fde047"
};

const ATTACK_PROJ = {
  ark: "proj-stone", fakie: "proj-shard", koga: "proj-claw", jay: "proj-bolt",
  braut: "proj-fist", scrab: "proj-chain", ad: "proj-gold", betta: "proj-band",
  abyss: "proj-abyss", cazou: "proj-string", prince: "proj-royal", dicrum: "proj-sniper",
  vini: "proj-prism", guard: "proj-shield", rapido: "proj-dash",
  se7en: "proj-dice", moms: "proj-transfusion", ranium: "proj-poison",
  calix: "proj-tile"
};

const ATTACK_IMPACT = {
  ark: "earth", fakie: "shard", koga: "cuts", jay: "bolt",
  braut: "slam", scrab: "lock", ad: "gold", betta: "bow",
  abyss: "void", cazou: "string", prince: "prince", dicrum: "shot",
  vini: "prism", guard: "shield", rapido: "slash", se7en: "slash",
  moms: "aura", ranium: "poison", calix: "earth"
};

function showSe7enDie(tok, roll) {
  const c = charById("se7en");
  const crush = roll === 7;
  const d = document.createElement("div");
  d.className = "se7en-die" + (crush ? " se7en-die-crush" : "");

  if (!crush) {
    d.innerHTML = '<div class="se7en-die-face"><span class="se7en-die-num">0</span></div>';
  } else {
    d.innerHTML =
      '<div class="se7en-die-shadow"></div>' +
      '<div class="se7en-die-face"><span class="se7en-die-num">6</span></div>' +
      '<div class="se7en-seven"><span class="se7en-seven-glyph">7</span></div>' +
      '<div class="se7en-crash-burst"></div>';
  }
  d.style.setProperty("--sc-color", CAST_COLORS.se7en || "#ffd700");
  document.body.appendChild(d);

  const face = d.querySelector(".se7en-die-face");
  const num = d.querySelector(".se7en-die-num");
  const seven = d.querySelector(".se7en-seven");

  const finish = () => d.remove();
  face.addEventListener("animationend", (e) => {
    if (e.animationName.indexOf("roll") === -1) return;
    if (!crush) {
      num.textContent = roll;
      face.classList.add("se7en-die-landed");
      setTimeout(finish, 700);
    } else if (!seven.classList.contains("is-crushing")) {
      seven.classList.add("is-crushing");
    }
  });

  if (crush) {
    seven.addEventListener("animationend", (e) => {
      if (e.animationName.indexOf("crush") === -1) return;
      d.classList.add("is-hit");
      face.classList.add("is-crushed");
      setTimeout(finish, 900);
    });
    setTimeout(finish, 6000);
  } else {
    setTimeout(finish, 4000);
  }
  log(`${c.name} (${tok.player}) : Le Dé — résultat ${roll}.`);
}

function showAbilityBanner(charId) {
  const c = charById(charId);
  const bn = document.createElement("div");
  bn.className = "ability-banner";
  bn.style.setProperty("--ab-color", BANNER_COLORS[charId] || "#ffd700");
  bn.textContent = c.ability.name;
  document.body.appendChild(bn);
  setTimeout(() => bn.remove(), 1000);
}

async function useAbility(tokenId) {
  if (busy) return;
  const tok = tokenById(tokenId);
  if (!tok || tok.dead || tok.cd > 0 || tok.abilityUsed) return;
  const c = charById(tok.charId);
  if (c.id === "rapido" && tok.hasMoved) {
    alert("RAPIDO doit lancer Déferlement avant de se déplacer.");
    renderBoard();
    return;
  }
  pendingAbility = null;
  pushUndo();
  if (c.id !== "rapido") tok.abilityUsed = true;

  if (c.id !== "koga" && c.id !== "betta" && c.id !== "guard") {
    showAbilityBanner(c.id);
  }

  switch (c.id) {
    case "ark": {
      pendingAbility = { tokenId, type: "ark" };
      fxAbility(tok.id);
      log("Choisissez une case directement adjacente à ARK (haut, bas, gauche, droite) : un mur de bordure sera érigé sur ce côté.");
      renderBoard();
      break;
    }
    case "guard": {
      const existing = state.guardZones.find((z) => z.ownerId === tokenId);
      if (!existing) {
        showAbilityBanner(c.id);
        state.guardZones.push({ player: tok.player, x: tok.x, y: tok.y, turnsLeft: 3, ownerId: tokenId });
        tok.cd = 5;
        fxAbility(tok.id);
        fxCell(tok.x, tok.y, "guard");
        log(`GUARD crée une zone impénétrable 3×3 pendant 3 manches complètes. Il est immobilisé.`);
      }
      renderBoard();
      break;
    }
    case "abyss": {
      tok.buffs.abyss = true;
      tok.cd = 6;
      fxAbility(tok.id);
      fxCell(tok.x, tok.y, "shield");
      log(`ABYSS se prépare à réduire de moitié la prochaine attaque reçue.`);
      renderBoard();
      break;
    }
    case "braut": {
      tok.buffs.braut = true;
      tok.cd = 5;
      fxAbility(tok.id);
      log(`BRAUT prépare sa prochaine attaque : 7 dégâts (ou AT si Colosse).`);
      renderBoard();
      break;
    }
    case "fakie": {
      pendingAbility = { tokenId, type: "fakie" };
      fxAbility(tok.id);
      log("Choisissez un champion ennemi à échanger, n'importe où sur le terrain (les murs sont ignorés).");
      renderBoard();
      break;
    }
    case "dicrum": {
      pendingAbility = { tokenId, type: "dicrum" };
      fxAbility(tok.id);
      log("Choisissez un ennemi à 5 cases max, en ligne horizontale ou verticale uniquement (aucune diagonale), avec ligne de vue dégagée.");
      renderBoard();
      break;
    }
    case "ad": {
      pendingAbility = { tokenId, type: "ad", targets: [] };
      fxAbility(tok.id);
      log("Choisissez un allié à 4 cases max, en ligne horizontale ou verticale uniquement (aucune diagonale), avec ligne de vue dégagée.");
      computeAllyTargets(tok, 4, tok.player);
      renderBoard();
      break;
    }
    case "cazou": {
      const enemies = state.tokens.filter((t) => !t.dead && t.player !== tok.player);
      if (!enemies.length) {
        alert("Aucun champion adverse à manipuler.");
        renderBoard();
        return;
      }
      tok.cd = 6;
      fxAbility(tok.id);
      pendingAbility = { tokenId, type: "cazou", selected: null };
      log("CAZOU sacrifie 4 PV et ne manipule qu'UN seul champion adverse : cliquez d'abord le champion concerné, puis la case libre où le porter.");
      applyDamageToToken(tok, 4, null, { self: true });
      break;
    }
    case "prince": {
      state.healingBlocked = true;
      tok.rainActive = true;
      tok.cd = 7;
      fxAbility(tok.id);
      fxCell(tok.x, tok.y, "prince");
      log(`PRINCE déclenche Purple Rain : plus aucun champion du terrain ne peut être soigné (ni par capacité, ni par case de soin). L'effet s'arrête dès qu'un champion est éliminé, et c'est seulement à ce moment que le cooldown de PRINCE (7) commence.`);
      renderBoard();
      break;
    }
    case "scrab": {
      const targets = state.tokens.filter(
        (t) => !t.dead && t.player !== tok.player && inScrabGelZone(tok.x, tok.y, t.x, t.y)
      );
      if (!targets.length) {
        alert("Gel : aucun champion adverse dans la zone carrée 7×7 centrée sur SCRAB.");
        renderBoard();
        return;
      }
      pendingAbility = { tokenId, type: "scrab", targets: targets.map((t) => t.id) };
      fxAbility(tok.id);
      log("SCRAB déclenche Gel : cliquez le champion adverse à geler (zone carrée 7×7 centrée sur SCRAB).");
      renderBoard();
      break;
    }
    case "betta": {
      if ((state.bettaCharges || 0) <= 0) {
        alert("Enchantement : plus aucun enchantement en stock (les 2 charges sont engagées ou perdues).");
        renderBoard();
        return;
      }
      pendingAbility = { tokenId, type: "betta", targets: [] };
      computeAllyTargets(tok, 2, tok.player);
      pendingAbility.targets = pendingAbility.targets.filter((id) => {
        const t = tokenById(id);
        return t && !t.dead && !(t.bettaRegen > 0);
      });
      if (pendingAbility.targets.length === 0) {
        pendingAbility = null;
        alert("Aucun allié à portée sans enchantement déjà actif.");
        renderBoard();
        return;
      }
      showAbilityBanner(c.id);
      fxAbility(tok.id);
      log(`Choisissez un allié à 2 cases max, en ligne horizontale ou verticale uniquement (aucune diagonale), avec ligne de vue dégagée : il récupérera 1 PV au début de chacun de ses tours pendant 8 manches. ${state.bettaCharges} enchantement(s) en stock.`);
      renderBoard();
      break;
    }
    case "moms": {
      if (tok.hp <= 1) {
        alert("MOM'S n'a plus assez de PV pour céder quoi que ce soit.");
        renderBoard();
        return;
      }
      pendingAbility = { tokenId, type: "moms", targets: [] };
      fxAbility(tok.id);
      computeWoundedAllyTargets(tok, 2);
      if (!pendingAbility.targets.length) {
        pendingAbility = null;
        alert("Aucun allié blessé à 2 cases max de MOM'S.");
        renderBoard();
        return;
      }
      log("Choisissez l'allié blessé à qui MOM'S va céder des PV : une fenêtre vous permettra d'en donner 1 à 8.");
      renderBoard();
      break;
    }
    case "calix": {
      const avail = calixAvailableTypes(tokenId);
      if (!avail.length) {
        alert("Création : tous vos quotas de cases sont déjà utilisés.");
        renderBoard();
        return;
      }
      pendingAbility = { tokenId, type: "calix" };
      fxAbility(tok.id);
      log("CALIX choisit le type de case qu'il va poser.");
      renderBoard();
      askCalixType(tokenId, avail);
      break;
    }
    case "ranium": {
      pendingAbility = { tokenId, type: "ranium" };
      fxAbility(tok.id);
      log("Choisissez un champion adverse à portée 1 : il sera empoisonné (1 dégât par tour, les poisons s'additionnent).");
      renderBoard();
      break;
    }
    case "vini": {
      tok.buffs.vini = true;
      tok.cd = 5;
      fxAbility(tok.id);
      fxCell(tok.x, tok.y, "shield");
      log(`VINI se prépare à refléter la prochaine attaque reçue (dégâts identiques à l'attaquant).`);
      renderBoard();
      break;
    }
    case "se7en": {
      const roll = Math.random() < (SE7EN_DEBUG_7 ? 1 : 0.01) ? 7 : Math.floor(Math.random() * 6) + 1;
      tok.cd = 4;
      showSe7enDie(tok, roll);
      if (roll === 1 || roll === 2) {
        const loss = roll === 1 ? 2 : 1;
        tok.hp = Math.max(0, tok.hp - loss);
        fxCell(tok.x, tok.y, "cuts");
        log(`SE7EN lance le dé : ${roll}. Il perd ${loss} PV (${tok.hp} PV restants).`);
        if (tok.hp <= 0 && !tok.dead) {
          tok.dead = true;
          if (selectedTokenId === tok.id) {
            selectedTokenId = null;
            reachable = [];
            attackCells = [];
          }
          fxDeath(tok.id);
          log("SE7EN est éliminé par son propre dé.");
          applyEliminationSideEffects(tok);
          checkDeathWipe(tok);
        }
        save();
        renderBoard();
        break;
      }
      pendingAbility = { tokenId, type: "se7en", dmg: roll === 7 ? 30 : roll === 5 ? 6 : roll === 6 ? 7 : 4 };
      log(
        roll === 7
          ? "SE7EN : un 7 écrase le dé ! Choisissez une cible à portée 2 pour 30 dégâts."
          : roll === 4 || roll === 3
            ? "SE7EN lance le dé : 3 ou 4. Choisissez une cible à portée 2 pour une attaque normale (4 dégâts)."
            : `SE7EN lance le dé : ${roll}. Choisissez une cible à portée 2 pour ${pendingAbility.dmg} dégâts.`
      );
      renderBoard();
      break;
    }
    case "rapido": {
      if (tok.hasAttacked) {
        alert("Déferlement doit être lancé avant d'attaquer : RAPIDO attaquera ensuite deux fois.");
        renderBoard();
        return;
      }
      tok.flurry = true;
      tok.flurrySecond = false;
      tok.cd = 6;
      fxAbility(tok.id);
      log("RAPIDO déclenche Déferlement (Cd 6) : 1ère attaque de 3 dégâts, puis il peut re-déplacer et porter une 2ème attaque de 3 dégâts qui paralyse la cible.");
      renderBoard();
      break;
    }
    case "jay": {
      if (tok.jayAura) {
        alert("L'Aura de soin de JAY est déjà active.");
        renderBoard();
        return;
      }
      tok.jayAura = true;
      tok.jayAuraTurns = 8;
      fxAbility(tok.id);
      fxCell(tok.x, tok.y, "aura");
      log("JAY active son Aura de soin pour 8 tours : chaque allié à 2 cases (diagonales incluses) récupère 1 PV au début de chaque tour de Jay. La capacité passe ensuite en recharge (Cd 3).");
      renderBoard();
      break;
    }
    case "koga":
    case "xixz":
    default: {
      alert("Ce Champion n'a pas de capacité à activer manuellement (passif/réaction automatique).");
      renderBoard();
    }
  }
}

function computeAllyTargets(tok, dist, player) {
  pendingAbility.targets = [];
  state.tokens.forEach((t) => {
    if (t.dead || t.player !== player) return;
    if (inStraightLine(tok.x, tok.y, t.x, t.y, dist) && hasClearLoS(tok.x, tok.y, t.x, t.y)) {
      pendingAbility.targets.push(t.id);
    }
  });
}

/* Alliés blessés dans un rayon de "dist" cases (Chebyshev, diagonales incluses). */
function computeWoundedAllyTargets(tok, dist) {
  pendingAbility.targets = [];
  state.tokens.forEach((t) => {
    if (t.dead || t.player !== tok.player) return;
    if (t.id === tok.id) return;
    if (t.hp >= charById(t.charId).hp) return;
    if (distanceCheb(tok.x, tok.y, t.x, t.y) <= dist) pendingAbility.targets.push(t.id);
  });
}

/* Une case est-elle libre pour la Manipulation de CAZOU ? */
function cazouCellFree(x, y, player) {
  if (!isPassable(x, y, player)) return false;
  if (state.tokens.some((t) => !t.dead && t.x === x && t.y === y)) return false;
  if (objectiveCellAt(x, y)) return false;
  if ((specialCellAt(x, y) || {}).type === "block") return false;
  return true;
}

async function resolvePendingOnCell(x, y) {
  const pa = pendingAbility;
  const tok = tokenById(pa.tokenId);
  if (!tok) return;

  /* Manipulation de CAZOU — 1er clic : saisir le champion adverse concerné.
     Traite AVANT pushUndo() pour ne pas empiler un snapshot identique. */
  if (pa.type === "cazou" && !pa.selected) {
    const target = state.tokens.find((t) => !t.dead && t.x === x && t.y === y);
    if (!target) {
      alert("Choisissez d'abord un champion adverse à manipuler.");
      return;
    }
    if (target.player === tok.player) {
      alert("Seuls les champions adverses peuvent être manipulés.");
      return;
    }
    pa.selected = target.id;
    log(`${charById(target.charId).name} est saisi : cliquez la case libre où le porter.`);
    renderBoard();
    return;
  }

  pushUndo();

  if (pa.type === "ark") {
    const dx = x - tok.x;
    const dy = y - tok.y;
    if (!((Math.abs(dx) === 1 && dy === 0) || Math.abs(dy) === 1 && dx === 0)) {
      alert("Choisissez une case directement adjacente à ARK (haut, bas, gauche ou droite).");
      return;
    }
    if (x < 0 || y < 0 || x >= GAME.map.cols || y >= GAME.map.rows) return;
    const onObj = ["A", "B"].some((p) => objectiveDef(p).x === x && objectiveDef(p).y === y);
    if (onObj) {
      alert("Impossible d'ériger un mur contre un objectif.");
      return;
    }
    const key = edgeKey(tok.x, tok.y, x, y);
    if ((state.arkWalls || []).some((w) => w && w.key === key) || GAME.edgeSet.has(key)) {
      alert("Un mur existe déjà sur ce côté.");
      return;
    }
    state.arkWalls.push({ key, hp: 1 });
    tok.cd = 5;
    fxCell(x, y, "earth");
    log(`ARK érige un mur de bordure sur le côté (${x + 1}, ${y + 1}) (bloque le passage et la ligne de vue).`);
    pendingAbility = null;
    save();
    renderBoard();
    return;
  }

  if (pa.type === "cazou") {
    const enemy = tokenById(pa.selected);
    if (!enemy || enemy.dead) {
      pendingAbility = null;
      renderBoard();
      return;
    }
    if (!cazouCellFree(x, y, tok.player)) {
      alert("Case non libre (occupée, objectif ou obstacle).");
      return;
    }
    fxCell(enemy.x, enemy.y, "teleport");
    enemy.x = x;
    enemy.y = y;
    fxCell(x, y, "teleport");
    log(`CAZOU déplace ${charById(enemy.charId).name} (${enemy.player}) en (${x + 1}, ${y + 1}).`);
    checkFire(enemy);
    pendingAbility = null;
    log("Manipulation de CAZOU terminée.");
    save();
    renderBoard();
    return;
  }

  if (pa.type === "betta") {
    if (pa.targets.length === 0) {
      alert("Aucune cible valide.");
      return;
    }
    const target = state.tokens.find((t) => t.x === x && t.y === y && pa.targets.includes(t.id));
    if (!target) {
      alert("Cible invalide.");
      return;
    }
    if ((target.bettaRegen || 0) > 0) {
      alert(`${charById(target.charId).name} est déjà enchanté.`);
      return;
    }
    target.bettaRegen = 5;
    target.bettaOwnerId = tok.id;
    target.bettaRoundsLeft = 8;
    state.bettaCharges = Math.max(0, (state.bettaCharges || 0) - 1);
    fxCell(target.x, target.y, "aura");
    log(`BETTA pose un Enchantement sur ${charById(target.charId).name} (+1 PV au début de chacun de ses tours, pendant 8 manches). ${state.bettaCharges} enchantement(s) en stock.`);
    pendingAbility = null;
    save();
    renderBoard();
    return;
  }

  if (pa.type === "moms") {
    const target = state.tokens.find((t) => !t.dead && t.x === x && t.y === y && pa.targets.includes(t.id));
    if (!target) {
      alert("Choisissez un allié blessé entouré en rose.");
      return;
    }
    const maxHp = charById(target.charId).hp;
    const missing = maxHp - target.hp;
    const max = Math.min(MOMS_MAX_TRANSFUSION, tok.hp - 1, missing);
    if (max < 1) {
      pendingAbility = null;
      alert("Impossible : MOM'S n'a plus de PV à céder.");
      renderBoard();
      return;
    }
    const options = [];
    for (let i = 1; i <= max; i++) options.push({ label: i + " PV", value: i });
    const amount = await askChoicePrompt({
      icon: "🩸",
      title: "Transfusion",
      text: `Combien de PV MOM'S cède-t-elle à ${charById(target.charId).name} ?\nElle a ${tok.hp}/${charById(tok.charId).hp} PV, la cible a ${target.hp}/${maxHp} PV.`,
      hint: "MOM'S doit conserver au moins 1 PV.",
      cancel: "Annuler",
      options
    });
    if (!amount) {
      pendingAbility = null;
      log("MOM'S annule sa transfusion.");
      renderBoard();
      return;
    }
    tok.hp -= amount;
    healToken(target, amount, "transfusion de MOM'S");
    tok.cd = 4;
    pendingAbility = null;
    busy = true;
    fxHeal(target.id, amount);
    fxCell(tok.x, tok.y, "cuts");
    save();
    projFromTo(tok.x, tok.y, target.x, target.y, "proj-transfusion", () => {
      busy = false;
      fxCell(target.x, target.y, "aura");
      log(
        `MOM'S donne ${amount} PV à ${charById(target.charId).name} (${target.hp}/${maxHp} PV). MOM'S : ${tok.hp}/${charById(tok.charId).hp} PV.`
      );
      renderBoard();
    });
    return;
  }

  if (pa.type === "calix") {
    const kind = pa.cellType;
    if (!kind) {
      alert("Choisissez d'abord le type de case de CALIX.");
      return;
    }
    if (calixQuotaLeft(tok.id, kind) <= 0) {
      alert(`Création : le quota de cases « ${CALIX_TYPE_LABEL[kind]} » est déjà épuisé.`);
      return;
    }
    const blocker = calixPlaceBlock(x, y, tok.player, tok);
    if (blocker) {
      log(`CALIX ne peut pas poser sa case en (${x + 1}, ${y + 1}) : ${blocker}.`);
      alert(`Case refusée (${blocker}). Choisissez une case libre dans la portée de CALIX.`);
      return;
    }
    state.specialCells = state.specialCells || [];
    state.specialCells.push({ x, y, type: kind, ownerId: tok.id, ownerName: "CALIX" });
    tok.cd = 4;
    pendingAbility = null;
    busy = true;
    save();
    const left = calixAvailableTypes(tok.id).length;
    log(
      `CALIX pose une case ${CALIX_TYPE_LABEL[kind]} en (${x + 1}, ${y + 1}).` +
        (left
          ? ` Il lui reste ${left} type(s) de case disponible(s).`
          : " Tous ses quotas de cases sont utilisés.")
    );
    renderBoard();
    projFromTo(tok.x, tok.y, x, y, "proj-tile", () => {
      busy = false;
      fxCell(x, y, kind === "block" ? "earth" : kind === "heal" ? "aura" : kind === "speed" ? "gold" : "objective");
      renderBoard();
    });
    return;
  }

  if (pa.type === "ranium") {
    const target = state.tokens.find((t) => !t.dead && t.player !== tok.player && t.x === x && t.y === y);
    if (!target) {
      alert("Choisissez un champion adverse adjacent (portée 1).");
      return;
    }
    if (distanceCheb(tok.x, tok.y, target.x, target.y) > 1) {
      log(`RANIUM ne peut pas viser ${charById(target.charId).name} : trop loin (portée 1).`);
      alert("Cible trop loin : RANIUM empoisonne uniquement un champion adjacent (portée 1).");
      return;
    }
    target.poison = (target.poison || 0) + 1;
    tok.cd = 4;
    pendingAbility = null;
    busy = true;
    save();
    log(
      `RANIUM empoisonne ${charById(target.charId).name} (${target.poison} couche(s) : ${target.poison} dégât(s) par tour).`
    );
    projFromTo(tok.x, tok.y, x, y, "proj-poison", () => {
      busy = false;
      fxCell(x, y, "poison");
      renderBoard();
    });
    return;
  }

  if (pa.type === "ad") {
    if (pa.targets.length === 0) {
      alert("Aucune cible valide.");
      return;
    }
    const target = state.tokens.find((t) => t.x === x && t.y === y && pa.targets.includes(t.id));
    if (!target) {
      alert("Cible invalide.");
      return;
    }
    tok.cd = 5;
    pendingAbility = null;
    busy = true;
    fxHeal(target.id, 4);
    save();
    projFromTo(tok.x, tok.y, x, y, "proj-heal", () => {
      busy = false;
      const healed = healToken(target, 4, "soin de A.D.");
      log(`A.D. soigne ${charById(target.charId).name} de ${healed} PV.`);
      renderBoard();
    });
    return;
  }

  if (pa.type === "fakie") {
    const target = state.tokens.find((t) => !t.dead && t.player !== tok.player && t.x === x && t.y === y);
    if (!target) {
      alert("Cible invalide.");
      return;
    }
    tok.cd = 5;
    pendingAbility = null;
    busy = true;
    fxCell(tok.x, tok.y, "portal");
    fxCell(target.x, target.y, "portal");
    save();
    projFromTo(tok.x, tok.y, x, y, "proj-swap", () => {
      busy = false;
      [tok.x, target.x] = [target.x, tok.x];
      [tok.y, target.y] = [target.y, tok.y];
      const tname = charById(target.charId).name;
      log(`FAKIE échange sa position avec ${tname}.`);
      if (!target.dead) applyDamageToToken(target, 2, tok);
      checkFire(tok);
      checkFire(target);
      renderBoard();
    });
    return;
  }

  if (pa.type === "scrab") {
    const target = state.tokens.find(
      (t) => !t.dead && t.x === x && t.y === y && pa.targets.includes(t.id)
    );
    if (!target) {
      alert("Choisissez un champion adverse présent dans la zone de Gel de SCRAB.");
      return;
    }
    tok.cd = 3;
    pendingAbility = null;
    for (let dz = -3; dz <= 3; dz++) {
      for (let dx = -3; dx <= 3; dx++) {
        fxCell(tok.x + dx, tok.y + dz, "freeze");
      }
    }
    target.stunned = 1;
    fxCell(target.x, target.y, "lock");
    fxAbility(tok.id);
    log(`SCRAB gèle ${charById(target.charId).name} (${target.player}) pendant tout le prochain tour adverse.`);
    save();
    renderBoard();
    return;
  }

  if (pa.type === "se7en") {
    const enemyObj = objectiveDef(turnOfOther(tok.player));
    const target = state.tokens.find((t) => !t.dead && t.player !== tok.player && t.x === x && t.y === y);
    const onObj = x === enemyObj.x && y === enemyObj.y;
    if (!target && !onObj) {
      alert("Choisissez un champion adverse ou son objectif.");
      return;
    }
    const dx = Math.abs(x - tok.x);
    const dy = Math.abs(y - tok.y);
    const maxD = Math.max(dx, dy);
    if (maxD > 2 || (dx !== 0 && dy !== 0)) {
      alert("SE7EN frappe uniquement à portée 2 (distance maximale de 2 cases, en ligne droite).");
      return;
    }
    if (!hasClearLoS(tok.x, tok.y, x, y)) {
      alert("Ligne de vue obstruée.");
      return;
    }
    if (inGuardZone(tok.x, tok.y) || inGuardZone(x, y) || lineCrossesGuardZone(tok.x, tok.y, x, y)) {
      alert("La zone impénétrable de GUARD bloque ce tir.");
      return;
    }
    const base = pa.dmg || 4;
    const isSeven = base === 30;
    const dmg = onObj ? cAtkOf("se7en") : base;
    pendingAbility = null;
    tok.hasAttacked = true;
    busy = true;
    fxCaster(tok.id);
    const impact = dmg >= 7 ? "slash-big" : "slash";
    fxCell(x, y, isSeven ? "seven-burst" : impact);
    if (isSeven) {
      fxCell(tok.x, tok.y, "flare");
      fxCell(tok.x, tok.y, "gold");
    }
    save();
    const flightMs = isSeven ? 1500 : 470;
    projFromTo(
      tok.x,
      tok.y,
      x,
      y,
      isSeven ? "proj-dice-7" : "proj-dice",
      () => {
        busy = false;
        if (onObj) {
          state.objectives[turnOfOther(tok.player)] -= dmg;
          log(`SE7EN attaque l'objectif adverse : ${dmg} dégâts (il reste ${Math.max(0, state.objectives[turnOfOther(tok.player)])} PV).`);
          kogaAttackHeal(tok);
          checkWinnerFromObjective(tok.player);
          renderBoard();
        } else {
          log(`SE7EN frappe ${charById(target.charId).name} : ${dmg} dégâts.`);
          kogaAttackHeal(tok);
          applyDamageToToken(target, dmg, tok);
        }
      },
      isSeven
        ? {
            slow: true,
            duration: flightMs,
            leadIn: leadInPoint(tok.x, tok.y, x, y, 11)
          }
        : undefined
    );
    return;
  }

  if (pa.type === "dicrum") {
    const enemyObj = objectiveDef(turnOfOther(tok.player));
    const target = state.tokens.find((t) => !t.dead && t.player !== tok.player && t.x === x && t.y === y);
    const onObj = x === enemyObj.x && y === enemyObj.y;
    if (!target && !onObj) {
      alert("Cible invalide.");
      return;
    }
    const dx = Math.abs(x - tok.x);
    const dy = Math.abs(y - tok.y);
    if (Math.max(dx, dy) > 5 || (dx !== 0 && dy !== 0)) {
      alert("Cible hors ligne : DICRUM tire uniquement en ligne horizontale ou verticale (aucune diagonale), jusqu'à 5 cases.");
      return;
    }
    if (!hasClearLoS(tok.x, tok.y, x, y)) {
      alert("Ligne de vue obstruée.");
      return;
    }
    if (inGuardZone(tok.x, tok.y) || inGuardZone(x, y) || lineCrossesGuardZone(tok.x, tok.y, x, y)) {
      alert("La zone impénétrable de GUARD bloque ce tir : aucun dégât ne peut la traverser ou y être infligé.");
      return;
    }
    tok.cd = 6;
    pendingAbility = null;
    busy = true;
    fxCaster(tok.id);
    fxCell(tok.x, tok.y, "muzzle");
    fxCell(x, y, "shot");
    save();
    projFromTo(tok.x, tok.y, x, y, "proj-sniper", () => {
      busy = false;
      if (onObj) {
        state.objectives[turnOfOther(tok.player)] -= 8;
        log(`DICRUM inflige 8 dégâts à l'objectif adverse.`);
        checkWinnerFromObjective(tok.player);
        save();
        renderBoard();
      } else {
        applyDamageToToken(target, 8, tok);
      }
    });
    return;
  }
}

/* ---------- Tour ---------- */

document.getElementById("next-turn").addEventListener("click", () => {
  if (busy) return;
  if (state.winner) return;
  if (state.phase === "placement") {
    alert("La partie ne commence pas tant que chaque équipe n'a pas placé son objectif et ses 3 titulaires.");
    return;
  }
  pushUndo();
  endPlayerTurn();
});

document.addEventListener("keydown", (e) => {
  const tag = (e.target && e.target.tagName) || "";
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;
  if (e.repeat) return;
  const k = (e.key || "").toLowerCase();

  if (e.code === "Space" || e.key === " " || k === "z") {
    e.preventDefault();
    blurFocused();
    document.getElementById("next-turn").click();
    return;
  }

  if (k === "u" || k === "a") {
    e.preventDefault();
    blurFocused();
    undoLast();
    return;
  }

  if (k === "f") {
    e.preventDefault();
    blurFocused();
    toggleBigScreen();
    return;
  }

  if (k === "x") {
    e.preventDefault();
    blurFocused();
    const btn = document.getElementById("panel-ability");
    if (btn && !btn.disabled) btn.click();
    return;
  }

  if (e.key === "Escape") {
    e.preventDefault();
    if (document.body.classList.contains("bigscreen")) {
      setBigScreen(false);
      return;
    }
    if (pendingSpawn) {
      pendingSpawn = null;
      log("Placement annulé.");
      save();
      checkTeamWipe();
      renderBoard();
      return;
    }
    if (pendingAbility) {
      pendingAbility = null;
      log("Sélection de cible annulée.");
      save();
      renderBoard();
      return;
    }
    deselect();
  }
});

function blurFocused() {
  const el = document.activeElement;
  if (el && el.blur) el.blur();
}

document.getElementById("undo-btn").addEventListener("click", undoLast);

function endPlayerTurn() {
  const current = state.turn;
  state.rapidoBuff = null;

  state.tokens.forEach((t) => {
    if (t.stunned > 0 && t.player === state.turn) t.stunned = 0;
    if (t.flurry || t.flurrySecond) {
      t.flurry = false;
      t.flurrySecond = false;
      t.abilityUsed = false;
    }
  });

  state.turn = current === "A" ? "B" : "A";
  if (state.turn === "A") {
    const completedRound = state.turnCount;
    state.turnCount++;
    applyShrinkRound(completedRound);
  }

  /* Le dôme de GUARD dure 3 manches complètes (A+B). Le décompte se fait au
     début du tour de son propriétaire, pas au tour où il l'a lancé : activé en
     A1, il couvre A1 B1 A2 B2 A3 B3, puis disparaît en A4. */
  state.guardZones.forEach((z) => {
    if (z.player === state.turn) {
      z.turnsLeft--;
      if (z.turnsLeft <= 0) {
        log("La zone impénétrable de GUARD se dissipe.");
      }
    }
  });
  state.guardZones = state.guardZones.filter((z) => z.turnsLeft > 0);

  if (state.swapCd && state.swapCd[current] > 0) state.swapCd[current]--;
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
  pendingAbility = null;
  pendingSpawn = null;
  checkTeamWipe();

  const side = state.turn;
  state.tokens.filter((t) => t.player === side).forEach((t) => {
    if (t.dead) return;
    if (!(t.rainActive && state.healingBlocked)) t.cd = Math.max(0, t.cd - 1);
    t.hasMoved = false;
    t.hasAttacked = false;
    t.abilityUsed = false;
    t.healCellUsed = false;
    t.speedTurnBoost = isSpeedCell(t.x, t.y);
    t.speedUsed = false;
    t.movLeft = null;
  });

  if (!allDead(turnOfOther(side))) {
    state.tokens.filter((t) => t.player === side && !t.dead).forEach((t) => {
      if (t.charId === "jay" && t.jayAura) {
        fxCell(t.x, t.y, "aura");
        const allies = state.tokens.filter((a) => !a.dead && a.player === side && distanceCheb(t.x, t.y, a.x, a.y) <= 2);
        allies.forEach((a) => {
          if (a.id !== t.id && a.hp < charById(a.charId).hp) {
            if (healToken(a, 1, "aura de JAY") > 0) {
              fxHeal(a.id, 1);
              log(`JAY soigne ${charById(a.charId).name} de 1 PV.`);
            }
          }
        });
        t.jayAuraTurns = Math.max(0, (t.jayAuraTurns || 0) - 1);
        if (t.jayAuraTurns <= 0) {
          t.jayAura = false;
          t.cd = 3;
          log("L'Aura de soin de JAY prend fin : la capacité est en recharge (Cd 3).");
        } else {
          log(`Aura de JAY : encore ${t.jayAuraTurns} tour(s) d'activation.`);
        }
      }
      if ((t.bettaRegen || 0) > 0) {
        const owner = t.bettaOwnerId ? tokenById(t.bettaOwnerId) : null;
        if (!owner || owner.dead) {
          t.bettaRegen = 0;
          t.bettaRoundsLeft = 0;
          t.bettaOwnerId = null;
          log(`L'Enchantement de BETTA sur ${charById(t.charId).name} s'arrête : BETTA n'est plus en jeu.`);
        } else {
          if (t.hp < charById(t.charId).hp) {
            if (healToken(t, 1, "Enchantement de BETTA") > 0) {
              fxHeal(t.id, 1);
              log(`${charById(t.charId).name} régénère 1 PV (Enchantement de BETTA).`);
            }
          }
          fxCell(t.x, t.y, "aura");
          t.bettaRoundsLeft = Math.max(0, (t.bettaRoundsLeft || 0) - 1);
          if (t.bettaRoundsLeft <= 0) {
            t.bettaRegen = 0;
            t.bettaOwnerId = null;
            state.bettaCharges = Math.min(2, (state.bettaCharges || 0) + 1);
            log(`L'Enchantement de BETTA sur ${charById(t.charId).name} arrive à terme : BETTA récupère son enchantement (${state.bettaCharges}/2 en stock).`);
          }
        }
      }
      if (healCellKindAt(t.x, t.y) && !t.healCellUsed && t.hp < charById(t.charId).hp) {
        if (healToken(t, 1, "case soin") > 0) {
          t.healCellUsed = true;
          fxHeal(t.id, 1);
          log(`${charById(t.charId).name} récupère 1 PV sur la case soin (${t.hp}/${charById(t.charId).hp} PV).`);
        }
      }
    });
  }

  state.tokens.filter((t) => t.player === side && !t.dead && (t.poison || 0) > 0).forEach((t) => {
    applyPoisonDamage(t);
  });

  /* Le feu frappe à nouveau au début du tour tant qu'on y est encore : le dégât
     "au passage" n'a lieu qu'à chaque traversée, celui-ci à chaque tour complet. */
  state.tokens.filter((t) => t.player === side && !t.dead && isFire(t.x, t.y)).forEach((t) => {
    fireAt(t, t.x, t.y, true);
  });

  /* Dégâts de feu aux objectifs, une fois par manche (début du tour de A) et
     de façon symétrique : les deux objectifs tombent en même temps. */
  if (side === "A") burnObjectivesSimultaneous();

  log(`Au tour de l'équipe ${side}.`);
  save();
  renderBoard();
}

document.getElementById("reset-board").addEventListener("click", () => {
  if (lanMode && lanRole === "client") return;
  if (!confirm("Réinitialiser la partie ? Toutes les positions, PV et états seront perdus.")) return;
  const keep = confirm("Conserver les decks actuels ? (Non = tout vider)");
  if (keep) {
    state.starters = { A: [], B: [] };
    state.reserve = { A: [], B: [] };
    state.tokens = [];
    state.walls = [];
    state.arkWalls = [];
    state.guardZones = [];
    state.turn = "A";
    state.turnCount = 1;
    state.shrinkStep = 0;
    state.log = [];
    state.healingBlocked = false;
    state.objectives = {
      A: GAME.objectives.A.hp,
      B: GAME.objectives.B.hp
    };
    state.rapidoBuff = null;
    state.bettaCharges = 2;
    state.scrabTriggered = {};
    state.specialCells = [];
    state.winner = null;
    pendingAbility = null;
    pendingSpawn = null;
    undoStack = [];
    save();
    renderBoard();
    showHome();
  } else {
    state = defaultState();
    undoStack = [];
    save();
    renderLibrary();
    renderDecks();
    renderBoard();
    showHome();
  }
});

document.getElementById("reserve-block").addEventListener("click", () => {
  if (lanMode && lanRole === "client") return;
  if (state.healingBlocked) {
    state.healingBlocked = false;
    log("Blocage des soins levé.");
  } else {
    state.healingBlocked = true;
    log("Blocage des soins activé (effet manuel, PRINCE).");
  }
  save();
  renderBoard();
});

/* ---------- Mode grand écran du terrain ---------- */

const fsBtn = document.getElementById("fullscreen-btn");

function setBigScreen(on) {
  if (on) {
    const tab = document.getElementById("tab-board");
    if (!tab.classList.contains("active")) {
      document.querySelectorAll(".tab-btn").forEach((b) => b.classList.remove("active"));
      document.querySelectorAll(".tab").forEach((t) => t.classList.remove("active"));
      document.querySelector('.tab-btn[data-tab="board"]').classList.add("active");
      tab.classList.add("active");
    }
  }
  document.body.classList.toggle("bigscreen", on);
  fsBtn.classList.toggle("active", on);
  fsBtn.textContent = on ? "⛶ Quitter le grand écran" : "⛶ Grand écran";
  renderBoard();
}

function toggleBigScreen() {
  setBigScreen(!document.body.classList.contains("bigscreen"));
}

fsBtn.addEventListener("click", toggleBigScreen);
document.getElementById("bigscreen-exit").addEventListener("click", () => setBigScreen(false));

document.getElementById("win-close").addEventListener("click", () => {
  document.getElementById("win-overlay").classList.remove("show");
});

/* ---------- Réserve / remplacements ---------- */

function renderRosters() {
  const rosters = document.getElementById("rosters");
  rosters.innerHTML = "";
  ["A", "B"].forEach((player) => {
    const box = document.createElement("div");
    box.className = `roster player-${player.toLowerCase()}`;
    box.innerHTML = `<h3>Équipe ${player}</h3>`;

    const swapCdBadge = document.createElement("div");
    swapCdBadge.className = "roster-cd";
    const scd = swapCooldown(player);
    swapCdBadge.textContent = scd > 0
      ? `Changement volontaire : Cd ${scd}`
      : "Changement volontaire : disponible";
    swapCdBadge.title = "Remplacement volontaire : échanger un champion avec la réserve (recharge de 5 tours). Le remplacement obligatoire après une élimination n'utilise PAS ce cooldown.";
    if (scd > 0) swapCdBadge.classList.add("off");
    box.appendChild(swapCdBadge);

    const fieldTitle = document.createElement("div");
    fieldTitle.className = "roster-title";
    fieldTitle.textContent = "Sur le terrain";
    box.appendChild(fieldTitle);

    state.tokens.filter((t) => t.player === player && !t.dead).forEach((t) => {
      const c = charById(t.charId);
      const row = document.createElement("div");
      row.className = "roster-row field";
      row.textContent = `${c.name} — ${t.hp}/${c.hp} PV${t.cd > 0 ? " · Cd " + t.cd : ""}`;
const swap = document.createElement("button");
        swap.textContent = "↻";
        const swapCd = swapCooldown(player);
        swap.title = swapCd > 0
          ? `Changement indisponible : encore ${swapCd} tour(s)`
          : "Remplacer par la réserve (le remplaçant se pose en zone de départ)";
      swap.disabled =
        state.reserve[player].length === 0 ||
        swapCd > 0 ||
        (isTurnOf(player) && (t.hasAttacked || t.abilityUsed));
      swap.addEventListener("click", () => openSwapDialog(player, t));
      row.appendChild(swap);
      box.appendChild(row);
    });

    const resTitle = document.createElement("div");
    resTitle.className = "roster-title";
    resTitle.textContent = "Réserve";
    box.appendChild(resTitle);

    const entries = state.reserve[player];
    if (!entries.length) {
      const row = document.createElement("div");
      row.className = "roster-row empty";
      row.textContent = "Aucun";
      box.appendChild(row);
    }
    const maxField = (state.starters[player] || []).length;
    const aliveCount = state.tokens.filter((t) => t.player === player && !t.dead).length;
    const canEnter =
      state.phase !== "placement" &&
      aliveCount < maxField &&
      !!findFreeSpawnCell(player);
    entries.forEach((r) => {
      const c = charById(r.charId);
      const row = document.createElement("div");
      row.className = "roster-row reserve";
      row.textContent = `${c.name} — ${r.hp}/${c.hp} PV`;
      if (canEnter) {
        const enterBtn = document.createElement("button");
        enterBtn.textContent = "▶";
        enterBtn.title = "Choisir une case libre de la zone de départ où poser ce champion";
        enterBtn.addEventListener("click", () => fieldFromReserve(player, r));
        row.appendChild(enterBtn);
      }
      box.appendChild(row);
    });

    rosters.appendChild(box);
  });
}

function openSwapDialog(player, token) {
  if (swapCooldown(player) > 0) {
    alert(`Changement indisponible : encore ${swapCooldown(player)} tour(s) avant de pouvoir refaire un changement.`);
    return;
  }
  const fieldChar = charById(token.charId);
  const entries = state.reserve[player];
  const chosen = prompt(
    `Remplacer ${fieldChar.name} par qui ?\n\n` +
    entries.map((r, i) => `${i + 1}. ${charById(r.charId).name} (${r.hp} PV)`).join("\n")
  );
  if (chosen === null) return;
  const idx = parseInt(chosen, 10) - 1;
  if (isNaN(idx) || idx < 0 || idx >= entries.length) {
    alert("Choix invalide.");
    return;
  }
  swapChampion(player, token.id, idx);
}

function fieldFromReserve(player, reserveEntry) {
  const idx = state.reserve[player].indexOf(reserveEntry);
  if (idx < 0) return;
  if (!freeSpawnCells(player).length) {
    alert("Aucune case libre dans la zone de départ du remplaçant.");
    return;
  }
  pendingSpawn = { mode: "enter", player, reserveIdx: idx };
  log(`${charById(state.reserve[player][idx].charId).name} va entrer : cliquez une case libre de la zone de départ pour le poser. (Échap pour annuler)`);
  renderBoard();
}

function swapChampion(player, tokenId, reserveIdx) {
  const token = tokenById(tokenId);
  if (!token) return;
  const incoming = state.reserve[player][reserveIdx];
  if (!incoming) return;
  if (!freeSpawnCells(player).length) {
    alert("Aucune case libre dans la zone de départ pour le remplaçant.");
    return;
  }
  pendingSpawn = { mode: "swap", player, reserveIdx, tokenId };
  log(`${charById(token.charId).name} cède sa place : cliquez une case libre de la zone de départ pour poser ${charById(incoming.charId).name}. (Échap pour annuler)`);
  renderBoard();
}

/* Valide le clic du joueur puis pose le champion de la réserve en zone de départ.
   Le sortant (mode swap) retourne en réserve avec ses PV courants ; le posé
   arrive sur la case cliquée, plus sur la case du sortant. */
function commitSpawnPlacement(x, y) {
  const ps = pendingSpawn;
  if (!ps) return;
  if (!spawnChoiceAt(x, y)) return;
  const reserveEntries = state.reserve[ps.player];
  const incoming = reserveEntries[ps.reserveIdx];
  if (!incoming) {
    pendingSpawn = null;
    renderBoard();
    return;
  }

    /* Un remplacement suite à une élimination n'est pas annulable : le mort l'est
       déjà. Les actions volontaires (entrer, échanger) restent annulables. */
    if (ps.mode !== "replace") pushUndo();
    pendingSpawn = null;

    let newId;
    if (ps.mode === "swap") {
      const token = tokenById(ps.tokenId);
      if (!token) {
        renderBoard();
        return;
      }
      const outgoingChar = charById(token.charId);
      const outgoingHp = token.hp;
      state.tokens = state.tokens.filter((t) => t.id !== token.id);
      reserveEntries.splice(ps.reserveIdx, 1);
      reserveEntries.push({ charId: outgoingChar.id, hp: outgoingHp });
      newId = enterFromReserve(ps.player, incoming, x, y);
      log(`${outgoingChar.name} retourne en réserve.`);
      setSwapCooldown(ps.player, 5);
      selectedTokenId = null;
      reachable = [];
      attackCells = [];
      pendingAbility = null;
      save();
      checkFire(tokenById(newId));
    } else {
      reserveEntries.splice(ps.reserveIdx, 1);
      newId = enterFromReserve(ps.player, incoming, x, y);
      if (ps.mode === "replace") {
        log(`${charById(incoming.charId).name} le remplace sur le terrain.`);
        const prevSuppress = suppressReplacePrompt;
        suppressReplacePrompt = true;
        checkFire(tokenById(newId));
        suppressReplacePrompt = prevSuppress;
      }
      save();
    }
    renderBoard();
    checkTeamWipe();
  }

/* ---------- Panneau & log ---------- */

function openTokenPanel() {
  const panel = document.getElementById("board-log");
  const tok = tokenById(selectedTokenId);
  if (!tok) return;
  const c = charById(tok.charId);
  panel.innerHTML = "";
  const box = document.createElement("div");
  box.className = "token-panel";
  const cc = CAST_COLORS[tok.charId] || "#c5d3e8";
  box.style.setProperty("--card-color", cc);
  box.style.setProperty("--card-tint", cc + "26");
  const myTurn = isTurnOf(tok.player);

  const scrabReady = false;

  const AUTO_PASSIVE = ["koga", "xixz"];
  const isAuto = AUTO_PASSIVE.includes(tok.charId);

  box.innerHTML = `
    <div class="char-top">
      <div class="char-avatar">${esc(c.name.charAt(0))}</div>
      <div>
        <h3>${c.id === "calix" ? '<span class="char-brick" title="Création">🧱</span>' : ""}${esc(c.name)} <span class="char-role">${roleLabel(c.role)}</span></h3>
        <button id="panel-info" class="btn-info" title="Ouvrir la fiche complète">ℹ Fiche</button>
      </div>
    </div>
    <div class="char-stats">
      <span>PV ${tok.hp}/${c.hp}</span><span>ATQ ${c.atk}</span><span>DÉP ${myTurn ? movementBudget(tok) : c.mouvement}</span><span>PORTÉE ${c.range}</span>
    </div>
    ${tok.cd > 0 ? `<div class="cd-badge">Capacité en recharge : Cd ${tok.cd}</div>` : ""}
    <div class="hp-controls">
      <button data-delta="-1">-1 PV</button>
      <button data-delta="-5">-5</button>
      <button data-delta="1">+1 PV</button>
      <button data-delta="5">+5</button>
    </div>
    ${isAuto ? "" : `<button id="panel-ability" class="btn-swap" title="Utiliser la capacité (raccourci : X)" ${myTurn && tok.cd === 0 && (tok.stunned || 0) === 0 && !tok.abilityUsed && (tok.charId !== "betta" || state.bettaCharges > 0) && (tok.charId !== "rapido" || (!tok.hasMoved && (tok.flurry || !tok.hasAttacked))) && (tok.charId !== "jay" || !tok.jayAura) ? "" : "disabled"}>Utiliser : ${esc(c.ability.name)}${tok.charId === "betta" ? ` (${state.bettaCharges || 0}/2)` : ""}</button>`}
    <button id="panel-swap" class="btn-swap" ${(myTurn && (tok.hasAttacked || tok.abilityUsed)) || swapCooldown(tok.player) > 0 ? "disabled" : ""}>Remplacer par la réserve${swapCooldown(tok.player) > 0 ? ` (changement volontaire · Cd ${swapCooldown(tok.player)})` : ""}</button>
    ${myTurn && tok.abilityUsed && !isAuto ? `<div class="cd-badge">Capacité déjà utilisée ce tour : plus aucune action possible.</div>` : ""}
    ${scrabReady ? `<button class="btn-swap scrab-fire" data-token="${tok.id}">Déclencher la Riposte de SCRAB</button>` : ""}
    <div class="char-ability"><strong>${esc(c.ability.name)}</strong> — ${esc(c.ability.desc)}</div>
    ${c.passive && c.passive.name ? `<div class="char-passive"><strong>Passif : ${esc(c.passive.name)}</strong> — ${esc(c.passive.desc)}</div>` : ""}
    <ul class="actions">
      ${isTurnOf(tok.player) ? (isAuto ? "<li>Capacité automatique : elle se déclenche toute seule au début du tour.</li>" : "<li>Cases vertes = déplacement, cases rouges = attaque.</li>") : "<li>Ce champion ne peut pas agir pendant le tour adverse.</li>"}
    </ul>
  `;
  box.querySelectorAll("[data-delta]").forEach((b) => {
    b.addEventListener("click", () => changeHP(tok.id, parseInt(b.dataset.delta, 10)));
  });
  const infoBtn = box.querySelector("#panel-info");
  if (infoBtn) infoBtn.addEventListener("click", () => openCharDialog(c, tok.hp));
  const abilityBtn = box.querySelector("#panel-ability");
  if (abilityBtn) abilityBtn.addEventListener("click", () => useAbility(tok.id));
  const swapBtn = box.querySelector("#panel-swap");
  swapBtn.disabled = state.reserve[tok.player].length === 0 || (tok.stunned || 0) > 0 || swapCooldown(tok.player) > 0;
  swapBtn.addEventListener("click", () => openSwapDialog(tok.player, tok));
  const scrabBtn = box.querySelector(".scrab-fire");
  panel.appendChild(box);
}

function changeHP(id, delta) {
  const tok = tokenById(id);
  if (!tok) return;
  const max = charById(tok.charId).hp;
  tok.hp = Math.max(0, Math.min(max, tok.hp + delta));
  if (tok.hp <= 0 && !tok.dead) {
    tok.dead = true;
    if (selectedTokenId === tok.id) {
      selectedTokenId = null;
      reachable = [];
      attackCells = [];
    }
    log(`${charById(tok.charId).name} (${tok.player}) est éliminé.`);
    applyEliminationSideEffects(tok);
    handleReserveReplacementOnDeath(tok);
    checkDeathWipe(tok);
  }
  save();
  renderBoard();
}

function log(msg) {
  state.log.push({ turn: state.turnCount, msg });
  if (state.log.length > 200) state.log.shift();
  save();
}

function renderLog() {
  const panel = document.getElementById("board-log");
  const selTok = selectedTokenId ? tokenById(selectedTokenId) : null;
  const tok = selTok && !selTok.dead ? selTok : null;
  if (tok) {
    openTokenPanel();
    return;
  }
  panel.innerHTML = "<h3>Historique</h3>";
  const ul = document.createElement("ul");
  ul.className = "log-list";
  state.log.slice(-30).forEach((e) => {
    const li = document.createElement("li");
    li.textContent = `T${e.turn} : ${e.msg}`;
    ul.appendChild(li);
  });
  panel.appendChild(ul);
}

function esc(s) {
  const div = document.createElement("div");
  div.textContent = s == null ? "" : String(s);
  return div.innerHTML;
}

function refreshMapSelectOptions() {
  const sel = document.getElementById("map-select");
  sel.innerHTML = "";
  Object.keys(GAME.maps).forEach((key) => {
    const opt = document.createElement("option");
    opt.value = key;
    opt.textContent = GAME.maps[key].name;
    sel.appendChild(opt);
  });
  sel.value = GAME.activeMap;
}

function initMapSelect() {
  const sel = document.getElementById("map-select");
  refreshMapSelectOptions();
  sel.addEventListener("change", () => {
    if (!confirm("Changer de terrain ? La partie en cours sera réinitialisée.")) {
      sel.value = GAME.activeMap;
      return;
    }
    setActiveMap(sel.value);
    applyCustomMapFor(sel.value);
    state = defaultState();
    undoStack = [];
    save();
    renderLibrary();
    renderDecks();
    renderBoard();
    showHome();
  });

  const editBtn = document.getElementById("edit-toggle");
  editBtn.addEventListener("click", () => {
    editMode = !editMode;
    editBtn.classList.toggle("active", editMode);
    editBtn.textContent = editMode ? "Jeu (quitter l'édition)" : "Édition terrain";
    renderBoard();
  });

  document.getElementById("save-map").addEventListener("click", () => {
    const currentName = GAME.maps[GAME.activeMap].name;
    const name = prompt("Nom du terrain :", currentName);
    if (name === null) return;
    const trimmed = name.trim();
    if (!trimmed) {
      alert("Nom invalide.");
      return;
    }
    GAME.maps[GAME.activeMap].name = trimmed;
    if (isUserMap(GAME.activeMap)) {
      saveUserMap(GAME.activeMap);
    } else {
      saveFixedMapFor(GAME.activeMap, trimmed);
    }
    const opt = sel.querySelector(`option[value="${GAME.activeMap}"]`);
    if (opt) opt.textContent = trimmed;
    alert(`Terrain enregistré sous le nom « ${trimmed} ».`);
    renderBoard();
  });
}

/* ---------- Selecteur de terrain aleatoire ---------- */

function randomMapFor() {
  const ids = Object.keys(GAME.maps).filter((id) => GAME.maps[id]);
  if (!ids.length) return;
  const names = ids.map((id) => GAME.maps[id].name);
  const pick = ids[Math.floor(Math.random() * ids.length)];
  loadMap(pick);
  const btn = document.getElementById("maps-random");
  btn.textContent = "🎲 " + GAME.maps[pick].name;
  btn.title = "Tirage : " + names.join(" · ");
  setTimeout(() => {
    btn.textContent = "🎲 Terrain au hasard";
  }, 2500);
  log("🎲 Terrain tiré au sort : « " + GAME.maps[pick].name + " » (tirage : " + names.join(" · ") + ").");
}

/* ---------- Écran d'accueil ---------- */

function showHome() {
  document.getElementById("nav-home").classList.add("active");
  document.getElementById("home-screen").classList.add("open");
}

function hideHome() {
  document.getElementById("nav-home").classList.remove("active");
  document.getElementById("home-screen").classList.remove("open");
}

document.getElementById("nav-home").addEventListener("click", showHome);

document.getElementById("home-play").addEventListener("click", () => {
  openPlayMode();
});

document.getElementById("home-create").addEventListener("click", () => {
  hideHome();
  document.querySelector('[data-tab="maps"]').click();
});

document.getElementById("home-maps").addEventListener("click", () => {
  hideHome();
  document.querySelector('[data-tab="library"]').click();
});

document.getElementById("maps-create").addEventListener("click", () => {
  hideHome();
  createNewTerrain();
});

document.getElementById("maps-random").addEventListener("click", () => {
  randomMapFor();
});

document.getElementById("maps-import").addEventListener("click", () => {
  importMapJson();
});

function createNewTerrain() {
  const name = prompt("Nom du nouveau terrain :", "Nouveau terrain");
  if (name === null) return;
  const trimmed = (name || "").trim() || "Nouveau terrain";
  const m = createBlankMap(trimmed);
  const store = loadNewMaps();
  store[m.id] = m;
  localStorage.setItem(NEW_MAPS_KEY, JSON.stringify(store));
  GAME.maps[m.id] = m;
  enterEditorForMap(m.id);
}

function importMapJson() {
  const raw = prompt("Collez le JSON du terrain à importer (bouton « Exporter » depuis l'autre appareil) :");
  if (raw === null) return;
  const text = (raw || "").trim();
  if (!text) return;
  let data;
  try {
    data = JSON.parse(text);
  } catch (e) {
    alert("JSON invalide : " + e.message);
    return;
  }
  const isMap = (o) => o && typeof o === "object" && Array.isArray(o.tiles);
  const candidates = [];
  if (isMap(data)) candidates.push(data);
  else if (data && typeof data === "object") {
    Object.keys(data).forEach((k) => { if (isMap(data[k])) candidates.push(data[k]); });
  }
  if (!candidates.length) {
    alert("Aucun terrain valide trouvé dans ce JSON.");
    return;
  }
  const store = loadNewMaps();
  let added = 0;
  candidates.forEach((m) => {
    let id = typeof m.id === "string" && m.id ? m.id : "user-" + Date.now();
    if (GAME.maps[id] || store[id]) id = "user-" + Date.now() + "-" + Math.floor(Math.random() * 100000);
    const map = {
      id,
      name: m.name || "Terrain importé",
      cols: m.cols || 15,
      rows: m.rows || 10,
      tiles: (m.tiles || []).map((r) => r.slice()),
      edgesWalls: (m.edgesWalls || []).slice(),
      fireCells: (m.fireCells || []).map((p) => p.slice()),
      healCells: (m.healCells || []).map((p) => p.slice()),
      speedCells: (m.speedCells || []).map((p) => p.slice()),
      voidCells: (m.voidCells || []).map((p) => p.slice()),
      startZones: m.startZones || makeDefaultZones(),
      objectives: m.objectives || { A: { x: 2, y: 4, hp: 20 }, B: { x: 12, y: 4, hp: 20 } }
    };
    store[id] = map;
    GAME.maps[id] = map;
    added++;
  });
  localStorage.setItem(NEW_MAPS_KEY, JSON.stringify(store));
  refreshMapSelectOptions();
  renderMapGallery();
  alert(added + " terrain(s) importé(s).");
}

function loadMap(id) {
  setActiveMap(id);
  state = defaultState();
  undoStack = [];
  save();
  renderLibrary();
  renderDecks();
  refreshMapSelectOptions();
  renderBoard();
  hideHome();
  showHome();
}

function enterEditorForMap(id) {
  const m = GAME.maps[id];
  if (!m) return;
  setActiveMap(id);
  state = defaultState();
  undoStack = [];
  save();
  editMode = true;
  const editBtn = document.getElementById("edit-toggle");
  editBtn.classList.add("active");
  editBtn.textContent = "Jeu (quitter l'édition)";
  refreshMapSelectOptions();
  renderBoard();
  hideHome();
  document.querySelector('[data-tab="board"]').click();
}

function previewGrid(m) {
  const g = document.createElement("div");
  g.className = "map-preview";
  g.style.gridTemplateColumns = `repeat(${m.cols}, 1fr)`;
  for (let y = 0; y < m.rows; y++) {
    for (let x = 0; x < m.cols; x++) {
      const c = document.createElement("span");
      c.className = "mp-cell";
      if (m.tiles[y] && m.tiles[y][x] === 1) c.classList.add("wall");
      else if ((m.fireCells || []).some(([fx, fy]) => fx === x && fy === y)) c.classList.add("fire");
      else if ((m.healCells || []).some(([hx, hy]) => hx === x && hy === y)) c.classList.add("heal");
      else if ((m.speedCells || []).some(([sx, sy]) => sx === x && sy === y)) c.classList.add("speed");
      else if ((m.voidCells || []).some(([vx, vy]) => vx === x && vy === y)) c.classList.add("void");
      ["A", "B"].forEach((p) => {
        const o = m.objectives[p];
        if (o && o.x === x && o.y === y) c.classList.add("obj");
      });
      g.appendChild(c);
    }
  }
  return g;
}

function renderMapGallery() {
  const host = document.getElementById("map-gallery");
  host.innerHTML = "";
  const ids = Object.keys(GAME.maps);
  if (!ids.length) {
    host.innerHTML = '<p class="empty-msg">Aucun terrain disponible.</p>';
    return;
  }
  ids.forEach((id) => {
    const m = GAME.maps[id];
    if (!m) return;
    const card = document.createElement("div");
    card.className = "map-card";
    const head = document.createElement("div");
    head.className = "map-card-head";
    const nm = document.createElement("strong");
    nm.textContent = m.name;
    const dim = document.createElement("span");
    dim.textContent = `${m.cols}×${m.rows}`;
    head.appendChild(nm);
    head.appendChild(dim);
    card.appendChild(head);
    card.appendChild(previewGrid(m));
    const actions = document.createElement("div");
    actions.className = "map-card-actions";
    const loadBtn = document.createElement("button");
    loadBtn.textContent = "Charger";
    loadBtn.addEventListener("click", () => loadMap(id));
    const editBtn = document.createElement("button");
    editBtn.textContent = "Modifier";
    editBtn.addEventListener("click", () => enterEditorForMap(id));
    const expBtn = document.createElement("button");
    expBtn.textContent = "Exporter";
    expBtn.title = "Copier le terrain (JSON) dans le presse-papiers";
    expBtn.addEventListener("click", () => exportMapJson(id, expBtn));
    actions.appendChild(loadBtn);
    actions.appendChild(editBtn);
    actions.appendChild(expBtn);
    if (isUserMap(id)) {
      const delBtn = document.createElement("button");
      delBtn.textContent = "Supprimer";
      delBtn.addEventListener("click", () => {
        if (!confirm(`Supprimer le terrain « ${m.name} » ?`)) return;
        deleteUserMap(id);
        delete GAME.maps[id];
        if (GAME.activeMap === id) setActiveMap("map1");
        refreshMapSelectOptions();
        renderMapGallery();
      });
      actions.appendChild(delBtn);
    }
    card.appendChild(actions);
    host.appendChild(card);
  });
}

function exportMapJson(id, btn) {
  const m = GAME.maps[id];
  if (!m) return;
  const payload = {
    id: m.id || id,
    name: m.name,
    cols: m.cols,
    rows: m.rows,
    tiles: (m.tiles || []).map((r) => r.slice()),
    edgesWalls: (m.edgesWalls || []).slice(),
    fireCells: (m.fireCells || []).map((p) => p.slice()),
    healCells: (m.healCells || []).map((p) => p.slice()),
    speedCells: (m.speedCells || []).map((p) => p.slice()),
    voidCells: (m.voidCells || []).map((p) => p.slice()),
    startZones: m.startZones,
    objectives: m.objectives
  };
  const text = JSON.stringify(payload);
  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
    } catch (e) {}
    ta.remove();
  };
  const done = () => {
    const old = btn.textContent;
    btn.textContent = "Copié ✓";
    setTimeout(() => {
      btn.textContent = old;
    }, 1200);
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done, () => {
      fallback();
      done();
    });
  } else {
    fallback();
    done();
  }
}

/* ================= Partie LAN (WebRTC 1v1) ================= */

const LAN_ICE = { iceServers: [{ urls: "stun:stun.l.google.com:19302" }] };

function lanLocalTeam() {
  return lanRole === "client" ? "B" : "A";
}

function lanIsActingPlayer() {
  if (!lanMode) return true;
  const team = lanLocalTeam();
  if (state.phase === "placement") return state.placingPlayer === team;
  return state.turn === team;
}

function lanSetStatus(id, txt) {
  const el = document.getElementById(id);
  if (el) el.textContent = txt;
}

function lanCopy(id) {
  const el = document.getElementById(id);
  if (!el) return;
  el.focus();
  el.select();
  try { document.execCommand("copy"); } catch (e) {}
}

function lanWaitIce(pc) {
  return new Promise((resolve) => {
    if (pc.iceGatheringState === "complete") return resolve();
    let done = false;
    const finish = () => { if (done) return; done = true; resolve(); };
    pc.addEventListener("icecandidate", (e) => { if (!e.candidate) finish(); });
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") finish(); });
    setTimeout(finish, 2500);
  });
}

function lanSend(obj) {
  const data = JSON.stringify(obj);
  if (onlineMode) {
    if (onlineWs && onlineWs.readyState === 1) {
      try { onlineWs.send(data); } catch (e) {}
    }
    return;
  }
  if (rtcDc && rtcDc.readyState === "open") {
    try { rtcDc.send(data); } catch (e) {}
  }
}

function mapSnapshot(m) {
  if (!m) return null;
  return {
    id: m.id,
    name: m.name,
    cols: m.cols,
    rows: m.rows,
    tiles: (m.tiles || []).map((r) => r.slice()),
    edgesWalls: (m.edgesWalls || []).slice(),
    fireCells: (m.fireCells || []).map((p) => p.slice()),
    healCells: (m.healCells || []).map((p) => p.slice()),
    speedCells: (m.speedCells || []).map((p) => p.slice()),
    voidCells: (m.voidCells || []).map((p) => p.slice()),
    startZones: m.startZones,
    objectives: m.objectives
  };
}

function applyRemoteMap(mapName, mapData) {
  if (!mapName || !mapData || !Array.isArray(mapData.tiles)) return;
  GAME.maps[mapName] = mapData;
}

function lanBroadcast() {
  if (onlineMode) {
    if (onlineSetupPhase || lanRole !== "host") return;
  } else if (!lanMode || lanRole !== "host" || !rtcDc || rtcDc.readyState !== "open") {
    return;
  }
  const snap = JSON.parse(JSON.stringify(state));
  snap.mapName = GAME.activeMap;
  snap.mapData = mapSnapshot(GAME.maps[GAME.activeMap]);
  snap.lanSelectedTokenId = selectedTokenId;
  snap.lanPendingAbility = pendingAbility;
  snap.lanPendingSpawn = pendingSpawn;
  snap.lanSeq = lanSeq++;
  lanSend({ type: "state", state: snap });
}

function lanSendAction(action) {
  lanSend({ type: "action", action });
}

function lanApplySelection(id) {
  selectedTokenId = null;
  reachable = [];
  attackCells = [];
  pendingAbility = null;
  const tok = id ? tokenById(id) : null;
  if (!tok || tok.dead) return;
  selectedTokenId = id;
  if (isTurnOf(tok.player)) {
    const spent = tok.hasAttacked || tok.abilityUsed;
    const frozen = state.guardZones.some((z) => Math.abs(z.x - tok.x) <= 1 && Math.abs(z.y - tok.y) <= 1);
    reachable = frozen || tok.abilityUsed ? [] : reachableFrom(tok.x, tok.y, movementBudget(tok), tok.player);
    attackCells = spent ? [] : attackCellsOf(tok);
  }
}

function lanOnState(snap) {
  const sel = snap.lanSelectedTokenId;
  const mapName = snap.mapName;
  const mapData = snap.mapData;
  const pendAb = snap.lanPendingAbility;
  const pendSp = snap.lanPendingSpawn;
  delete snap.lanSelectedTokenId;
  delete snap.mapName;
  delete snap.mapData;
  delete snap.lanPendingAbility;
  delete snap.lanPendingSpawn;
  delete snap.lanSeq;
  if (mapData) applyRemoteMap(mapName, mapData);
  if (mapName && GAME.activeMap !== mapName) setActiveMap(mapName);
  state = snap;
  pendingAbility = pendAb || null;
  pendingSpawn = pendSp || null;
  lanApplySelection(sel);
  hideHome();
  const boardSection = document.getElementById("tab-board");
  if (boardSection && !boardSection.classList.contains("active")) {
    const btn = document.querySelector('[data-tab="board"]');
    if (btn) btn.click();
  }
  renderBoard();
}

function lanExpandArgs(fn, args) {
  if (fn === "fieldFromReserve") return [args[0], state.reserve[args[0]][args[1]]];
  return args;
}

function lanRemoteActsNow() {
  if (state.winner) return false;
  if (state.phase === "placement") return state.placingPlayer === "B";
  return state.turn === "B";
}

function handleLanMessage(msg) {
  if (!msg) return;
  if (msg.type === "state" && lanRole === "client") {
    lanOnState(msg.state);
    return;
  }
  if (msg.type === "char-dialog" && lanRole === "client") {
    const c = charById(msg.charId);
    if (c) openCharDialogOrig(c, msg.hp);
    return;
  }
  if (msg.type === "action" && lanRole === "host") {
    const a = msg.action || {};
    const viewOnly = a.kind === "tokenClick";
    if (!viewOnly && !lanRemoteActsNow()) {
      lanBroadcast();
      return;
    }
    lanApplying = true;
    try {
      if (a.kind === "cellClick") {
        cellClick(a.x, a.y);
      } else if (a.kind === "tokenClick") {
        const tok = tokenById(a.id);
        if (tok) handleTokenClick(tok);
      } else if (a.kind === "endTurn") {
        pushUndo();
        endPlayerTurn();
      } else if (a.kind === "call") {
        const fn = window[a.fn];
        if (typeof fn === "function") fn.apply(null, lanExpandArgs(a.fn, a.args || []));
      }
    } catch (e) {}
    lanApplying = false;
    lanBroadcast();
  }
}

function lanPatchFn(name, sendArgs) {
  const orig = window[name];
  if (typeof orig !== "function") return;
  window[name] = function (...args) {
    if (lanMode && !lanApplying) {
      if (lanRole === "client") {
        lanSendAction({ kind: "call", fn: name, args: sendArgs ? sendArgs(args) : args });
        return;
      }
      if (!lanIsActingPlayer()) return;
    }
    return orig.apply(this, args);
  };
}

async function lanHostCreate() {
  try {
    lanMode = true;
    lanRole = "host";
    lanConnected = false;
    rtcPc = new RTCPeerConnection(LAN_ICE);
    rtcDc = rtcPc.createDataChannel("luxeria");
    rtcDc.onopen = () => {
      lanConnected = true;
      document.getElementById("lan-host-start").disabled = false;
      lanSetStatus("lan-host-status", "Connecté. Cliquez « Lancer la partie ».");
      lanBroadcast();
    };
    rtcDc.onclose = () => { lanConnected = false; lanSetStatus("lan-host-status", "Connexion fermée."); };
    rtcDc.onmessage = (e) => {
      let m = null;
      try { m = JSON.parse(e.data); } catch (err) {}
      handleLanMessage(m);
    };
    const offer = await rtcPc.createOffer();
    await rtcPc.setLocalDescription(offer);
    await lanWaitIce(rtcPc);
    document.getElementById("lan-offer").value = JSON.stringify(rtcPc.localDescription);
    lanSetStatus("lan-host-status", "Offre prête. Copiez-la vers le client.");
  } catch (e) {
    lanSetStatus("lan-host-status", "Erreur lors de la création de l'offre.");
  }
}

async function lanHostConnect() {
  try {
    const ans = JSON.parse(document.getElementById("lan-answer-in").value);
    await rtcPc.setRemoteDescription(ans);
    lanSetStatus("lan-host-status", "Réponse enregistrée. En attente de connexion…");
  } catch (e) {
    lanSetStatus("lan-host-status", "Réponse invalide.");
  }
}

function lanHostStart() {
  if (lanRole !== "host") return;
  if (!lanConnected) {
    lanSetStatus("lan-host-status", "Le client n'est pas encore connecté.");
    return;
  }
  document.getElementById("lan-dialog").close();
  openPlayMode();
}

async function lanJoinGen() {
  try {
    const offer = JSON.parse(document.getElementById("lan-offer-in").value);
    lanMode = true;
    lanRole = "client";
    lanConnected = false;
    rtcPc = new RTCPeerConnection(LAN_ICE);
    rtcPc.ondatachannel = (e) => {
      rtcDc = e.channel;
      rtcDc.onopen = () => {
        lanConnected = true;
        lanSetStatus("lan-join-status", "Connecté à l'hôte. En attente du lancement de la partie…");
      };
      rtcDc.onclose = () => { lanConnected = false; lanSetStatus("lan-join-status", "Connexion fermée."); };
      rtcDc.onmessage = (ev) => {
        let m = null;
        try { m = JSON.parse(ev.data); } catch (err) {}
        handleLanMessage(m);
      };
    };
    await rtcPc.setRemoteDescription(offer);
    const answer = await rtcPc.createAnswer();
    await rtcPc.setLocalDescription(answer);
    await lanWaitIce(rtcPc);
    document.getElementById("lan-answer-out").value = JSON.stringify(rtcPc.localDescription);
    lanSetStatus("lan-join-status", "Réponse prête. Copiez-la vers l'hôte.");
  } catch (e) {
    lanSetStatus("lan-join-status", "Offre invalide.");
  }
}

document.getElementById("home-lan").addEventListener("click", () => {
  const dlg = document.getElementById("lan-dialog");
  if (dlg) dlg.showModal();
});

document.querySelectorAll(".lan-tab").forEach((btn) => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".lan-tab").forEach((b) => b.classList.toggle("active", b === btn));
    document.getElementById("lan-host").style.display = btn.dataset.lantab === "host" ? "flex" : "none";
    document.getElementById("lan-join").style.display = btn.dataset.lantab === "join" ? "flex" : "none";
  });
});

document.getElementById("lan-close").addEventListener("click", () => {
  const dlg = document.getElementById("lan-dialog");
  if (dlg) dlg.close();
});
document.getElementById("lan-host-create").addEventListener("click", lanHostCreate);
document.getElementById("lan-host-connect").addEventListener("click", lanHostConnect);
document.getElementById("lan-host-start").addEventListener("click", lanHostStart);
document.getElementById("lan-offer-copy").addEventListener("click", () => lanCopy("lan-offer"));
document.getElementById("lan-answer-copy").addEventListener("click", () => lanCopy("lan-answer-out"));
document.getElementById("lan-join-gen").addEventListener("click", lanJoinGen);

lanPatchFn("cellClick");
lanPatchFn("useAbility");
lanPatchFn("swapChampion");
lanPatchFn("changeHP");
lanPatchFn("attackAt");
lanPatchFn("resolvePendingOnCell");
lanPatchFn("fieldFromReserve", (a) => [a[0], state.reserve[a[0]].indexOf(a[1])]);
lanPatchFn("endPlayerTurn");

const openCharDialogOrig = openCharDialog;
const handleTokenClickOrig = handleTokenClick;

window.handleTokenClick = function (t) {
  if (lanMode && !lanApplying) {
    if (lanRole === "client") {
      if (t && t.id) lanSendAction({ kind: "tokenClick", id: t.id });
      return;
    }
    if (!lanIsActingPlayer()) return;
  }
  return handleTokenClickOrig.apply(this, arguments);
};

window.openCharDialog = function (c, hp) {
  if (lanMode && lanApplying && lanRole === "host" && c) {
    lanSend({ type: "char-dialog", charId: c.id, hp: hp });
    return;
  }
  return openCharDialogOrig.apply(this, arguments);
};

/* ================= fin Partie LAN ================= */

/* ================= Partie en ligne (matchmaking + relais WebSocket) ================= */

function onlineSend(obj) {
  if (!onlineWs || onlineWs.readyState !== 1) return;
  try { onlineWs.send(JSON.stringify(obj)); } catch (e) {}
}

function onlineSetLobbyStatus(txt) {
  const el = document.getElementById("online-status");
  if (el) el.textContent = txt || "";
}

function onlineShowWaiting(txt) {
  const el = document.getElementById("online-toast");
  if (!el) return;
  el.textContent = txt;
  el.classList.add("show");
}

function onlineHideWaiting() {
  const el = document.getElementById("online-toast");
  if (el) el.classList.remove("show");
}

function onlineIsHost() {
  return onlineMode && lanRole === "host";
}

function openOnlineLobby() {
  const dlg = document.getElementById("online-dialog");
  if (!dlg) return;
  onlineSetLobbyStatus(
    location.host
      ? "Cliquez « Rechercher une partie » pour être mis en file d'attente."
      : "Mode en ligne indisponible en local : ouvrez le site via son adresse hébergée (pas le fichier local)."
  );
  dlg.showModal();
}

function onlineSearch() {
  if (onlineWs) return;
  if (!location.host) {
    onlineSetLobbyStatus("Le mode en ligne nécessite le site hébergé (pas l'ouverture locale du fichier).");
    return;
  }
  const proto = location.protocol === "https:" ? "wss:" : "ws:";
  onlineSetLobbyStatus("Connexion au serveur…");
  let ws;
  try {
    ws = new WebSocket(proto + "//" + location.host);
  } catch (e) {
    onlineSetLobbyStatus("Impossible de contacter le serveur.");
    return;
  }
  onlineWs = ws;
  ws.onopen = () => {
    if (onlineWs !== ws) return;
    onlineSetLobbyStatus("Recherche d'un adversaire…");
    try { ws.send(JSON.stringify({ type: "queue" })); } catch (e) {}
  };
  ws.onmessage = onlineOnMessage;
  ws.onerror = () => {
    if (onlineWs === ws) onlineSetLobbyStatus("Erreur de connexion au serveur.");
  };
  ws.onclose = () => {
    if (onlineWs === ws) {
      onlineWs = null;
      if (!onlineMode) onlineSetLobbyStatus("Connexion fermée.");
    }
  };
}

function onlineDisconnect() {
  if (onlineWs) {
    try { if (onlineWs.readyState === 1) onlineWs.send(JSON.stringify({ type: "cancel" })); } catch (e) {}
    try { onlineWs.close(); } catch (e) {}
  }
  onlineWs = null;
  onlineMode = false;
  onlineSetupPhase = false;
  onlineRemoteDeck = null;
  onlineRemoteStarters = null;
  onlineLocalStarters = null;
  onlineStartersRequested = false;
  lanMode = false;
  lanRole = null;
  lanConnected = false;
  buildMode = null;
  onlineHideWaiting();
}

function onlineAbort(msg) {
  onlineDisconnect();
  showHome();
  if (msg) { try { alert(msg); } catch (e) {} }
}

function onlinePeerLeft() {
  onlineDisconnect();
  try { alert("L'adversaire a quitté la partie."); } catch (e) {}
  showHome();
}

function onlineSetStatus(text) {
  onlineSetLobbyStatus(text);
}

function onlineOnMessage(ev) {
  let msg = null;
  try { msg = JSON.parse(ev.data); } catch (e) { return; }
  if (!msg || typeof msg !== "object") return;
  switch (msg.type) {
    case "queued":
      onlineSetStatus("Recherche d'un adversaire…");
      return;
    case "queue-left":
      return;
    case "matched":
      onlineOnMatched(msg.role);
      return;
    case "peer-left":
      onlinePeerLeft();
      return;
    case "setup":
      if (lanRole === "client") onlineClientSetup(msg.mapName, msg.map, msg.mode, msg.method);
      return;
    case "draft-pick":
      if (lanRole === "host") onlineHostDraftPick(msg.charId);
      return;
    case "draft-state":
      if (lanRole === "client") onlineClientDraftState(msg);
      return;
    case "teams":
      if (lanRole === "client") onlineClientTeams(msg);
      return;
    case "live-deck":
      if (msg.team && msg.team !== lanLocalTeam()) onlineApplyLiveDeck(msg.team, msg.deck);
      return;
    case "deck":
      if (lanRole === "host") onlineHostReceiveDeck(msg.deck);
      return;
    case "starters-request":
      if (lanRole === "client") onlineOpenStarterPicker("B");
      return;
    case "starters":
      if (lanRole === "host") onlineHostReceiveStarters(msg.starters);
      return;
    case "start":
      if (lanRole === "client") onlineClientStart();
      return;
    default:
      handleLanMessage(msg);
  }
}

function onlineOnMatched(role) {
  onlineMode = true;
  lanMode = true;
  lanRole = role;
  lanConnected = true;
  onlineSetupPhase = true;
  const dlg = document.getElementById("online-dialog");
  if (role === "host") {
    if (dlg && dlg.open) dlg.close();
    onlineHideWaiting();
    onlineHostChooseMap();
  } else {
    onlineSetStatus("Adversaire trouvé ! En attente du terrain choisi par l'hôte…");
  }
}

function onlineHostChooseMap() {
  const ids = Object.keys(GAME.maps).filter((id) => GAME.maps[id]);
  if (!ids.length) { onlineAbort("Aucun terrain disponible."); return; }
  askChoicePrompt({
    icon: "🌐",
    title: "Mode de jeu en ligne",
    text: "Choisissez le mode de la partie.",
    cancel: "Quitter la partie",
    options: [
      { label: "Mode normal", value: "classic" },
      { label: "💥 Rampage (3c3)", value: "rampage" }
    ]
  }).then((modeVal) => {
    if (!onlineMode) return;
    if (!modeVal) { onlineAbort("Partie annulée."); return; }
    const mode = modeVal === "rampage" ? "rampage" : "classic";
    const options = ids.map((id) => ({ label: GAME.maps[id].name, value: id }));
    options.push({ label: "🎲 Au hasard", value: "__random__" });
    askChoicePrompt({
      icon: "🌐",
      title: "Terrain en ligne",
      text: mode === "rampage"
        ? "Rampage (3c3, sans réserve ni objectif). Choisissez le terrain."
        : "Choisissez le terrain de la partie.",
      cancel: "Quitter la partie",
      options
    }).then((val) => {
      if (!onlineMode) return;
      if (!val) { onlineAbort("Partie annulée."); return; }
      let id = val;
      if (id === "__random__") id = ids[Math.floor(Math.random() * ids.length)];
      askChoicePrompt({
        icon: "🧩",
        title: "Sélection des champions",
        text: mode === "rampage"
          ? "Rampage : 3 champions de 3 classes différentes."
          : "Mode normal : 5 champions, un par classe.",
        cancel: "Quitter la partie",
        options: [
          { label: "🔁 Tour par tour (draft)", value: "draft" },
          { label: "🎲 Aléatoire", value: "random" },
          { label: "✍️ Composition libre", value: "free" }
        ]
      }).then((methodVal) => {
        if (!onlineMode) return;
        if (!methodVal) { onlineAbort("Partie annulée."); return; }
        setActiveMap(id);
        state = defaultState();
        state.mode = mode;
        state.decks = { A: [], B: [] };
        buildMode = null;
        undoStack = [];
        onlineSend({ type: "setup", mapName: id, map: GAME.maps[id], mode, method: methodVal });
        onlineInitMethod(methodVal, "host");
      });
    });
  });
}

/* Initialise la méthode de composition côté hôte / client. */
function onlineInitMethod(method, role) {
  if (method === "draft") {
    onlineBeginDraft(role);
  } else if (method === "random") {
    if (role === "host") onlineRandomHost();
    else onlineShowWaiting("Équipes tirées au sort. En attente du début…");
  } else {
    onlineBeginBuildFor(role === "host" ? "A" : "B");
  }
}

function onlineBeginDraft(role) {
  buildMode = { player: "A", draft: true };
  state.decks = { A: [], B: [] };
  state.starters = { A: [], B: [] };
  save();
  renderDecks();
  hideHome();
  const tab = document.querySelector('[data-tab="library"]');
  if (tab) tab.click();
  renderBuildBanner();
  renderLibrary();
  onlineShowWaiting(role === "client"
    ? "Draft — en attente du premier choix adverse…"
    : "Draft — à vous de choisir (équipe A).");
}

function onlineRandomHost() {
  state.decks = { A: randomTeam(teamSizeTarget(), null) };
  state.decks.B = randomTeam(teamSizeTarget(), state.decks.A);
  state.starters = isRampage()
    ? { A: state.decks.A.slice(), B: state.decks.B.slice() }
    : { A: randomStarters(state.decks.A), B: randomStarters(state.decks.B) };
  onlineSend({ type: "teams", decks: state.decks, starters: state.starters });
  save();
  renderDecks();
  buildMode = null;
  onlineSetupPhase = false;
  onlineHideWaiting();
  onlineSend({ type: "start" });
  startGame();
}

function onlineClientTeams(msg) {
  state.decks = { A: ((msg.decks && msg.decks.A) || []).slice(), B: ((msg.decks && msg.decks.B) || []).slice() };
  state.starters = {
    A: ((msg.starters && msg.starters.A) || []).slice(),
    B: ((msg.starters && msg.starters.B) || []).slice()
  };
  save();
  renderDecks();
}

/* Hôte : reçoit un choix du client (équipe B). */
function onlineHostDraftPick(charId) {
  if (!buildMode || !buildMode.draft) return;
  if (buildMode.player !== "B") return;
  if (!draftCanPick("B", charId)) return;
  state.decks.B.push(charId);
  save();
  onlineDraftAfterPick();
}

/* Hôte : avance le tour et transmet l'état du draft. */
function onlineDraftAfterPick() {
  if (teamComplete("A") && teamComplete("B")) {
    onlineSend({ type: "draft-state", decks: { A: state.decks.A.slice(), B: state.decks.B.slice() }, turn: null, done: true });
    onlineDraftFinishHost();
    return;
  }
  const cur = buildMode.player;
  const other = cur === "A" ? "B" : "A";
  buildMode.player = teamComplete(other) ? cur : other;
  renderBuildBanner();
  renderLibrary();
  onlineSend({ type: "draft-state", decks: { A: state.decks.A.slice(), B: state.decks.B.slice() }, turn: buildMode.player, done: false });
}

function onlineClientDraftState(msg) {
  state.decks = { A: ((msg.decks && msg.decks.A) || []).slice(), B: ((msg.decks && msg.decks.B) || []).slice() };
  save();
  if (msg.done) {
    buildMode = null;
    renderBuildBanner();
    renderLibrary();
    onlineShowWaiting("Draft terminé. En attente du début…");
    return;
  }
  buildMode = { player: msg.turn, draft: true };
  renderBuildBanner();
  renderLibrary();
  onlineShowWaiting(msg.turn === lanLocalTeam()
    ? "Draft — à vous de choisir !"
    : "Draft — au tour de l'adversaire…");
}

function onlineDraftFinishHost() {
  renderBuildBanner();
  renderLibrary();
  if (isRampage()) {
    state.starters = { A: state.decks.A.slice(), B: state.decks.B.slice() };
    save();
    buildMode = null;
    onlineSetupPhase = false;
    onlineHideWaiting();
    onlineSend({ type: "start" });
    startGame();
  } else {
    buildMode = null;
    onlineRemoteDeck = state.decks.B.slice();
    onlineMaybeProceedHost();
  }
}

function onlineClientSetup(mapName, mapData, mode, method) {
  if (!onlineMode) return;
  const dlg = document.getElementById("online-dialog");
  if (dlg && dlg.open) dlg.close();
  onlineHideWaiting();
  if (mapData) applyRemoteMap(mapName, mapData);
  if (mapName && GAME.maps[mapName]) setActiveMap(mapName);
  state = defaultState();
  state.mode = mode === "rampage" ? "rampage" : "classic";
  state.decks = { A: [], B: [] };
  buildMode = null;
  undoStack = [];
  onlineInitMethod(method || "free", "client");
}

function onlineBeginBuildFor(team) {
  buildMode = { player: team };
  renderBuildBanner();
  hideHome();
  const tab = document.querySelector('[data-tab="library"]');
  if (tab) tab.click();
  renderLibrary();
  onlineShowWaiting("Composez votre équipe (" + teamSizeTarget() + " champions).");
}

function onlineApplyLiveDeck(team, deck) {
  if (!Array.isArray(deck)) return;
  state.decks[team] = deck.slice();
  renderLibrary();
}

function onlineLocalBuildDone() {
  const team = lanLocalTeam();
  if (team === "B") {
    onlineSend({ type: "deck", team, deck: state.decks[team].slice() });
  }
  buildMode = null;
  renderBuildBanner();
  if (lanRole === "host") {
    onlineMaybeProceedHost();
  } else {
    onlineShowWaiting("Équipe complète. En attente de l'adversaire…");
  }
}

function onlineHostReceiveDeck(deck) {
  if (!Array.isArray(deck) || deck.length < teamSizeTarget()) {
    onlineAbort("L'équipe adverse est invalide.");
    return;
  }
  onlineRemoteDeck = deck.slice();
  onlineMaybeProceedHost();
}

function onlineMaybeProceedHost() {
  if (lanRole !== "host" || onlineStartersRequested) return;
  if (!teamComplete("A")) return;
  if (!onlineRemoteDeck || onlineRemoteDeck.length < teamSizeTarget()) {
    onlineShowWaiting("En attente de l'équipe adverse…");
    return;
  }
  state.decks.B = onlineRemoteDeck.slice();
  renderBuildBanner();
  onlineStartersRequested = true;
  onlineHideWaiting();
  if (isRampage()) {
    renderDecks();
    state.starters = { A: state.decks.A.slice(), B: state.decks.B.slice() };
    save();
    buildMode = null;
    onlineSetupPhase = false;
    onlineSend({ type: "start" });
    startGame();
    return;
  }
  onlineSend({ type: "starters-request" });
  onlineOpenStarterPicker("A");
}

function onlineOpenStarterPicker(team) {
  const dlg = document.getElementById("starter-dialog");
  const content = document.getElementById("starter-content");
  content.innerHTML = "";
  const col = document.createElement("div");
  col.className = "starter-col";
  col.innerHTML = `<h3>Équipe ${team} — choisissez 3 titulaires</h3>`;
  (state.decks[team] || []).forEach((id) => {
    const c = charById(id);
    if (!c) return;
    const chip = document.createElement("button");
    chip.className = "starter-chip";
    chip.dataset.player = team;
    chip.textContent = `${c.name} (${roleLabel(c.role)})`;
    col.appendChild(chip);
  });
  content.appendChild(col);

  const confirmBtn = document.getElementById("starter-confirm");
  confirmBtn.textContent = "Valider mes titulaires";
  confirmBtn.disabled = true;
  const update = () => {
    const n = content.querySelectorAll(".starter-chip.picked").length;
    confirmBtn.disabled = n !== 3;
  };
  content.querySelectorAll(".starter-chip").forEach((chip) => {
    chip.addEventListener("click", () => {
      chip.classList.toggle("picked");
      update();
    });
  });
  confirmBtn.onclick = () => {
    const picks = [];
    content.querySelectorAll(".starter-chip.picked").forEach((chip) => {
      const name = chip.textContent.split(" (")[0];
      const c = GAME.characters.find((x) => x.name === name);
      if (c) picks.push(c.id);
    });
    if (picks.length !== 3) return;
    dlg.close();
    if (team === "A") {
      onlineLocalStarters = picks.slice();
      onlineMaybeStartHost();
    } else {
      onlineSend({ type: "starters", starters: picks.slice() });
      onlineShowWaiting("Titulaires validés. En attente de l'adversaire…");
    }
  };
  update();
  dlg.showModal();
}

function onlineHostReceiveStarters(s) {
  if (!Array.isArray(s) || s.length !== 3) {
    onlineAbort("Les titulaires adverses sont invalides.");
    return;
  }
  onlineRemoteStarters = s.slice();
  onlineMaybeStartHost();
}

function onlineMaybeStartHost() {
  if (lanRole !== "host") return;
  if (!onlineLocalStarters || !onlineRemoteStarters) {
    onlineShowWaiting("En attente des titulaires adverses…");
    return;
  }
  state.starters = { A: onlineLocalStarters.slice(), B: onlineRemoteStarters.slice() };
  onlineSetupPhase = false;
  onlineHideWaiting();
  onlineSend({ type: "start" });
  renderDecks();
  startGame();
}

function onlineClientStart() {
  onlineSetupPhase = false;
  onlineHideWaiting();
  const dlg = document.getElementById("starter-dialog");
  if (dlg && dlg.open) dlg.close();
}

document.getElementById("home-online").addEventListener("click", openOnlineLobby);

document.getElementById("online-search").addEventListener("click", onlineSearch);

document.getElementById("online-cancel").addEventListener("click", () => {
  const dlg = document.getElementById("online-dialog");
  if (dlg && dlg.open) dlg.close();
  onlineDisconnect();
});

/* ================= fin Partie en ligne ================= */

initMapSelect();
renderRoleOptions();
renderLibrary();
renderBoard();
showHome();
renderRoleOptions();
renderLibrary();
renderBoard();
showHome();
