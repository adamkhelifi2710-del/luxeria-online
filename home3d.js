/* =========================================================================
   Luxeria — accueil 3D (bêta)
   -------------------------------------------------------------------------
   Écran d'accueil alternatif : le plateau du terrain actif tourne en 3D et
   les mêmes modes que l'accueil classique sont proposés. Aucune logique
   dupliquée : chaque bouton délègue au bouton correspondant de l'accueil 2D.
   ========================================================================= */

(function () {
  "use strict";

  if (typeof GAME === "undefined") return;

  var COL = {
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
    voidc: 0x8a5cff,
    white: 0xf4f8ff
  };

  var THREE = null;
  var loading = false;
  var waiters = [];

  var renderer = null;
  var scene = null;
  var camera = null;
  var group = null;
  var ready = false;
  var opened = false;
  var lastT = 0;

  function el(id) { return document.getElementById(id); }

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

  /* ---------------- Three.js à la demande ---------------- */

  function ensureThree(cb) {
    if (window.THREE) { THREE = window.THREE; cb(); return; }
    waiters.push(cb);
    if (loading) return;
    loading = true;
    var s = document.createElement("script");
    s.src = "three.min.js?v=1";
    s.onload = function () {
      loading = false;
      THREE = window.THREE;
      var q = waiters.slice();
      waiters.length = 0;
      q.forEach(function (f) { try { f(); } catch (e) { console.error(e); } });
    };
    s.onerror = function () { loading = false; };
    document.head.appendChild(s);
  }

  /* ---------------- scène ---------------- */

  function init() {
    var host = el("home3d-canvas");
    if (!host) return;

    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.outputEncoding = THREE.sRGBEncoding;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.15;
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.setClearColor(0x000000, 0);
    host.appendChild(renderer.domElement);

    scene = new THREE.Scene();

    camera = new THREE.PerspectiveCamera(42, 1, 0.1, 260);

    scene.add(new THREE.HemisphereLight(0x9dc4ff, 0x0a1018, 0.8));

    var key = new THREE.DirectionalLight(0xfff2dd, 2.1);
    key.position.set(11, 17, 9);
    key.castShadow = true;
    key.shadow.mapSize.set(2048, 2048);
    key.shadow.camera.near = 1;
    key.shadow.camera.far = 70;
    key.shadow.camera.left = -13;
    key.shadow.camera.right = 13;
    key.shadow.camera.top = 13;
    key.shadow.camera.bottom = -13;
    key.shadow.bias = -0.0007;
    key.shadow.radius = 3;
    scene.add(key);

    var fill = new THREE.DirectionalLight(0x7fb2ff, 0.55);
    fill.position.set(-10, 8, -9);
    scene.add(fill);

    group = new THREE.Group();
    scene.add(group);

    ready = true;
    resize();
  }

  function resize() {
    if (!renderer) return;
    var host = el("home3d-canvas");
    if (!host) return;
    var w = host.clientWidth || window.innerWidth;
    var h = host.clientHeight || window.innerHeight;
    renderer.setSize(w, h, false);
    renderer.domElement.style.width = "100%";
    renderer.domElement.style.height = "100%";
    camera.aspect = w / h;
    camera.updateProjectionMatrix();

    var map = GAME.map || { cols: 15, rows: 10 };
    var cols = map.cols || 15;
    var rows = map.rows || 10;
    var span = Math.max(cols, rows);

    /* Panneau à gauche sur grand écran : on décale le plateau à droite. */
    var wide = w > 900;
    group.position.x = wide ? span * 0.26 : 0;

    var r = span * 1.28 + (wide ? 4 : 5.5);
    var sph = new THREE.Spherical(r, 0.98, 0.74);
    camera.position.setFromSpherical(sph);
    camera.position.x += group.position.x;
    camera.lookAt(group.position.x * 0.72, 0.1, 0);
  }

  /* ---------------- plateau décoratif ---------------- */

  function has(list, x, y) {
    if (!list) return false;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i][0] === x && list[i][1] === y) return true;
    }
    return false;
  }

  function build() {
    if (!group) return;

    while (group.children.length) {
      var old = group.children.pop();
      disposeTree(old);
    }

    var map = GAME.map;
    if (!map) return;

    var cols = map.cols || 15;
    var rows = map.rows || 10;
    var ox = -(cols - 1) / 2;
    var oz = -(rows - 1) / 2;

    function px(x) { return x + ox; }
    function pz(y) { return y + oz; }

    var base = new THREE.Mesh(
      new THREE.BoxGeometry(cols + 0.9, 0.62, rows + 0.9),
      std(0x0c1219, { roughness: 0.85, metalness: 0.45 })
    );
    base.position.y = -0.31;
    base.receiveShadow = true;
    group.add(base);

    var rim = new THREE.Mesh(
      new THREE.BoxGeometry(cols + 1.18, 0.07, rows + 1.18),
      std(0x1a2432, { roughness: 0.5, metalness: 0.6, emissive: 0x123048, emissiveIntensity: 0.7 })
    );
    rim.position.y = -0.6;
    group.add(rim);

    var tileGeo = new THREE.BoxGeometry(0.94, 0.1, 0.94);
    var matA = std(COL.tileA, { roughness: 0.72, metalness: 0.2 });
    var matB = std(COL.tileB, { roughness: 0.6, metalness: 0.3 });

    for (var y = 0; y < rows; y++) {
      for (var x = 0; x < cols; x++) {
        if (map.tiles && map.tiles[y] && map.tiles[y][x] === 1) {
          var rock = new THREE.Mesh(
            new THREE.BoxGeometry(0.9, 1.15, 0.9),
            std(COL.blocked, { roughness: 0.55, metalness: 0.45 })
          );
          rock.position.set(px(x), 0.57, pz(y));
          rock.castShadow = true;
          rock.receiveShadow = true;
          group.add(rock);
          continue;
        }

        /* Le vide est un vrai trou : pas de case, juste le puits. */
        if (has(map.voidCells, x, y)) {
          addVoid(px(x), pz(y));
          continue;
        }

        var tile = new THREE.Mesh(tileGeo, ((x + y) % 2 === 0) ? matA : matB);
        tile.position.set(px(x), 0.05, pz(y));
        tile.receiveShadow = true;
        group.add(tile);

        if (has(map.fireCells, x, y)) {
          addFire(px(x), pz(y));
        } else if (has(map.healCells, x, y)) {
          addHeal(px(x), pz(y));
        } else if (has(map.speedCells, x, y)) {
          addSpeed(px(x), pz(y));
        }
      }
    }

    /* zones de départ */
    ["A", "B"].forEach(function (team) {
      (map.startZones && map.startZones[team] || []).forEach(function (c) {
        var ov = new THREE.Mesh(
          new THREE.PlaneGeometry(0.92, 0.92),
          new THREE.MeshBasicMaterial({
            color: team === "A" ? COL.teamA : COL.teamB,
            transparent: true, opacity: 0.14, depthWrite: false
          })
        );
        ov.rotation.x = -Math.PI / 2;
        ov.position.set(px(c[0]), 0.112, pz(c[1]));
        group.add(ov);
      });
    });

    /* murs */
    (map.edgesWalls || []).forEach(function (edge) {
      if (typeof edge !== "string") return;
      var parts = edge.split("-");
      if (parts.length !== 2) return;
      var a = parts[0].split(","), b = parts[1].split(",");
      var x1 = +a[0], y1 = +a[1], x2 = +b[0], y2 = +b[1];
      if (isNaN(x1) || isNaN(y1) || isNaN(x2) || isNaN(y2)) return;

      var w, d, cx, cz;
      if (y1 === y2) {
        cx = (x1 + x2) / 2 + ox;
        cz = y1 + oz;
        w = 0.14; d = 1.0;
      } else if (x1 === x2) {
        cx = x1 + ox;
        cz = (y1 + y2) / 2 + oz;
        w = 1.0; d = 0.14;
      } else {
        return;
      }

      var wall = new THREE.Mesh(
        new THREE.BoxGeometry(w, 1.0, d),
        std(COL.wall, { roughness: 0.45, metalness: 0.55 })
      );
      wall.position.set(cx, 0.5, cz);
      wall.castShadow = true;
      wall.receiveShadow = true;
      group.add(wall);

      var cap = new THREE.Mesh(
        new THREE.BoxGeometry(w * 1.04, 0.055, d * 1.04),
        std(0xffffff, { emissive: COL.wallCap, emissiveIntensity: 1.4, roughness: 0.3 })
      );
      cap.position.set(cx, 1.02, cz);
      group.add(cap);
    });

    /* objectifs */
    ["A", "B"].forEach(function (team) {
      var pos = (GAME.objectives && GAME.objectives[team]) || null;
      if (!pos) return;
      var col = team === "A" ? COL.teamA : COL.teamB;
      var x = px(pos.x), z = pz(pos.y);

      var pillar = new THREE.Mesh(
        new THREE.CylinderGeometry(0.31, 0.45, 1.2, 6),
        std(0x141d29, { roughness: 0.4, metalness: 0.6, emissive: col, emissiveIntensity: 0.26 })
      );
      pillar.position.set(x, 0.62, z);
      pillar.castShadow = true;
      pillar.receiveShadow = true;
      group.add(pillar);

      var crystal = new THREE.Mesh(
        new THREE.OctahedronGeometry(0.28),
        std(col, { emissive: col, emissiveIntensity: 2.2, roughness: 0.25, metalness: 0.1 })
      );
      crystal.position.set(x, 1.7, z);
      crystal.userData.anim = "crystal";
      crystal.userData.phase = team === "A" ? 0 : 2;
      crystal.userData.baseY = 1.7;
      group.add(crystal);

      var light = new THREE.PointLight(col, 7, 4.5, 2);
      light.position.set(x, 1.55, z);
      group.add(light);
    });

    /* champions (bouteilles) */
    ["A", "B"].forEach(function (team) {
      var zone = (map.startZones && map.startZones[team]) || [];
      zone.slice(0, 3).forEach(function (c, i) {
        var bottle = makeBottle(team);
        bottle.position.set(px(c[0]), 0, pz(c[1]));
        bottle.userData.anim = "bottle";
        bottle.userData.phase = i * 1.7 + (team === "B" ? 0.9 : 0);
        group.add(bottle);
      });
    });
  }

  function addFire(x, z) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.fire, { emissive: COL.fire, emissiveIntensity: 1.5, roughness: 0.4 })
    );
    pad.position.set(x, 0.1, z);
    group.add(pad);

    var base = new THREE.Mesh(
      new THREE.CylinderGeometry(0.24, 0.32, 0.08, 16),
      std(0xff4500, { emissive: 0xff4500, emissiveIntensity: 2.6, roughness: 0.3 })
    );
    base.position.set(x, 0.16, z);
    group.add(base);

    var flame = new THREE.Mesh(
      new THREE.ConeGeometry(0.22, 0.78, 8),
      std(0xff8c00, { emissive: COL.fire, emissiveIntensity: 2.4, transparent: true, opacity: 0.9 })
    );
    flame.position.set(x, 0.52, z);
    flame.userData.anim = "flame";
    flame.userData.phase = Math.random() * 6.28;
    flame.userData.baseY = 0.52;
    group.add(flame);

    var flame2 = new THREE.Mesh(
      new THREE.ConeGeometry(0.13, 0.52, 6),
      std(0xffd700, { emissive: 0xffd700, emissiveIntensity: 2.8, transparent: true, opacity: 0.75 })
    );
    flame2.position.set(x + 0.06, 0.42, z - 0.05);
    flame2.userData.anim = "flame2";
    flame2.userData.phase = Math.random() * 6.28;
    flame2.userData.baseY = 0.42;
    group.add(flame2);

    var light = new THREE.PointLight(COL.fire, 6, 3.2, 2);
    light.position.set(x, 0.7, z);
    group.add(light);
  }

  function addHeal(x, z) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.heal, { emissive: COL.heal, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    pad.position.set(x, 0.1, z);
    group.add(pad);

    var cross = new THREE.Group();
    var m = std(0xffffff, { emissive: COL.heal, emissiveIntensity: 2.4, roughness: 0.3 });
    var c1 = new THREE.Mesh(new THREE.BoxGeometry(0.46, 0.1, 0.14), m);
    var c2 = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.1, 0.46), m);
    cross.add(c1, c2);
    cross.position.set(x, 0.48, z);
    cross.userData.anim = "healcross";
    cross.userData.phase = Math.random() * 6.28;
    cross.userData.baseY = 0.48;
    group.add(cross);

    var light = new THREE.PointLight(COL.heal, 5, 3.0, 2);
    light.position.set(x, 0.6, z);
    group.add(light);
  }

  function addSpeed(x, z) {
    var pad = new THREE.Mesh(
      new THREE.BoxGeometry(0.86, 0.04, 0.86),
      std(COL.speed, { emissive: COL.speed, emissiveIntensity: 1.3, roughness: 0.4 })
    );
    pad.position.set(x, 0.1, z);
    group.add(pad);

    var bolt = new THREE.Group();
    var m = std(0xffffff, { emissive: COL.speed, emissiveIntensity: 2.6, roughness: 0.25 });
    var segs = [
      { x: 0.08, y: 0.62, rz: -0.55, w: 0.22, h: 0.07 },
      { x: 0.16, y: 0.42, rz: 0.75, w: 0.07, h: 0.26 },
      { x: -0.06, y: 0.22, rz: -0.55, w: 0.22, h: 0.07 },
      { x: -0.14, y: 0.02, rz: 0.75, w: 0.07, h: 0.26 }
    ];
    segs.forEach(function (s) {
      var box = new THREE.Mesh(new THREE.BoxGeometry(s.w, s.h, 0.06), m);
      box.position.set(s.x, s.y, 0);
      box.rotation.z = s.rz;
      bolt.add(box);
    });
    bolt.position.set(x, 0, z);
    bolt.userData.anim = "bolt";
    bolt.userData.phase = Math.random() * 6.28;
    bolt.userData.baseY = 0;
    group.add(bolt);

    var light = new THREE.PointLight(COL.speed, 5, 3.0, 2);
    light.position.set(x, 0.5, z);
    group.add(light);
  }

  function addVoid(x, z) {
    var pit = new THREE.Mesh(
      new THREE.CylinderGeometry(0.42, 0.28, 0.95, 24, 1, true),
      std(0x020408, { roughness: 1, metalness: 0, side: THREE.DoubleSide, transparent: true, opacity: 0.95 })
    );
    pit.position.set(x, -0.38, z);
    group.add(pit);

    var bottom = new THREE.Mesh(
      new THREE.CircleGeometry(0.28, 24),
      new THREE.MeshBasicMaterial({ color: 0x000000 })
    );
    bottom.rotation.x = -Math.PI / 2;
    bottom.position.set(x, -0.83, z);
    group.add(bottom);

    var rim = new THREE.Mesh(
      new THREE.TorusGeometry(0.42, 0.04, 8, 32),
      std(0xffffff, { emissive: COL.voidc, emissiveIntensity: 2.4 })
    );
    rim.rotation.x = -Math.PI / 2;
    rim.position.set(x, 0.06, z);
    group.add(rim);

    var halo = new THREE.Mesh(
      new THREE.TorusGeometry(0.5, 0.025, 8, 32),
      std(0xffffff, { emissive: COL.voidc, emissiveIntensity: 2, transparent: true, opacity: 0.6 })
    );
    halo.rotation.x = -Math.PI / 2;
    halo.position.set(x, 0.2, z);
    group.add(halo);

    var glow = new THREE.PointLight(COL.voidc, 5, 3.2, 2);
    glow.position.set(x, 0.4, z);
    group.add(glow);
  }

  function makeBottle(team) {
    var g = new THREE.Group();
    var body = std(COL.white, { roughness: 0.34, metalness: 0.06, emissive: 0x2a3a52, emissiveIntensity: 0.25 });
    var teamMat = std(team === "A" ? COL.teamA : COL.teamB, {
      emissive: team === "A" ? COL.teamA : COL.teamB,
      emissiveIntensity: 0.8, roughness: 0.35, metalness: 0.4
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

    var band = new THREE.Mesh(new THREE.CylinderGeometry(0.212, 0.212, 0.14, 24, 1, true), teamMat);
    band.position.y = 0.26;
    band.material.side = THREE.DoubleSide;
    band.material.transparent = true;
    band.material.opacity = 0.85;
    g.add(band);

    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.27, 0.022, 8, 30), teamMat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.055;
    g.add(ring);

    return g;
  }

  /* ---------------- boucle ---------------- */

  function frame(now) {
    requestAnimationFrame(frame);
    if (!opened || !ready) return;

    try {
      var dt = Math.min((now - lastT) / 1000, 0.05) || 0.016;
      lastT = now;
      var t = now / 1000;

      group.rotation.y = -0.16 + Math.sin(t * 0.26) * 0.3;
      group.position.y = Math.sin(t * 0.7) * 0.07;

    group.traverse(function (o) {
      var kind = o.userData && o.userData.anim;
      if (!kind) return;
      if (kind === "flame") {
        var s = 0.85 + Math.sin(t * 7 + o.userData.phase) * 0.2;
        o.scale.set(s, 0.9 + Math.sin(t * 9 + o.userData.phase) * 0.24, s);
        o.position.y = o.userData.baseY + Math.sin(t * 5 + o.userData.phase) * 0.04;
      } else if (kind === "flame2") {
        var s2 = 0.8 + Math.sin(t * 8 + o.userData.phase) * 0.18;
        o.scale.set(s2, 0.85 + Math.sin(t * 10 + o.userData.phase) * 0.2, s2);
        o.position.y = o.userData.baseY + Math.sin(t * 6 + o.userData.phase) * 0.05;
      } else if (kind === "healcross") {
        o.rotation.y = Math.sin(t * 0.8 + o.userData.phase) * 0.4;
        o.position.y = o.userData.baseY + Math.sin(t * 1.6 + o.userData.phase) * 0.1;
      } else if (kind === "bolt") {
        o.position.y = 0.35 + Math.sin(t * 2.2 + o.userData.phase) * 0.12;
        o.rotation.y = Math.sin(t * 1.2 + o.userData.phase) * 0.15;
        o.scale.setScalar(1 + Math.sin(t * 3 + o.userData.phase) * 0.06);
      } else if (kind === "crystal") {
        o.rotation.y = t * 0.8 + o.userData.phase;
        o.position.y = o.userData.baseY + Math.sin(t * 1.4 + o.userData.phase) * 0.07;
      } else if (kind === "void") {
        o.rotation.z = t * 0.6 + o.userData.phase;
        o.scale.setScalar(1 + Math.sin(t * 1.6 + o.userData.phase) * 0.05);
      } else if (kind === "bottle") {
        o.position.y = Math.sin(t * 1.5 + o.userData.phase) * 0.035;
      }
    });

    renderer.render(scene, camera);
    } catch (e) {
      window.__homeErr = String((e && e.message) || e);
    }
  }

  /* ---------------- ouverture / fermeture ---------------- */

  function open() {
    opened = true;
    var scr = el("home3d-screen");
    if (scr) scr.classList.add("open");

    ensureThree(function () {
      if (!ready) init();
      if (!ready) return;
      build();
      resize();
      lastT = performance.now();
    });
  }

  function close() {
    if (!opened) return;
    opened = false;
    var scr = el("home3d-screen");
    if (scr) scr.classList.remove("open");
  }

  /* ---------------- câblage ---------------- */

  function wire() {
    var toggle = el("home-3d-toggle");
    if (toggle) toggle.addEventListener("click", open);

    var back = el("home3d-back");
    if (back) back.addEventListener("click", close);

    /* Chaque mode de l'accueil 3D déclenche le bouton équivalent de l'accueil 2D :
       une seule source de vérité pour les modes. */
    var map = { play: "home-play", online: "home-online", maps: "home-create", library: "home-maps" };
    Array.prototype.forEach.call(document.querySelectorAll("[data-h3d]"), function (btn) {
      btn.addEventListener("click", function () {
        var target = el(map[btn.getAttribute("data-h3d")]);
        if (target) target.click();
      });
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && opened) close();
    });

    window.addEventListener("resize", function () {
      if (opened) resize();
    });

    /* L'accueil 3D se referme dès que l'accueil 2D se ferme (démarrage de
       partie, changement d'onglet…) pour ne jamais masquer le jeu. */
    if (typeof window.hideHome === "function") {
      var orig = window.hideHome;
      window.hideHome = function () {
        close();
        return orig.apply(this, arguments);
      };
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", wire);
  } else {
    wire();
  }

  /* Point d'accès debug / tests. */
  window.__luxhome = {
    get opened() { return opened; },
    get ready() { return ready; },
    get renderer() { return renderer; },
    get group() { return group; },
    open: open,
    close: close,
    stats: function () {
      if (!renderer) return null;
      var i = renderer.info;
      return {
        calls: i.render.calls,
        triangles: i.render.triangles,
        geometries: i.memory.geometries
      };
    }
  };

  requestAnimationFrame(frame);
})();
