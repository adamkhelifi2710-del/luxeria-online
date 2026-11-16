  /* ---------------- système d'animation ---------------- */

  var tokenAnim = {};
  var effects = [];

  function spawnEffect(mesh, duration, updateFn) {
    mesh.userData.animStart = performance.now();
    effects.push({ mesh: mesh, timer: 0, duration: duration, update: updateFn });
    gTokens.add(mesh);
  }

  function removeEffect(eff) {
    gTokens.remove(eff.mesh);
    disposeTree(eff.mesh);
  }

  function faceTarget(tok, targetX, targetZ) {
    var m = tokenMeshes[tok.id];
    if (!m || !m.g) return;
    var dx = (targetX + cur.ox) - m.g.position.x;
    var dz = (targetZ + cur.oz) - m.g.position.z;
    var angle = Math.atan2(dx, dz);
    var base = tok.player === "B" ? Math.PI : 0;
    m.g.rotation.y = base + angle;
  }

  function triggerWalk(tok, fromX, fromY, toX, toY) {
    var m = tokenMeshes[tok.id];
    if (!m) return;
    tokenAnim[tok.id] = { state: "walk", timer: 0, duration: 0.4, fromX: fromX, fromY: fromY, toX: toX, toY: toY };
    faceTarget(tok, toX, toY);
  }

  function triggerHit(tok) {
    var m = tokenMeshes[tok.id];
    if (!m) return;
    tokenAnim[tok.id] = { state: "hit", timer: 0, duration: 0.3 };
  }

  function triggerDeath(tok) {
    var m = tokenMeshes[tok.id];
    if (!m) return;
    tokenAnim[tok.id] = { state: "death", timer: 0, duration: 0.8 };
  }

  function triggerSpecial(tok, targetX, targetY) {
    var m = tokenMeshes[tok.id];
    if (!m) return;
    tokenAnim[tok.id] = { state: "special", timer: 0, duration: 1.2, targetX: targetX, targetY: targetY };
    faceTarget(tok, targetX, targetY);
  }

  function spawnSlash(x, y, color) {
    var p = cellPos(x, y);
    for (var i = 0; i < 3; i++) {
      var slash = new THREE.Mesh(new THREE.BoxGeometry(0.6, 0.04, 0.04), std(color, { emissive: color, emissiveIntensity: 2.5, transparent: true, opacity: 0.9 }));
      slash.position.set(p.x + (i - 1) * 0.15, 0.6 + i * 0.15, p.z);
      slash.rotation.z = (Math.random() - 0.5) * 0.6;
      spawnEffect(slash, 0.4, function (eff, dt, t) {
        eff.mesh.rotation.z += dt * 3;
        eff.mesh.scale.x *= 0.92;
        eff.mesh.material.opacity *= 0.9;
      });
    }
  }

  function spawnProjectile(fromX, fromY, toX, toY, color, size) {
    size = size || 0.15;
    var fp = cellPos(fromX, fromY);
    var tp = cellPos(toX, toY);
    var proj = new THREE.Mesh(new THREE.SphereGeometry(size, 8, 6), std(color, { emissive: color, emissiveIntensity: 3, roughness: 0.2 }));
    proj.position.set(fp.x, 0.6, fp.z);
    proj.userData.from = { x: fp.x, z: fp.z };
    proj.userData.to = { x: tp.x, z: tp.z };
    proj.userData.progress = 0;
    spawnEffect(proj, 0.5, function (eff, dt, t) {
      eff.mesh.userData.progress = Math.min(1, eff.mesh.userData.progress + dt * 2.5);
      var pr = eff.mesh.userData.progress;
      eff.mesh.position.x = eff.mesh.userData.from.x + (eff.mesh.userData.to.x - eff.mesh.userData.from.x) * pr;
      eff.mesh.position.z = eff.mesh.userData.from.z + (eff.mesh.userData.to.z - eff.mesh.userData.from.z) * pr;
      eff.mesh.position.y = 0.6 + Math.sin(pr * Math.PI) * 0.3;
      if (pr >= 1) {
        var flash = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), std(color, { emissive: color, emissiveIntensity: 4, transparent: true, opacity: 0.8 }));
        flash.position.copy(eff.mesh.position);
        spawnEffect(flash, 0.3, function (e2, dt2, t2) {
          e2.mesh.scale.setScalar(1 + (1 - e2.timer / e2.duration) * 0.5);
          e2.mesh.material.opacity = 0.8 * (1 - e2.timer / e2.duration);
        });
      }
    });
  }

  function spawnAura(x, y, color, radius, duration) {
    var p = cellPos(x, y);
    var aura = new THREE.Mesh(new THREE.CylinderGeometry(radius, radius, 0.05, 24, 1, true), std(color, { emissive: color, emissiveIntensity: 1.5, transparent: true, opacity: 0.4, side: THREE.DoubleSide, depthWrite: false }));
    aura.rotation.x = -Math.PI / 2;
    aura.position.set(p.x, 0.15, p.z);
    spawnEffect(aura, duration, function (eff, dt, t) {
      eff.mesh.scale.x = eff.mesh.scale.z = 1 + Math.sin(eff.timer * 3) * 0.05;
      eff.mesh.material.opacity = 0.4 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnGroundSlam(x, y, color) {
    var p = cellPos(x, y);
    var ring = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.06, 8, 24), std(color, { emissive: color, emissiveIntensity: 3, transparent: true, opacity: 0.9 }));
    ring.rotation.x = -Math.PI / 2;
    ring.position.set(p.x, 0.15, p.z);
    spawnEffect(ring, 0.6, function (eff, dt, t) {
      var progress = eff.timer / eff.duration;
      eff.mesh.scale.setScalar(1 + progress * 3);
      eff.mesh.material.opacity = 0.9 * (1 - progress);
    });
    var flash = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), std(color, { emissive: color, emissiveIntensity: 4, transparent: true, opacity: 0.7 }));
    flash.position.set(p.x, 0.3, p.z);
    spawnEffect(flash, 0.3, function (eff, dt, t) {
      eff.mesh.scale.setScalar(1 + (1 - eff.timer / eff.duration) * 0.8);
      eff.mesh.material.opacity = 0.7 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnStars(x, y, color, count) {
    var p = cellPos(x, y);
    for (var i = 0; i < (count || 3); i++) {
      var star = new THREE.Mesh(new THREE.OctahedronGeometry(0.12), std(color, { emissive: color, emissiveIntensity: 2.5, roughness: 0.3 }));
      star.position.set(p.x + (Math.random() - 0.5) * 0.6, 0.8 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.6);
      star.userData.baseY = star.position.y;
      spawnEffect(star, 0.8, function (eff, dt, t) {
        eff.mesh.position.y = eff.mesh.userData.baseY - eff.timer * 1.5;
        eff.mesh.rotation.y += dt * 4;
        eff.mesh.material.opacity = 1 - eff.timer / eff.duration;
        if (eff.timer > eff.duration * 0.5) eff.mesh.scale.setScalar(1 - (eff.timer - eff.duration * 0.5) / (eff.duration * 0.5));
      });
    }
  }

  function spawnIceShard(x, y) {
    var p = cellPos(x, y);
    var shard = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.4, 4), std(0x4fd1ff, { emissive: 0x4fd1ff, emissiveIntensity: 2.5, roughness: 0.2, transparent: true, opacity: 0.9 }));
    shard.position.set(p.x, 0.6, p.z);
    shard.rotation.x = Math.PI;
    spawnEffect(shard, 0.6, function (eff, dt, t) {
      eff.mesh.position.y -= dt * 0.5;
      eff.mesh.rotation.y += dt * 2;
      eff.mesh.material.opacity = 0.9 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnPlasmaRay(x, y) {
    var p = cellPos(x, y);
    var ray = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.2, 8), std(0x8a5cff, { emissive: 0x8a5cff, emissiveIntensity: 3, transparent: true, opacity: 0.8 }));
    ray.rotation.x = Math.PI / 2;
    ray.position.set(p.x, 0.6, p.z);
    spawnEffect(ray, 0.4, function (eff, dt, t) {
      eff.mesh.scale.y = 1 - eff.timer / eff.duration;
      eff.mesh.material.opacity = 0.8 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnDarkOrb(x, y) {
    var p = cellPos(x, y);
    var orb = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 6), std(0x8a5cff, { emissive: 0x4a0080, emissiveIntensity: 3, transparent: true, opacity: 0.85 }));
    orb.position.set(p.x, 0.6, p.z);
    spawnEffect(orb, 0.6, function (eff, dt, t) {
      eff.mesh.scale.setScalar(1 + Math.sin(eff.timer * 8) * 0.15);
      eff.mesh.material.opacity = 0.85 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnMedicalSymbol(x, y) {
    var p = cellPos(x, y);
    var group = new THREE.Group();
    var m = std(0xff4d4d, { emissive: 0xff4d4d, emissiveIntensity: 2.5 });
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.5, 0.12), m));
    group.add(new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.12, 0.12), m));
    group.position.set(p.x, 1.2, p.z);
    spawnEffect(group, 1.0, function (eff, dt, t) {
      eff.mesh.rotation.y += dt * 2;
      eff.mesh.position.y = 1.2 + Math.sin(eff.timer * 2) * 0.1;
      eff.mesh.children.forEach(function (c) { c.material.opacity = 1 - eff.timer / eff.duration; });
    });
  }

  function spawnMagicCircle(x, y, color) {
    var p = cellPos(x, y);
    var circle = new THREE.Mesh(new THREE.RingGeometry(0.6, 0.7, 24), std(color, { emissive: color, emissiveIntensity: 2, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(p.x, 0.12, p.z);
    spawnEffect(circle, 1.0, function (eff, dt, t) {
      eff.mesh.rotation.z += dt * 1.5;
      eff.mesh.scale.setScalar(1 + Math.sin(eff.timer * 2) * 0.05);
      eff.mesh.material.opacity = 0.7 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnConstellation(x, y) {
    var p = cellPos(x, y);
    spawnMagicCircle(x, y, 0xf6c24b);
    for (var i = 0; i < 5; i++) {
      var star = new THREE.Mesh(new THREE.OctahedronGeometry(0.1), std(0xffffff, { emissive: 0xf6c24b, emissiveIntensity: 3, roughness: 0.3 }));
      star.position.set(p.x, 0.5, p.z);
      star.userData.orbit = { radius: 0.8, speed: 2 + i * 0.5, phase: (i / 5) * Math.PI * 2, baseY: 0.5 };
      spawnEffect(star, 1.2, function (eff, dt, t) {
        var o = eff.mesh.userData.orbit;
        eff.mesh.position.x = cellPos(x, y).x + Math.cos(eff.timer * o.speed + o.phase) * o.radius;
        eff.mesh.position.z = cellPos(x, y).z + Math.sin(eff.timer * o.speed + o.phase) * o.radius;
        eff.mesh.position.y = o.baseY + Math.sin(eff.timer * 3 + o.phase) * 0.15;
        eff.mesh.rotation.y += dt * 3;
        eff.mesh.material.opacity = eff.timer < 0.8 ? 1 : 1 - (eff.timer - 0.8) / 0.4;
      });
    }
    setTimeout(function () {
      var flash = new THREE.Mesh(new THREE.SphereGeometry(0.6, 8, 6), std(0xf6c24b, { emissive: 0xffffff, emissiveIntensity: 4, transparent: true, opacity: 0.8 }));
      var pp = cellPos(x, y);
      flash.position.set(pp.x, 0.5, pp.z);
      spawnEffect(flash, 0.4, function (eff, dt, t) {
        eff.mesh.scale.setScalar(1 + (1 - eff.timer / eff.duration) * 1.5);
        eff.mesh.material.opacity = 0.8 * (1 - eff.timer / eff.duration);
      });
    }, 900);
  }

  function spawnFrostWave(x, y) {
    var p = cellPos(x, y);
    var ice = new THREE.Mesh(new THREE.CylinderGeometry(2.5, 2.5, 0.04, 24), std(0x4fd1ff, { emissive: 0x4fd1ff, emissiveIntensity: 1.5, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false }));
    ice.rotation.x = -Math.PI / 2;
    ice.position.set(p.x, 0.08, p.z);
    spawnEffect(ice, 1.2, function (eff, dt, t) {
      eff.mesh.scale.setScalar(1 + t * 0.3);
      eff.mesh.material.opacity = 0.35 * (1 - eff.timer / eff.duration);
    });
    for (var i = 0; i < 6; i++) {
      var angle = (i / 6) * Math.PI * 2;
      var r = 1.2 + Math.random() * 0.8;
      var crystal = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.6, 4), std(0xffffff, { emissive: 0x4fd1ff, emissiveIntensity: 2, roughness: 0.2, transparent: true, opacity: 0.9 }));
      crystal.position.set(p.x + Math.cos(angle) * r, 0.3, p.z + Math.sin(angle) * r);
      crystal.rotation.x = -Math.PI / 2;
      spawnEffect(crystal, 1.0, function (eff, dt, t) {
        eff.mesh.position.y = 0.3 + Math.sin(eff.timer * 4) * 0.05;
        eff.mesh.material.opacity = 0.9 * (1 - eff.timer / eff.duration);
      });
    }
    setTimeout(function () {
      var flash = new THREE.Mesh(new THREE.SphereGeometry(0.8, 8, 6), std(0x4fd1ff, { emissive: 0xffffff, emissiveIntensity: 4, transparent: true, opacity: 0.7 }));
      flash.position.set(p.x, 0.5, p.z);
      spawnEffect(flash, 0.5, function (eff, dt, t) {
        eff.mesh.scale.setScalar(1 + (1 - eff.timer / eff.duration) * 2);
        eff.mesh.material.opacity = 0.7 * (1 - eff.timer / eff.duration);
      });
    }, 800);
  }

  function spawnSmoke(x, y, color) {
    var p = cellPos(x, y);
    for (var i = 0; i < 8; i++) {
      var smoke = new THREE.Mesh(new THREE.SphereGeometry(0.15 + Math.random() * 0.1, 6, 6), std(color, { emissive: color, emissiveIntensity: 1, transparent: true, opacity: 0.5 }));
      smoke.position.set(p.x + (Math.random() - 0.5) * 0.6, 0.3 + Math.random() * 0.4, p.z + (Math.random() - 0.5) * 0.6);
      spawnEffect(smoke, 1.0, function (eff, dt, t) {
        eff.mesh.position.y += dt * 0.5;
        eff.mesh.scale.setScalar(1 + eff.timer * 0.5);
        eff.mesh.material.opacity = 0.5 * (1 - eff.timer / eff.duration);
      });
    }
  }

  function spawnMagicCircleDark(x, y) {
    var p = cellPos(x, y);
    var circle = new THREE.Mesh(new THREE.RingGeometry(0.8, 0.9, 24), std(0x8a5cff, { emissive: 0x4a0080, emissiveIntensity: 2.5, transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false }));
    circle.rotation.x = -Math.PI / 2;
    circle.position.set(p.x, 0.12, p.z);
    spawnEffect(circle, 1.2, function (eff, dt, t) {
      eff.mesh.rotation.z += dt * 1.2;
      eff.mesh.material.opacity = 0.7 * (1 - eff.timer / eff.duration);
    });
  }

  function spawnEyes(x, y) {
    var p = cellPos(x, y);
    for (var i = 0; i < 4; i++) {
      var eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 6, 6), std(0xffffff, { emissive: 0x8a5cff, emissiveIntensity: 4, roughness: 0.2 }));
      var angle = (i / 4) * Math.PI * 2;
      eye.position.set(p.x + Math.cos(angle) * 0.6, 0.3, p.z + Math.sin(angle) * 0.6);
      spawnEffect(eye, 0.8, function (eff, dt, t) {
        eff.mesh.material.opacity = t < 0.3 ? t / 0.3 : (t > 0.7 ? (1 - t) / 0.3 : 1);
        eff.mesh.scale.setScalar(0.8 + Math.sin(eff.timer * 6) * 0.2);
      });
    }
  }

  /* ---------------- détection de changements d'état ---------------- */

  var prevTokenState = {};
  var prevSelectedId = null;
  var prevPendingAbility = null;
  var prevPendingSpawn = null;

  function detectStateChanges() {
    var list = (state.tokens || []).filter(function (t) { return t && !t.dead; });
    list.forEach(function (t) {
      var prev = prevTokenState[t.id];
      if (prev) {
        if (prev.x !== t.x || prev.y !== t.y) {
          triggerWalk(t, prev.x, prev.y, t.x, t.y);
        }
        if (t.hp < prev.hp) {
          triggerHit(t);
        }
      }
      prevTokenState[t.id] = { x: t.x, y: t.y, hp: t.hp, dead: t.dead };
    });

    (state.tokens || []).forEach(function (t) {
      if (t.dead && prevTokenState[t.id] && !prevTokenState[t.id].dead) {
        triggerDeath(t);
      }
      if (t.dead) {
        prevTokenState[t.id] = { x: t.x, y: t.y, hp: t.hp, dead: true };
      }
    });

    if (selectedTokenId && selectedTokenId !== prevSelectedId) {
      var tok = tokenById(selectedTokenId);
      if (tok && !tok.dead) {
        var enemies = (state.tokens || []).filter(function (t) { return t.player !== tok.player && !t.dead; });
        if (enemies.length) {
          var nearest = enemies[0];
          var bestDist = 999;
          enemies.forEach(function (e) {
            var d = Math.abs(e.x - tok.x) + Math.abs(e.y - tok.y);
            if (d < bestDist) { bestDist = d; nearest = e; }
          });
          faceTarget(tok, nearest.x, nearest.y);
        }
      }
    }
    prevSelectedId = selectedTokenId;

    if (prevPendingAbility && !pendingAbility && selectedTokenId) {
      var tok = tokenById(selectedTokenId);
      if (tok && !tok.dead) {
        var target = null;
        if (attackCells && attackCells.length) target = attackCells[0];
        var tx = target ? target[0] : tok.x;
        var ty = target ? target[1] : tok.y;
        triggerSpecial(tok, tx, ty);
        spawnSpecialEffect(tok.charId, tok.x, tok.y, tx, ty);
      }
    }
    prevPendingAbility = pendingAbility;
  }

  function spawnSpecialEffect(charId, fromX, fromY, toX, toY) {
    switch (charId) {
      case "braut":
        spawnAura(fromX, fromY, 0x8a5cff, 1.5, 1.2);
        setTimeout(function () { spawnGroundSlam(fromX, fromY, 0x8a5cff); }, 300);
        break;
      case "vini":
        spawnConstellation(fromX, fromY);
        break;
      case "ad":
        spawnMedicalSymbol(fromX, fromY);
        spawnAura(fromX, fromY, 0xffd700, 2.0, 1.5);
        break;
      case "scrab":
        spawnFrostWave(fromX, fromY);
        break;
      case "xixz":
        spawnPlasmaRay(fromX, fromY);
        spawnAura(fromX, fromY, 0x8a5cff, 1.0, 0.8);
        break;
      case "cazou":
        spawnSmoke(fromX, fromY, 0x8a5cff);
        setTimeout(function () { spawnMagicCircleDark(fromX, fromY); }, 200);
        setTimeout(function () { spawnEyes(fromX, fromY); }, 400);
        break;
    }
  }

  /* ---------------- mise à jour des animations (par frame) ---------------- */

  function updateAnimations(dt, t) {
    Object.keys(tokenAnim).forEach(function (id) {
      var anim = tokenAnim[id];
      anim.timer += dt;
      var m = tokenMeshes[id];
      if (!m) { delete tokenAnim[id]; return; }
      var progress = Math.min(1, anim.timer / anim.duration);

      if (anim.state === "walk") {
        var fromP = cellPos(anim.fromX, anim.fromY);
        var toP = cellPos(anim.toX, anim.toY);
        m.g.position.x = fromP.x + (toP.x - fromP.x) * progress;
        m.g.position.z = fromP.z + (toP.z - fromP.z) * progress;
        m.g.position.y = Math.sin(progress * Math.PI) * 0.15;
        m.g.rotation.x = Math.sin(progress * Math.PI) * 0.1;
      } else if (anim.state === "hit") {
        m.g.position.x = m.tx + (Math.random() - 0.5) * 0.08;
        m.g.position.z = m.tz + (Math.random() - 0.5) * 0.08;
        if (progress >= 1) {
          m.g.position.x = m.tx;
          m.g.position.z = m.tz;
          delete tokenAnim[id];
        }
      } else if (anim.state === "death") {
        m.g.position.y = -progress * 0.5;
        m.g.scale.setScalar(1 - progress * 0.7);
        m.g.rotation.x = progress * 0.5;
        if (progress >= 1) {
          gTokens.remove(m.g);
          disposeTree(m.g);
          delete tokenMeshes[id];
          delete tokenAnim[id];
        }
      } else if (anim.state === "special") {
        m.g.scale.setScalar(1 + Math.sin(anim.timer * 6) * 0.08);
        if (progress >= 1) {
          m.g.scale.setScalar(1);
          delete tokenAnim[id];
        }
      }

      if (tokenAnim[id] && anim.timer >= anim.duration && anim.state !== "hit") {
        if (anim.state === "walk") {
          m.g.position.x = m.tx;
          m.g.position.z = m.tz;
          m.g.position.y = 0;
          m.g.rotation.x = 0;
        }
        delete tokenAnim[id];
      }
    });

    for (var i = effects.length - 1; i >= 0; i--) {
      var eff = effects[i];
      eff.timer += dt;
      if (eff.update) eff.update(eff, dt, eff.timer);
      if (eff.timer >= eff.duration) {
        removeEffect(eff);
        effects.splice(i, 1);
      }
    }
  }

  /* ---------------- hooks ---------------- */

  var _origSync = sync;
  sync = function (force) {
    detectStateChanges();
    _origSync(force);
  };

  var _origRender = renderer.render.bind(renderer);
  renderer.render = function (scene, camera) {
    var dt = Math.min((performance.now() - lastFrame) / 1000, 0.05) || 0.016;
    lastFrame = performance.now();
    updateAnimations(dt, performance.now() / 1000);
    _origRender(scene, camera);
  };

  /* ---------------- hook attaque (détectée via HP decrease + selectedTokenId) ---------------- */

  // Override cellClick to trigger attack animations
  var _origCellClick = cellClick;
  // We can't easily override cellClick since it's a function declaration.
  // Instead, we detect attacks via HP changes in detectStateChanges (already done).

  requestAnimationFrame(frame);
})();"