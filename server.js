/*
 * Luxeria - serveur de partie en ligne.
 *
 * Rôle :
 *   - sert les fichiers statiques du jeu (index.html, app.js, data.js, style.css, images...) ;
 *   - gère une file d'attente ("matchmaking") : les deux premiers joueurs en attente
 *     sont appariés (le premier = hôte / Équipe A, le second = client / Équipe B) ;
 *   - relaie tous les messages de jeu entre les deux joueurs d'une même partie.
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

let waiting = [];           // joueurs en file d'attente (WebSocket)
let roomSeq = 0;
const rooms = new Map();    // roomId -> { a: ws, b: ws }

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

function peerOf(ws) {
  const room = ws.__room && rooms.get(ws.__room);
  if (!room) return null;
  return room.a === ws ? room.b : room.a;
}

function leaveRoom(ws, notify) {
  const roomId = ws.__room;
  if (!roomId) return;
  const room = rooms.get(roomId);
  rooms.delete(roomId);
  ws.__room = null;
  if (room) {
    const peer = room.a === ws ? room.b : room.a;
    if (peer) {
      peer.__room = null;
      if (notify) safeSend(peer, { type: "peer-left" });
    }
  }
}

function tryMatch() {
  while (waiting.length >= 2) {
    const a = waiting.shift();
    const b = waiting.shift();
    if (a.readyState !== a.OPEN) { if (b.readyState === b.OPEN) waiting.unshift(b); continue; }
    if (b.readyState !== b.OPEN) { waiting.unshift(a); continue; }

    const roomId = "room-" + (++roomSeq) + "-" + Date.now();
    a.__room = roomId;
    b.__room = roomId;
    rooms.set(roomId, { a, b });

    safeSend(a, { type: "matched", role: "host" });
    safeSend(b, { type: "matched", role: "client" });
  }
}

wss.on("connection", (ws) => {
  ws.__room = null;

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
    if (t === "cancel") {
      removeFromQueue(ws, true);
      return;
    }

    // Tout le reste est relayé au partenaire de la partie.
    const peer = peerOf(ws);
    if (peer && peer.readyState === peer.OPEN) {
      try { peer.send(raw.toString()); } catch (e) {}
    }
  });

  ws.on("close", () => {
    removeFromQueue(ws, false);
    leaveRoom(ws, true);
  });

  ws.on("error", () => {
    removeFromQueue(ws, false);
    leaveRoom(ws, true);
  });
});

server.listen(PORT, () => {
  console.log("Luxeria en ligne -> http://localhost:" + PORT);
});
