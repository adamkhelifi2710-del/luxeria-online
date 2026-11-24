/*
 * Luxeria - serveur de partie en ligne.
 *
 * Rôle :
 *   - sert les fichiers statiques du jeu (index.html, app.js, data.js, style.css, images...) ;
 *   - gère des salons de 2 ou 4 joueurs : le créateur choisit le mode et la
 *     taille, les autres rejoignent avec un code ; les rôles sont A, B, C, D ;
 *   - relaie tous les messages de jeu entre les membres d'un même salon.
 *   - conserve l'ancien matchmaking « queue » (2 joueurs) pour compatibilité.
 *
 * Lancement local :  npm install  puis  npm start  (http://localhost:3000)
 * Déploiement      :  Render (Web Service) -> Build: npm install  /  Start: npm start
 */

const http = require("http");
const fs = require("fs");
const path = require("path");
const { WebSocketServer } = require("ws");

const PORT = process.env.PORT || 3000;
const ROOT = __dirname;

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".glb": "model/gltf-binary",
  ".gltf": "model/gltf+json",
  ".webmanifest": "application/manifest+json",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".txt": "text/plain; charset=utf-8"
};

const EXT_OK = new Set(Object.keys(MIME));
const FILE_DENY = new Set(["server.js", "package.json", "package-lock.json", "yarn.lock"]);

function serveStatic(req, res) {
  let urlPath;
  try {
    urlPath = decodeURIComponent((req.url || "/").split("?")[0]);
  } catch (e) {
    res.writeHead(400);
    res.end("Bad Request");
    return;
  }
  if (urlPath === "/") urlPath = "/index.html";

  const rel = urlPath.replace(/^\/+/, "");
  const base = path.basename(rel);
  const ext = path.extname(rel).toLowerCase();

  if (
    rel.includes("..") ||
    rel.startsWith(".") ||
    FILE_DENY.has(base) ||
    rel.split("/").some((part) => part.startsWith(".") || part === "node_modules") ||
    !EXT_OK.has(ext)
  ) {
    res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }

  const filePath = path.join(ROOT, rel);
  if (!filePath.startsWith(ROOT)) {
    res.writeHead(403);
    res.end("Forbidden");
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      res.end("Not Found");
      return;
    }
    res.writeHead(200, {
      "Content-Type": MIME[ext] || "application/octet-stream",
      "Cache-Control": "no-cache"
    });
    res.end(data);
  });
}

const server = http.createServer(serveStatic);
const wss = new WebSocketServer({ server });

const ROLE_ORDER = ["A", "B", "C", "D"];
let waiting = [];           // matchmaking 1v1 historique
let roomSeq = 0;
const rooms = new Map();    // code -> { code, size, mode, members: [{ ws, role }] }

function safeSend(ws, obj) {
  if (!ws || ws.readyState !== ws.OPEN) return;
  try { ws.send(JSON.stringify(obj)); } catch (e) {}
}

function removeFromQueue(ws, notify) {
  const i = waiting.indexOf(ws);
  if (i >= 0) {
    waiting.splice(i, 1);
    if (notify) safeSend(ws, { type: "queue-left" });
  }
}

function roomInfo(room) {
  return {
    code: room.code,
    size: room.size,
    mode: room.mode,
    players: room.members.map((m) => m.role)
  };
}

function broadcastRoom(room, obj, except) {
  room.members.forEach((m) => {
    if (m.ws !== except) safeSend(m.ws, obj);
  });
}

function broadcastRaw(room, raw, except) {
  room.members.forEach((m) => {
    if (m.ws === except || m.ws.readyState !== m.ws.OPEN) return;
    try { m.ws.send(raw); } catch (e) {}
  });
}

function newCode() {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  do {
    code = "";
    for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  } while (rooms.has(code));
  return code;
}

function createRoom(size, mode) {
  const cap = size === 4 ? 4 : 2;
  const room = {
    code: newCode(),
    size: cap,
    mode: mode === "quad" || mode === "rampage" ? mode : "classic",
    members: []
  };
  rooms.set(room.code, room);
  return room;
}

function addToRoom(ws, room, role) {
  ws.__room = room.code;
  ws.__role = role;
  room.members.push({ ws, role });
}

function leaveRoom(ws, notify) {
  const code = ws.__room;
  if (!code) return;
  const room = rooms.get(code);
  ws.__room = null;
  ws.__role = null;
  if (!room) return;
  const leaving = room.members.find((m) => m.ws === ws);
  const leavingRole = leaving ? leaving.role : null;
  room.members = room.members.filter((m) => m.ws !== ws);
  if (!room.members.length) {
    rooms.delete(code);
    return;
  }
  broadcastRoom(room, { type: "room-update", ...roomInfo(room) });
  broadcastRoom(room, { type: "peer-left", role: leavingRole });
  if (notify) safeSend(ws, { type: "room-left" });
}

function tryMatch() {
  while (waiting.length >= 2) {
    const a = waiting.shift();
    const b = waiting.shift();
    if (a.readyState !== a.OPEN) { if (b.readyState === b.OPEN) waiting.unshift(b); continue; }
    if (b.readyState !== b.OPEN) { waiting.unshift(a); continue; }

    const room = createRoom(2, "classic");
    addToRoom(a, room, "A");
    addToRoom(b, room, "B");
    safeSend(a, { type: "matched", role: "host", ...roomInfo(room) });
    safeSend(b, { type: "matched", role: "client", ...roomInfo(room) });
  }
}

wss.on("connection", (ws) => {
  ws.__room = null;
  ws.__role = null;

  ws.on("message", (raw) => {
    let msg = null;
    try { msg = JSON.parse(raw.toString()); } catch (e) { return; }
    if (!msg || typeof msg !== "object") return;
    const t = msg.type;

    if (t === "queue") {
      if (!waiting.includes(ws) && !ws.__room) {
        waiting.push(ws);
        safeSend(ws, { type: "queued" });
        tryMatch();
      }
      return;
    }
    if (t === "create") {
      removeFromQueue(ws, false);
      if (ws.__room) leaveRoom(ws, true);
      const room = createRoom(msg.size, msg.mode);
      addToRoom(ws, room, "A");
      safeSend(ws, { type: "room-created", role: "host", ...roomInfo(room) });
      return;
    }
    if (t === "join") {
      removeFromQueue(ws, false);
      if (ws.__room) leaveRoom(ws, true);
      const code = String(msg.code || "").trim().toUpperCase();
      const room = rooms.get(code);
      if (!room) { safeSend(ws, { type: "room-error", message: "Code introuvable." }); return; }
      if (room.members.length >= room.size) { safeSend(ws, { type: "room-error", message: "Le salon est complet." }); return; }
      const used = room.members.map((m) => m.role);
      const role = ROLE_ORDER.find((r) => used.indexOf(r) < 0) || "B";
      addToRoom(ws, room, role);
      safeSend(ws, { type: "room-joined", role, ...roomInfo(room) });
      broadcastRoom(room, { type: "room-update", ...roomInfo(room) }, ws);
      return;
    }
    if (t === "cancel" || t === "leave") {
      removeFromQueue(ws, true);
      leaveRoom(ws, true);
      return;
    }

    // Tout le reste est relayé à tous les autres membres du salon.
    const room = ws.__room && rooms.get(ws.__room);
    if (room) broadcastRaw(room, raw.toString(), ws);
  });

  ws.on("close", () => {
    removeFromQueue(ws, false);
    leaveRoom(ws, false);
  });

  ws.on("error", () => {
    removeFromQueue(ws, false);
    leaveRoom(ws, false);
  });
});

server.listen(PORT, () => {
  console.log("Luxeria en ligne -> http://localhost:" + PORT);
});
