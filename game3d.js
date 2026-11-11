/* =========================================================================
   Luxeria — vue 3D (bêta)
   -------------------------------------------------------------------------
   Principe : la 3D ne duplique AUCUNE règle. Elle fait seulement deux choses :
     1. lire l'état du jeu (state, GAME) pour dessiner le plateau ;
     2. router les clics vers cellClick(x, y), le point d'entrée unique du jeu 2D.
   Résultat : déplacement, attaque, capacités, placement, annulation, IA et
   multijoueur fonctionnent ici exactement comme sur le plateau 2D.

   Les champions sont représentés par des bouteilles blanches (bêta).
   ========================================================================= */

(function () {
  "use strict";

  if (typeof GAME === "undefined") return;

  var TAB_ID = "board3d";
  var SECTION_ID = "tab-board3d";
  var HOST_ID = "board3d-canvas";

  /* ---------------- couleurs (alignées sur le thème du site) ---------------- */

  var COL = {
    bg: 0x0f141b,
    floor: 0x0a0e14,
    tileA: 0x1c2531,
    tileB: 0x232e3c,
    blocked: 0x334155,
    wall: 0x141b25,
    wallCap: 0xf6c24b,
    teamA: 0x4f8cff,
    teamB: 0xff6b6b,
    fire: 0xff7a2f,
    heal: 0x39d98a,
    speed: 0x4fd1ff,
    void: 0x8a5cff,
    white: 0xf4f8ff,
    reach: 0x35d0a0,
    attack: 0xff4d4d,
    place: 0xf6c24b
  };

  /* ---------------- état interne ---------------- */

  var THREE = null;
  var threeLoading = false;
  var threeQueue = [];

  var renderer = null;
  var scene = null;
  var camera = null;
  var world = null;
  var gStatic = null;
  var gTokens = null;
  var gHi = null;
  var cellPlane = null;
  var raycaster = null;
  var ndc = null;
  var hostEl = null;

  var tokenMeshes = {};        // id -> { g, label, tx, tz, hp, phase, dying }
  var cur = { cols: 15, rows: 10, ox: 0, oz: 0, mapId: null };
  var cam = {
    theta: 0.85 + Math.PI, phi: 0.98, r: 22,
    thetaT: 0.85 + Math.PI, phiT: 0.98, rT: 22,
    target: null, targetT: null,
    topView: false, savedPhi: 0.98,
    lastTurn: null, camSet: false, lastPhase: null,
    side: "A"
  };

  var staticSig = "";
  var hiSig = "";
  var hoverCell = null;
  var lastSync = 0;
  var lastFrame = 0;
  var mounted = false;

  /* ---------------- utilitaires ---------------- */

  function el(id) { return document.getElementById(id); }

  function disposeTree(root) {
    root.traverse(function (o) {
      if (o.geometry) o.geometry.dispose();
      if (o.material) {
        var mats = Array.isArray(o.material) ? o.material : [o.material];
        mats.forEach(function (m) {
          if (m.map) m.map.dispose();
          m.dispose();
        });
      }
    });
  }

  function std(color, o) {
    o = o || {};
    return new THREE.MeshStandardMaterial({
      color: color,
      roughness: o.roughness !== undefined ? o.roughness : 0.65,
      metalness: o.metalness !== undefined ? o.metalness : 0.25,
      emissive: o.emissive !== undefined ? o.emissive : 0x000000,
      emissiveIntensity: o.emissiveIntensity !== undefined ? o.emissiveIntensity : 1,
      transparent: !!o.transparent,
      opacity: o.opacity !== undefined ? o.opacity : 1,
      depthWrite: o.depthWrite !== undefined ? o.depthWrite : true
    });
  }

  function cellPos(x, y) {
    return { x: x + cur.ox, z: y + cur.oz };
  }

  function makeLabel(text, cssColor, sub) {
    var dpr = 2;
    var c = document.createElement("canvas");
    c.width = 256 * dpr;
    c.height = 84 * dpr;
    var g = c.getContext("2d");
    g.scale(dpr, dpr);
    g.textAlign = "center";
    g.textBaseline = "middle";

    g.font = "700 26px Cinzel, Georgia, serif";
    var w = Math.min(244, Math.max(96, g.measureText(text).width + 30));
    var x0 = 128 - w / 2;

    g.fillStyle = "rgba(8, 12, 18, 0.78)";
    g.beginPath();
    if (g.roundRect) g.roundRect(x0, 8, w, 46, 10); else g.rect(x0, 8, w, 46);
    g.fill();
    g.strokeStyle = "rgba(255,255,255,0.18)";
    g.lineWidth = 1.5;
    g.stroke();

    g.fillStyle = cssColor;
    g.fillText(text, 128, 26);

    if (sub) {
      g.font = "600 15px Inter, system-ui, sans-serif";
      g.fillStyle = "rgba(220,232,245,0.85)";
      g.fillText(sub, 128, 45);
    }

    var tex = new THREE.CanvasTexture(c);
    tex.encoding = THREE.sRGBEncoding;
    tex.anisotropy = 4;
    var sprite = new THREE.Sprite(new THREE.SpriteMaterial({
      map: tex, transparent: true, depthWrite: false, depthTest: false
    }));
    sprite.scale.set(1.9, 0.62, 1);
    return sprite;
  }

  /* ---------------- chargement paresseux de Three.js ---------------- */

  function ensureThree(cb) {
    if (window.THREE) { THREE = window.THREE; cb(); return; }
    threeQueue.push(cb);
    if (threeLoading) return;
    threeLoading = true;
    var s = document.createElement("script");
    s.src = "three.min.js?v=1";
    s.onload = function () {
      threeLoading = false;
      THREE = window.THREE;
      var q = threeQueue.slice();
      threeQueue.length = 0;
      q.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    };
    s.onerror = function () {
      threeLoading = false;
      var msg = el("b3d-message");
      if (msg) {
        msg.style.display = "flex";
        msg.textContent = "Impossible de charger le moteur 3D (three.min.js).";
      }
    };
    document.head.appendChild(s);
  }

  /* ---------------- scène ---------------- */

  function mount() {
    if (mounted) return;
    hostEl = el(HOST_ID);
    if (!hostEl) return;

    renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(hostEl.clientWidth || 800, hostEl.clientHeight || 520);
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.12;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    hostEl.appendChild(renderer.domElement);

    scene = new THREE.Scene();
    scene.background = new THREE.Color(COL.bg);
    scene.fog = new THREE.Fog(COL.bg, 34, 62);

    camera = new THREE.PerspectiveCamera(45, 1, 0.1, 300);
    cam.target = new THREE.Vector3(0, 0.6, 0);
    cam.targetT = new THREE.Vector3(0, 0.6, 0);

    raycaster = new THREE.Raycaster();
    ndc = new THREE.Vector2();

    scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x0a1018, 0.6));

    var key = new THREE.DirectionalLight(0xfff2dd, 2.0);
    key.position.set(10, 16, 8);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 60;
    key.shadow.camera.left = -14;
    key.shadow.camera.right = 14;
    key.shadow.camera.top = 14;
    key.shadow.camera.bottom = -14;
    key.shadow.bias = -0.0007;
    key.shadow.radius = 3;
    scene.add(key);

    var fill = new THREE.DirectionalLight(0x7fb2ff, 0.5);
    fill.position.set(-9, 7, -8);
    scene.add(fill);

    world = new THREE.Group();
    scene.add(world);

    gStatic = new THREE.Group();
    gTokens = new THREE.Group();
    gHi = new THREE.Group();
    world.add(gStatic, gTokens, gHi);

    var floor = new THREE.Mesh(
      new THREE.CircleGeometry(50, 64),
      std(COL.floor, { roughness: 0.95, metalness: 0.05 })
    );
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = -0.55;
    floor.receiveShadow = true;
    scene.add(floor);

    bindInput();
    mounted = true;
    resize();
  }

  function resize() {
    if (!renderer || !hostEl) return;
    var w = hostEl.clientWidth || 800;
    var h = hostEl.clientHeight || 520;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
  }

  /* ---------------- construction du décor ---------------- */

  function buildStatic() {
    var map = GAME.maps[state.mapName] || GAME.map;
    if (!map) return;

    cur.cols = map.cols || 15;
    cur.rows = map.rows || 10;
    cur.ox = -(cur.cols - 1) / 2;
    cur.oz = -(cur.rows - 1) / 2;
    cur.mapId = state.mapName;

    if (gStatic) {
      world.remove(gStatic);
      disposeTree(gStatic);
    }
    gStatic = new THREE.Group();
    world.add(gStatic);

    /* socle */
    var base = new THREE.Mesh(
      new THREE.BoxGeometry(cur.cols + 0.8, 0.55, cur.rows + 0.8),
      std(0x0c1219, { roughness: 0.85, metalness: 0.4 })
    );
    base.position.y = -0.275;
    base.receiveShadow = true;
    gStatic.add(base);

    var rim = new THREE.Mesh(
      new THREE.BoxGeometry(cur.cols + 1.05, 0.06, cur.rows + 1.05),
      std(0x1a2432, { roughness: 0.5, metalness: 0.6, emissive: 0x123048, emissiveIntensity: 0.6 })
    );
    rim.position.y = -0.52;
    gStatic.add(rim);

    var tileGeo = new THREE.BoxGeometry(0.94, 0.1, 0.94);
    var matA = std(COL.tileA, { roughness: 0.72, metalness: 0.2 });
    var matB = std(COL.tileB, { roughness: 0.6, metalness: 0.3 });

    for (var y = 0; y < cur.rows; y++) {
      for (var x = 0; x < cur.cols; x++) {
        var p = cellPos(x, y);

        /* case infranchissable du terrain */
        if (map.tiles && map.tiles[y] && map.tiles[y][x] === 1) {
          var rock = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 1.1, 0.9),
            std(COL.blocked, { roughness: 0.55, metalness: 0.45 })
          );
          rock.position.set(p.x, 0.55, p.z);
          rock.castShadow = true;
          rock.receiveShadow = true;
          gStatic.add(rock);
          continue;
        }

        var tile = new THREE.Mesh(tileGeo, ((x + y) % 2 === 0) ? matA : matB);
        tile.position.set(p.x, 0.05, p.z);
        tile.receiveShadow = true;
        gStatic.add(tile);

        /* --- cases spéciales --- */
        if (isVoidCell(x, y)) {
          addVoid(p);
        } else if (isFire(x, y)) {
          addFire(p, x, y);
        } else if (isHealCell(x, y)) {
          addHeal(p);
        } else if (isSpeedCell(x, y)) {
          addSpeed(p);
        }
      }
    }

    /* zones de départ */
    (map.startZones.A || []).forEach(function (c) { addZone(c, COL.teamA); });
    (map.startZones.B || []).forEach(function (c) { addZone(c, COL.teamB); });

    /* murs du terrain */
    (map.edgesWalls || []).forEach(function (edge) { addEdgeWall(edge, COL.wallCap, 0); });

    /* murs destructibles posés pendant la partie */
    (state.walls || []).forEach(function (w) {
      if (!w) return;
      var p = cellPos(w.x, w.y);
      var box = new THREE.Mesh(
        new THREE.BoxGeometry(0.8, 0.8, 0.8),
        std(0x6b4a2a, { roughness: 0.7, metalness: 0.2 })
      );
      box.position.set(p.x, 0.42, p.z);
      box.castShadow = true;
      box.receiveShadow = true;
      gStatic.add(box);

      var lbl = makeLabel("MUR", "#ffd9a0", w.hp + " PV");
      lbl.position.set(p.x, 1.15, p.z);
      lbl.scale.set(1.1, 0.4, 1);
      gStatic.add(lbl);
    });

    /* murs d'ARK */
    (state.arkWalls || []).forEach(function (w) {
      if (!w || !w.key) return;
      addEdgeWall(w.key, 0xffa94d, 1);
    });

    /* dômes de GUARD */
    (state.guardZones || []).forEach(function (z) {
      if (!z) return;
      var p = cellPos(z.x, z.y);
      var dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.55, 24, 16, 0, Math.PI * 2, 0, Math.PI / 2),
        std(z.player === "A" ? COL.teamA : COL.teamB, {
          transparent: true, opacity: 0.16, roughness: 0.1, metalness: 0.1,
          emissive: z.player === "A" ? COL.teamA : COL.teamB, emissiveIntensity: 0.6, depthWrite: false
        })
      );
      dome.position.set(p.x, 0.02, p.z);
      gStatic.add(dome);
    });

    /* objectifs */
    addObjective("A");
    addObjective("B");

    /* plan de détection des clics */
    if (cellPlane) {
      world.remove(cellPlane);
      cellPlane.geometry.dispose();
      cellPlane.material.dispose();
    }
    cellPlane = new THREE.Mesh(
      new THREE.PlaneGeometry(cur.cols, cur.rows),
      new THREE.MeshBasicMaterial({ visible: false })
    );
    cellPlane.rotation.x = -Math.PI / 2;
    cellPlane.position.y = 0.12;
    world.add(cellPlane);

    var nameEl = el("b3d-map");
    if (nameEl) nameEl.textContent = (map.name || state.mapName) + " · " + cur.cols + "×" + cur.rows;
  }

  function addZone(cell, color) {
    if (!cell) return;
    var p = cellPos(cell[0], cell[1]);
    var ov = new THREE.Mesh(
      new THREE.PlaneGeometry(0.92, 0.92),
      new THREE.MeshBasicMaterial({ color: color, transparent: true, opacity: 0.16, depthWrite: false })
    );
    ov.rotation.x = -Math.PI / 2;
    ov.position.set(p.x, 0.112, p.z);
    gStatic.add(ov);
  }

  function addEdgeWall(edge, capColor, kind) {
    if (typeof edge !== "string") return;
    var parts = edge.split("-");
    if (parts.length !== 2) return;
    var a = parts[0].split(","), b = parts[1].split(",");
    var x1 = +a[0], y1 = +a[1], x2 = +b[0], y2 = +b[1];
    if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return;

    var w, d, px, pz;
    if (y1 === y2) {
      px = (x1 + x2) / 2 + cur.ox;
      pz = y1 + cur.oz;
      w = 0.14; d = 1.0;
    } else if (x1 === x2) {
      px = x1 + cur.ox;
      pz = (y1 + y2) / 2 + cur.oz;
      w = 1.0; d = 0.14;
    } else {
      return;
    }

    var h = kind === 1 ? 1.15 : 1.0;
    var wall = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      std(kind === 1 ? 0x4a3320 : COL.wall, { roughness: 0.45, metalness: 0.55 })
    );
    wall.position.set(px, h / 2, pz);
    wall.castShadow = true;
    wall.receiveShadow = true;
    gStatic.add(wall);

    var cap = new THREE.Mesh(
      new THREE.BoxGeometry(w * 1.04, 0.055, d * 1.04),
      std(0xffffff, { emissive: capColor, emissiveIntensity: 1.4, roughness: 0.3 })
    );
    cap.position.set(px, h + 0.02, pz);
    gStatic.add(cap);
  }

  function addFire(p, x, y) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.fire, { emissive: COL.fire, emissiveIntensity: 1.5, roughness: 0.4 })
    );
    pad.position.set(p.x, 0.1, p.z);
    gStatic.add(pad);

    var flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.18, 0.46, 6),
      std(0xffb066, { emissive: COL.fire, emissiveIntensity: 2.2, transparent: true, opacity: 0.92 })
    );
    flame.position.set(p.x, 0.34, p.z);
    flame.userData.anim = "flame";
    flame.userData.phase = Math.random() * 6.28;
    flame.userData.baseY = 0.34;
    gStatic.add(flame);

    var light = new THREE.PointLight(COL.fire, 6, 3.2, 2);
    light.position.set(p.x, 0.5, p.z);
    gStatic.add(light);
  }

  function addHeal(p) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.heal, { emissive: COL.heal, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    pad.position.set(p.x, 0.1, p.z);
    gStatic.add(pad);

    var cross = new THREE.Group();
    var m = std(0xffffff, { emissive: COL.heal, emissiveIntensity: 1.6 });
    var c1 = new THREE.Mesh(new THREE.BoxGeometry(0.44, 0.06, 0.14), m);
    var c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.06, 0.44), m);
    cross.add(c1, c2);
    cross.position.set(p.x, 0.2, p.z);
    cross.userData.anim = "spin";
    gStatic.add(cross);
  }

  function addSpeed(p) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.speed, { emissive: COL.speed, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    pad.position.set(p.x, 0.1, p.z);
    gStatic.add(pad);

    var ring = new THREE.Mesh(
      new THREE.TorusGeometry(0.27, 0.035, 8, 26),
      std(0xffffff, { emissive: COL.speed, emissiveIntensity: 1.9 })
    );
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.19, p.z);
    ring.userData.anim = "pulse";
    ring.userData.baseY = 0.19;
    ring.userData.phase = Math.random() * 6.28;
    gStatic.add(ring);
  }

  /* Le vide : un vrai trou noir — disque noir, entonnoir et halo violet. */
  function addVoid(p) {
    var funnel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.14, 0.85, 24, 1, true),
      std(0x04060a, { roughness: 1, metalness: 0, transparent: true, opacity: 0.96 })
    );
    funnel.position.set(p.x, -0.36, p.z);
    gStatic.add(funnel);

    var hole = new THREE.Mesh(
      new THREE.CircleGeometry(0.42, 32),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    hole.rotation.x = -Math.PI / 2;
    hole.position.set(p.x, 0.03, p.z);
    gStatic.add(hole);

    var halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.44, 0.03, 8, 32),
      std(0xffffff, { emissive: COL["void"], emissiveIntensity: 2.2 })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(p.x, 0.08, p.z);
    halo.userData.anim = "void";
    halo.userData.phase = Math.random() * 6.28;
    gStatic.add(halo);

    var glow = new THREE.PointLight(COL["void"], 4.5, 3.0, 2);
    glow.position.set(p.x, 0.5, p.z);
    gStatic.add(glow);
  }

  function addObjective(team) {
    /* En Rampage il n'y a ni objectif ni réserve : rien à dessiner.
       En mode Objectif, on n'affiche la structure qu'une fois réellement posée. */
    if (typeof isRampage === "function" && isRampage()) return;
    var pos = state.objectivePos && state.objectivePos[team];
    if (!pos) return;
    var p = cellPos(pos.x, pos.y);
    var col = team === "A" ? COL.teamA : COL.teamB;
    var hp = state.objectives && typeof state.objectives[team] === "number" ? state.objectives[team] : 20;

    var pillar = new THREE.Mesh(
      new THREE.CylinderGeometry(0.31, 0.45, 1.2, 6),
      std(0x141d29, { roughness: 0.4, metalness: 0.6, emissive: col, emissiveIntensity: 0.24 })
    );
    pillar.position.set(p.x, 0.62, p.z);
    pillar.castShadow = true;
    pillar.receiveShadow = true;
    gStatic.add(pillar);

    var crystal = new THREE.Mesh(
      new THREE.OctahedronGeometry(0.28),
      std(col, { emissive: col, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.1 })
    );
    crystal.position.set(p.x, 1.68, p.z);
    crystal.userData.anim = "crystal";
    crystal.userData.phase = team === "A" ? 0 : 2;
    crystal.userData.baseY = 1.68;
    gStatic.add(crystal);

    var light = new THREE.PointLight(col, 8, 4.5, 2);
    light.position.set(p.x, 1.55, p.z);
    gStatic.add(light);

    var lbl = makeLabel("OBJECTIF " + team, team === "A" ? "#9fc8ff" : "#ffb3b3", hp + " PV");
    lbl.position.set(p.x, 2.35, p.z);
    gStatic.add(lbl);
  }

  /* ---------------- bouteilles (champions) ---------------- */

  function makeBottle(team) {
    var g = new THREE.Group();
    var body = std(COL.white, { roughness: 0.34, metalness: 0.06, emissive: 0x2a3a52, emissiveIntensity: 0.25 });
    var teamMat = std(team === "A" ? COL.teamA : COL.teamB, {
      emissive: team === "A" ? COL.teamA : COL.teamB, emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.4
    });

    var b = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.215, 0.44, 24), body);
    b.position.y = 0.3;
    b.castShadow = true;
    g.add(b);

    var shoulder = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.17, 0.14, 24), body);
    shoulder.position.y = 0.59;
    shoulder.castShadow = true;
    g.add(shoulder);

    var neck = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.08, 0.14, 20), body);
    neck.position.y = 0.73;
    g.add(neck);

    var cap = new THREE.Mesh(new THREE.CylinderGeometry(0.082, 0.082, 0.08, 20), teamMat);
    cap.position.y = 0.84;
    cap.castShadow = true;
    g.add(cap);

    /* étiquette de l'équipe sur la bouteille */
    var band = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.14, 24, 1, true), teamMat);
    band.position.y = 0.26;
    band.material.side = THREE.DoubleSide;
    band.material.transparent = true;
    band.material.opacity = 0.85;
    g.add(band);

    /* socle lumineux */
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 8, 30), teamMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.055;
    g.add(ring);

    return g;
  }

  function syncTokens() {
    var alive = {};
    var list = (state.tokens || []).filter(function (t) { return t && !t.dead; });

    list.forEach(function (t) {
      alive[t.id] = true;
      var p = cellPos(t.x, t.y);
      var m = tokenMeshes[t.id];

      if (!m) {
        var g = makeBottle(t.player);
        g.position.set(p.x, 0, p.z);
        g.scale.setScalar(0.01);
        g.userData.spawn = 0;
        gTokens.add(g);

        var ch = charById(t.charId);
        var lbl = makeLabel(ch ? ch.name : "?", t.player === "A" ? "#bcd7ff" : "#ffc4c4", t.hp + " PV");
        lbl.position.set(0, 1.15, 0);
        g.add(lbl);

        m = tokenMeshes[t.id] = { g: g, label: lbl, tx: p.x, tz: p.z, hp: t.hp, phase: Math.random() * 6.28, dying: false };
        return;
      }

      m.tx = p.x;
      m.tz = p.z;

      if (m.hp !== t.hp) {
        m.hp = t.hp;
        var ch2 = charById(t.charId);
        var old = m.label;
        var nl = makeLabel(ch2 ? ch2.name : "?", t.player === "A" ? "#bcd7ff" : "#ffc4c4", t.hp + " PV");
        nl.position.copy(old.position);
        m.g.remove(old);
        disposeTree(old);
        m.g.add(nl);
        m.label = nl;
      }
    });

    Object.keys(tokenMeshes).forEach(function (id) {
      var m = tokenMeshes[id];
      if (alive[id] || m.dying) return;
      m.dying = true;
      m.deathAt = performance.now();
    });
  }

  /* ---------------- surlignage ---------------- */

  function hiSignature() {
    var sel = typeof selectedTokenId !== "undefined" ? selectedTokenId : null;
    var r = (typeof reachable !== "undefined" ? reachable : []).map(function (c) { return c[0] + "," + c[1]; }).join("|");
    var a = (typeof attackCells !== "undefined" ? attackCells : []).map(function (c) { return c[0] + "," + c[1]; }).join("|");
    var h = hoverCell ? hoverCell.x + "," + hoverCell.y : "-";
    var ph = state.phase;
    var pl = ph === "placement" ? state.placingPlayer : "";
    return sel + "#" + r + "#" + a + "#" + h + "#" + ph + pl + "#" + state.turn;
  }

  function rebuildHighlights() {
    if (gHi) {
      world.remove(gHi);
      disposeTree(gHi);
    }
    gHi = new THREE.Group();
    world.add(gHi);

    var planeGeo = new THREE.PlaneGeometry(0.9, 0.9);

    function flat(x, y, color, opacity, yPos) {
      var m = new THREE.Mesh(planeGeo, new THREE.MeshBasicMaterial({
        color: color, transparent: true, opacity: opacity, depthWrite: false
      }));
      var p = cellPos(x, y);
      m.rotation.x = -Math.PI / 2;
      m.position.set(p.x, yPos || 0.118, p.z);
      gHi.add(m);
      return m;
    }

    if (state.phase === "placement") {
      for (var y = 0; y < cur.rows; y++) {
        for (var x = 0; x < cur.cols; x++) {
          if (typeof cellPlaceable === "function" && cellPlaceable(x, y)) flat(x, y, COL.place, 0.3);
        }
      }
    } else {
      (typeof reachable !== "undefined" ? reachable : []).forEach(function (c) {
        flat(c[0], c[1], COL.reach, 0.34);
      });
      (typeof attackCells !== "undefined" ? attackCells : []).forEach(function (c) {
        flat(c[0], c[1], COL.attack, 0.3, 0.121);
      });
    }

    /* champion sélectionné */
    var sel = typeof selectedTokenId !== "undefined" ? selectedTokenId : null;
    var tok = sel ? tokenById(sel) : null;
    if (tok && !tok.dead) {
      var p = cellPos(tok.x, tok.y);
      var ring = new THREE.Mesh(
        new THREE.TorusGeometry(0.38, 0.035, 10, 40),
        std(0xffffff, { emissive: COL.wallCap, emissiveIntensity: 2, transparent: true, opacity: 0.95 })
      );
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(p.x, 0.16, p.z);
      ring.userData.anim = "selring";
      gHi.add(ring);

      var beam = new THREE.Mesh(
        new THREE.CylinderGeometry(0.1, 0.34, 3.2, 20, 1, true),
        new THREE.MeshBasicMaterial({
          color: COL.wallCap, transparent: true, opacity: 0.07,
          side: THREE.DoubleSide, depthWrite: false
        })
      );
      beam.position.set(p.x, 1.7, p.z);
      gHi.add(beam);
    }

    /* case survolée */
    if (hoverCell) {
      var hp = cellPos(hoverCell.x, hoverCell.y);
      var edges = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(0.96, 0.02, 0.96)),
        new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 })
      );
      edges.position.set(hp.x, 0.14, hp.z);
      gHi.add(edges);
    }
  }

  /* ---------------- synchronisation avec l'état du jeu ---------------- */

  function computeStaticSig() {
    return [
      state.mapName,
      state.phase,
      state.shrinkStep,
      state.objectivePos ? state.objectivePos.A && state.objectivePos.A.x : "n",
      state.objectivePos ? state.objectivePos.B && state.objectivePos.B.x : "n",
      (state.walls || []).map(function (w) { return w.x + "," + w.y + "," + w.hp; }).join(";"),
      (state.arkWalls || []).map(function (w) { return w.key + "," + w.hp; }).join(";"),
      (state.guardZones || []).map(function (z) { return z.x + "," + z.y + "," + z.player; }).join(";"),
      (state.specialCells || []).map(function (s) { return s.x + "," + s.y + "," + s.type; }).join(";")
    ].join("|");
  }

  function cameraSide() {
    var t = cam.thetaT % (Math.PI * 2);
    if (t < 0) t += Math.PI * 2;
    var aCenter = 0.85 + Math.PI;
    var bCenter = 0.85;
    function dist(x, c) { var d = Math.abs(x - c); if (d > Math.PI) d = Math.PI * 2 - d; return d; }
    return dist(t, aCenter) < dist(t, bCenter) ? "A" : "B";
  }

  function sync(force) {
    if (!mounted) return;

    var mapChanged = (cur.mapId !== state.mapName);
    var sig = computeStaticSig();
    if (force || sig !== staticSig) {
      staticSig = sig;
      buildStatic();
      hiSig = "";
      if (mapChanged || !cam.camSet) {
        cam.camSet = true;
        cam.rT = Math.max(cur.cols, cur.rows) * 1.16 + 5;
        cam.thetaT = (state.turn === "A" ? 0.85 + Math.PI : 0.85);
        cam.phiT = 0.98;
        cam.targetT.set(0, 0.6, 0);
        cam.topView = false;
        cam.savedPhi = 0.98;
      }
    }

    /* Changement de tour : on passe de l'autre côté du plateau, en conservant
       l'angle et le zoom choisis par le joueur (rotation libre pendant le tour). */
    /* Changement de tour : on passe du côté du joueur actif, en conservant
       l'angle et le zoom choisis par le joueur (rotation libre pendant le tour).
       Si la caméra est déjà du bon côté, on ne bouge pas. */
    var turnChanged = (cam.lastTurn !== null && cam.lastTurn !== state.turn);
    if (!mapChanged && turnChanged && !cam.topView && cameraSide() !== state.turn) {
      cam.thetaT += Math.PI;
    }
    cam.lastTurn = state.turn;

    /* Phase de placement : vue de haut pour que les deux joueurs posent en même
       temps. Passage en phase de jeu : on se place du côté du joueur actif. */
    var phaseChanged = (cam.lastPhase !== state.phase);
    if (state.phase === "placement" && !cam.topView) {
      cam.savedPhi = cam.phi;
      cam.phiT = 0.02;
      cam.rT = Math.max(cur.cols, cur.rows) * 1.3 + 3;
      cam.thetaT = 0;
      cam.topView = true;
      var tvp = el("b3d-topview");
      if (tvp) { tvp.textContent = "◉ Vue 3D"; tvp.classList.add("active"); }
    }
    if (state.phase === "playing" && cam.topView && phaseChanged) {
      cam.topView = false;
      cam.phiT = 0.98;
      cam.rT = Math.max(cur.cols, cur.rows) * 1.16 + 5;
      cam.thetaT = (state.turn === "A" ? 0.85 + Math.PI : 0.85);
      var tvp2 = el("b3d-topview");
      if (tvp2) { tvp2.textContent = "⤓ Vue de haut"; tvp2.classList.remove("active"); }
    }
    cam.lastPhase = state.phase;

    syncTokens();

    var hs = hiSignature();
    if (hs !== hiSig) {
      hiSig = hs;
      rebuildHighlights();
    }

    updateHud();
    updateObjectives();
    updateReserve();
    updateLog();
  }

  /* ---------------- HUD ---------------- */

  function updateHud() {
    var turnEl = el("b3d-turn");
    if (turnEl) {
      var who = state.turn === "A" ? "Équipe A" : "Équipe B";
      var extra = state.phase === "placement" ? " · placement" : " · tour " + (state.turnCount || 1);
      turnEl.textContent = "Tour : " + who + extra;
      turnEl.className = "b3d-turn " + (state.turn === "A" ? "team-a" : "team-b");
    }

    var card = el("b3d-card");
    if (!card) return;

    var sel = typeof selectedTokenId !== "undefined" ? selectedTokenId : null;
    var tok = sel ? tokenById(sel) : null;

    if (!tok) {
      card.innerHTML = '<div class="b3d-empty">' +
        (state.phase === "placement"
          ? (typeof isRampage === "function" && isRampage()
              ? "Rampage : cliquez une case dorée pour poser vos 3 champions (pas d'objectif à placer)."
              : "Placement : cliquez une case dorée pour poser votre objectif puis vos champions.")
          : "Cliquez une bouteille pour sélectionner un champion.") +
        "</div>";
      return;
    }

    var ch = charById(tok.charId) || { name: tok.charId, hp: 1, atk: 0, mouvement: 0, range: 0, role: "" };
    var pct = Math.max(0, Math.min(100, (tok.hp / ch.hp) * 100));
    var badges = [];
    if (state.activatedTokenId === tok.id) badges.push('<span class="b3d-badge">a agi</span>');
    if (tok.hasAttacked) badges.push('<span class="b3d-badge">a attaqué</span>');
    if (tok.abilityUsed) badges.push('<span class="b3d-badge">capacité utilisée</span>');
    if (tok.dead) badges.push('<span class="b3d-badge b3d-badge-red">éliminé</span>');

    card.innerHTML =
      '<div class="b3d-name">' + ch.name + '<span class="b3d-role">' + (roleLabel(ch.role) || "") + "</span></div>" +
      '<div class="b3d-hpbar"><span style="width:' + pct + '%"></span></div>' +
      '<div class="b3d-hptext">' + tok.hp + " / " + ch.hp + " PV</div>" +
      '<div class="b3d-stats">' +
        "<span>Mvt <b>" + ch.mouvement + "</b></span>" +
        "<span>Atk <b>" + ch.atk + "</b></span>" +
        "<span>Portée <b>" + ch.range + "</b></span>" +
      "</div>" +
      (badges.length ? '<div class="b3d-badges">' + badges.join("") + "</div>" : "");

    if (tok.hp <= 0 || tok.dead) {
      card.innerHTML += '<div class="b3d-empty">Ce champion est éliminé.</div>';
    }
  }

  /* ---------------- HUD secondaire ---------------- */

  function updateObjectives() {
    var el = document.getElementById("b3d-objectives");
    if (!el) return;
    if (typeof isRampage === "function" && isRampage()) {
      el.textContent = "Rampage · 3c3 · pas d'objectif";
      el.className = "b3d-objectives rampage";
      return;
    }
    var a = (state.objectives && typeof state.objectives.A === "number") ? state.objectives.A : "?";
    var b = (state.objectives && typeof state.objectives.B === "number") ? state.objectives.B : "?";
    el.textContent = "Objectif A : " + a + " PV · B : " + b + " PV";
    el.className = "b3d-objectives";
  }

  function updateReserve() {
    var el = document.getElementById("b3d-reserve");
    if (!el) return;
    if (state.phase !== "playing") {
      el.style.display = "none";
      el.innerHTML = "";
      return;
    }
    el.style.display = "";
    var html = "";
    ["A", "B"].forEach(function (p) {
      var entries = state.reserve[p] || [];
      var alive = state.tokens.filter(function (t) { return t.player === p && !t.dead; }).length;
      var maxField = (state.starters[p] || []).length;
      var canEnter = alive < maxField && (typeof findFreeSpawnCell === "function" ? !!findFreeSpawnCell(p) : false);
      html += '<div class="b3d-reserve-team team-' + p.toLowerCase() + '">';
      html += '<div class="b3d-reserve-title">Réserve ' + p + ' (' + entries.length + ')</div>';
      if (!entries.length) {
        html += '<div class="b3d-reserve-empty">Aucun</div>';
      } else {
        entries.forEach(function (r, idx) {
          var c = (typeof charById === "function") ? charById(r.charId) : null;
          var name = c ? c.name : r.charId;
          html += '<div class="b3d-reserve-row">';
          html += '<span>' + name + " · " + r.hp + " PV</span>";
          if (p === state.turn && canEnter) {
            html += '<button class="b3d-reserve-enter" data-p="' + p + '" data-idx="' + idx + '" title="Poser sur une case libre">▶</button>';
          }
          html += "</div>";
        });
      }
      html += "</div>";
    });
    el.innerHTML = html;

    Array.prototype.forEach.call(el.querySelectorAll(".b3d-reserve-enter"), function (b) {
      b.addEventListener("click", function () {
        var p = b.getAttribute("data-p");
        var idx = parseInt(b.getAttribute("data-idx"), 10);
        var entry = (state.reserve[p] || [])[idx];
        if (entry && typeof fieldFromReserve === "function") {
          fieldFromReserve(p, entry);
        }
        sync(true);
      });
    });
  }

  function updateLog() {
    var el = document.getElementById("b3d-log");
    if (!el) return;
    var msgs = (state.log || []).slice(-3).reverse();
    el.innerHTML = msgs.map(function (l) {
      return '<div class="b3d-log-line">' + ((l && l.msg) || "") + "</div>";
    }).join("");
  }

  /* ---------------- entrées ---------------- */

  function pointerToCell(clientX, clientY) {
    if (!renderer || !camera || !cellPlane) return null;
    var rect = renderer.domElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.x = ((clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    var hit = raycaster.intersectObject(cellPlane, false)[0];
    if (!hit) return null;
    var x = Math.floor(hit.point.x - cur.ox + 0.5);
    var y = Math.floor(hit.point.z - cur.oz + 0.5);
    if (x < 0 || y < 0 || x >= cur.cols || y >= cur.rows) return null;
    return { x: x, y: y };
  }

  function bindInput() {
    var dom = renderer.domElement;
    var drag = null;
    var pointers = {};

    dom.addEventListener("contextmenu", function (e) { e.preventDefault(); });

    dom.addEventListener("pointerdown", function (e) {
      pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      try { dom.setPointerCapture(e.pointerId); } catch (err) {}
      drag = {
        x: e.clientX, y: e.clientY,
        sx: e.clientX, sy: e.clientY,
        moved: false,
        pan: e.button === 2 || e.shiftKey,
        t: performance.now()
      };
    });

    dom.addEventListener("pointermove", function (e) {
      if (pointers[e.pointerId]) {
        pointers[e.pointerId] = { x: e.clientX, y: e.clientY };
      }

      var ids = Object.keys(pointers);
      if (ids.length === 2) {
        /* pincement : zoom */
        var a = pointers[ids[0]], b = pointers[ids[1]];
        var d = Math.hypot(a.x - b.x, a.y - b.y);
        if (drag && drag.pinch) {
          cam.rT = THREE.MathUtils.clamp(cam.rT * (drag.pinch / Math.max(d, 1)), 5, 55);
        }
        if (drag) { drag.pinch = d; drag.moved = true; }
        return;
      }

      if (!drag) {
        var hc = pointerToCell(e.clientX, e.clientY);
        if (!hc || !hoverCell || hc.x !== hoverCell.x || hc.y !== hoverCell.y) {
          hoverCell = hc;
          hiSig = "";
        }
        return;
      }

      var dx = e.clientX - drag.x;
      var dy = e.clientY - drag.y;
      drag.x = e.clientX;
      drag.y = e.clientY;

      if (!drag.moved && Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 6) drag.moved = true;
      if (!drag.moved) return;

      if (drag.pan) {
        var scale = cam.r * 0.0017;
        var right = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 0);
        var up = new THREE.Vector3().setFromMatrixColumn(camera.matrix, 1);
        cam.targetT.addScaledVector(right, -dx * scale).addScaledVector(up, dy * scale);
        cam.targetT.x = THREE.MathUtils.clamp(cam.targetT.x, -cur.cols / 2, cur.cols / 2);
        cam.targetT.z = THREE.MathUtils.clamp(cam.targetT.z, -cur.rows / 2, cur.rows / 2);
        cam.targetT.y = THREE.MathUtils.clamp(cam.targetT.y, 0, 4);
      } else {
        cam.thetaT -= dx * 0.0065;
        cam.phiT = THREE.MathUtils.clamp(cam.phiT - dy * 0.005, 0.2, 1.45);
      }
    });

    function endPointer(e) {
      if (pointers[e.pointerId]) delete pointers[e.pointerId];

      if (drag && !drag.moved && performance.now() - drag.t < 800) {
        var c = pointerToCell(e.clientX, e.clientY);
        if (c) {
          hoverCell = c;
          if (typeof cellClick === "function") {
            try { cellClick(c.x, c.y); } catch (err) { console.error(err); }
          }
          sync(true);
        }
      }
      drag = null;
      try { dom.releasePointerCapture(e.pointerId); } catch (err) {}
    }

    dom.addEventListener("pointerup", endPointer);
    dom.addEventListener("pointercancel", endPointer);

    dom.addEventListener("wheel", function (e) {
      e.preventDefault();
      cam.rT = THREE.MathUtils.clamp(cam.rT * Math.pow(1.0016, e.deltaY), 5, 55);
    }, { passive: false });

    window.addEventListener("resize", resize);
  }

  /* ---------------- boucle de rendu ---------------- */

  function applyCamera() {
    cam.theta += (cam.thetaT - cam.theta) * 0.16;
    cam.phi += (cam.phiT - cam.phi) * 0.16;
    cam.r += (cam.rT - cam.r) * 0.16;
    cam.target.lerp(cam.targetT, 0.16);
    var sph = new THREE.Spherical(cam.r, cam.phi, cam.theta);
    camera.position.setFromSpherical(sph).add(cam.target);
    camera.lookAt(cam.target);
  }

  function animateDecor(t) {
    gStatic.traverse(function (o) {
      var kind = o.userData && o.userData.anim;
      if (!kind) return;
      if (kind === "flame") {
        var s = 0.85 + Math.sin(t * 7 + o.userData.phase) * 0.2;
        o.scale.set(s, 0.9 + Math.sin(t * 9 + o.userData.phase) * 0.24, s);
        o.position.y = o.userData.baseY + Math.sin(t * 5 + o.userData.phase) * 0.04;
      } else if (kind === "pulse") {
        o.position.y = o.userData.baseY + Math.sin(t * 2 + o.userData.phase) * 0.03;
        o.scale.setScalar(1 + Math.sin(t * 2.4 + o.userData.phase) * 0.07);
      } else if (kind === "spin") {
        o.rotation.y = t * 0.9;
      } else if (kind === "crystal") {
        o.rotation.y = t * 0.8 + o.userData.phase;
        o.position.y = o.userData.baseY + Math.sin(t * 1.4 + o.userData.phase) * 0.07;
      } else if (kind === "void") {
        o.rotation.z = t * 0.6 + o.userData.phase;
        o.scale.setScalar(1 + Math.sin(t * 1.6 + o.userData.phase) * 0.05);
      }
    });
  }

  function animateTokens(dt, t) {
    var now = performance.now();
    Object.keys(tokenMeshes).forEach(function (id) {
      var m = tokenMeshes[id];
      if (!m) return;

      m.g.position.x += (m.tx - m.g.position.x) * Math.min(1, dt * 14);
      m.g.position.z += (m.tz - m.g.position.z) * Math.min(1, dt * 14);

      if (m.dying) {
        m.g.position.y -= dt * 1.4;
        m.g.scale.multiplyScalar(Math.max(0.001, 1 - dt * 3));
        if (now - m.deathAt > 500 || m.g.scale.x < 0.03) {
          gTokens.remove(m.g);
          disposeTree(m.g);
          delete tokenMeshes[id];
        }
        return;
      }

      var spawn = m.g.userData.spawn || 0;
      if (spawn < 1) {
        spawn = Math.min(1, spawn + dt * 4);
        m.g.userData.spawn = spawn;
        var e = 1 - Math.pow(1 - spawn, 3);
        m.g.scale.setScalar(e);
      }

      m.g.position.y = Math.sin(t * 1.7 + m.phase) * 0.028;
    });
  }

  function frame(now) {
    requestAnimationFrame(frame);
    if (!mounted) return;

    var tab = el(SECTION_ID);
    if (!tab || !tab.classList.contains("active")) return;

    var dt = Math.min((now - lastFrame) / 1000, 0.05) || 0.016;
    lastFrame = now;
    var t = now / 1000;

    if (now - lastSync > 180) {
      lastSync = now;
      sync(false);
    }

    applyCamera();
    animateDecor(t);
    animateTokens(dt, t);

    renderer.render(scene, camera);
  }

  /* ---------------- activation de l'onglet ---------------- */

  function activate() {
    ensureThree(function () {
      mount();
      if (!mounted) return;
      resize();
      sync(true);
      lastFrame = performance.now();
    });
  }

  function bindTab() {
    var btn = document.querySelector('.tab-btn[data-tab="' + TAB_ID + '"]');
    if (!btn) return;
    btn.addEventListener("click", function () {
      requestAnimationFrame(activate);
    });

    var recenter = el("b3d-recenter");
    if (recenter) recenter.addEventListener("click", function () {
      cam.topView = false;
      cam.savedPhi = 0.98;
      cam.rT = Math.max(cur.cols, cur.rows) * 1.16 + 5;
      cam.thetaT = (state.turn === "A" ? 0.85 + Math.PI : 0.85);
      cam.phiT = 0.98;
      cam.targetT.set(0, 0.6, 0);
      var tv = el("b3d-topview");
      if (tv) { tv.textContent = "⤓ Vue de haut"; tv.classList.remove("active"); }
    });

    var topview = el("b3d-topview");
    if (topview) topview.addEventListener("click", function () {
      if (cam.topView) {
        cam.phiT = cam.savedPhi || 0.98;
        cam.topView = false;
        topview.textContent = "⤓ Vue de haut";
        topview.classList.remove("active");
      } else {
        cam.savedPhi = cam.phi;
        cam.phiT = 0.02;
        cam.rT = Math.max(cur.cols, cur.rows) * 1.3 + 3;
        /* Vue de haut : terrain parfaitement droit (axe X horizontal). */
        cam.thetaT = 0;
        cam.topView = true;
        topview.textContent = "◉ Vue 3D";
        topview.classList.add("active");
      }
    });

    var fullscreen = el("b3d-fullscreen");
    if (fullscreen) fullscreen.addEventListener("click", function () {
      var host = el("board3d");
      if (!host) return;
      if (!document.fullscreenElement) {
        document.body.classList.add("bigscreen3d");
        if (host.requestFullscreen) host.requestFullscreen().catch(function () {});
        else if (host.webkitRequestFullscreen) host.webkitRequestFullscreen();
        fullscreen.textContent = "✕ Quitter";
      } else {
        document.body.classList.remove("bigscreen3d");
        if (document.exitFullscreen) document.exitFullscreen();
        fullscreen.textContent = "⛶ Grand écran";
      }
    });
    document.addEventListener("fullscreenchange", function () {
      var fs = el("b3d-fullscreen");
      if (document.fullscreenElement) {
        if (fs) fs.textContent = "✕ Quitter";
      } else {
        document.body.classList.remove("bigscreen3d");
        if (fs) fs.textContent = "⛶ Grand écran";
      }
      if (mounted) { resize(); }
    });

    var next = el("b3d-next");
    if (next) next.addEventListener("click", function () {
      var b = el("next-turn");
      if (b) b.click();
      sync(true);
    });

    var undo = el("b3d-undo");
    if (undo) undo.addEventListener("click", function () {
      var b = el("undo-btn");
      if (b) b.click();
      sync(true);
    });

    var help = el("b3d-help");
    if (help) help.addEventListener("click", function () {
      help.classList.toggle("open");
    });
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", bindTab);
  } else {
    bindTab();
  }

  /* Point d'accès pour les tests et le debug (console navigateur). */
  window.__lux3d = {
    get mounted() { return mounted; },
    get scene() { return scene; },
    get renderer() { return renderer; },
    get camera() { return camera; },
    get cam() { return cam; },
    cameraSide: cameraSide,
    get tokens() { return tokenMeshes; },
    get cells() { return cur; },
    stats: function () {
      if (!renderer) return null;
      var i = renderer.info;
      return {
        drawCalls: i.render.calls,
        triangles: i.render.triangles,
        geometries: i.memory.geometries,
        textures: i.memory.textures,
        tokens: Object.keys(tokenMeshes).length
      };
    },
    sync: function () { sync(true); },
    frame: frame,
    activate: activate
  };

  requestAnimationFrame(frame);
})();
