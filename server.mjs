import { randomUUID } from "node:crypto";
import { createReadStream, existsSync, readFileSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, resolve } from "node:path";

const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const PORT = Number(process.env.PORT || 8787);
const DIST_DIR = resolve("dist");
const lobbies = new Map();
const listeners = new Map();

function createCode() {
  let code = "";
  do {
    code = Array.from({ length: 6 }, () => CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)]).join("");
  } while (lobbies.has(code));
  return code;
}

function publicLobby(lobby) {
  return {
    code: lobby.code,
    status: lobby.status,
    createdAt: lobby.createdAt,
    players: lobby.players.map(({ id, name, role, ready, abilityModifier, proficiencyBonus, extraBonus }) => ({
      id,
      name,
      role,
      ready,
      abilityModifier,
      proficiencyBonus,
      extraBonus
    })),
    challenges: lobby.challenges,
    results: lobby.results
  };
}

function normalizeCode(value = "") {
  return String(value).toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function sanitizeName(value) {
  const name = String(value || "").trim().replace(/\s+/g, " ").slice(0, 18);
  return name.length >= 2 ? name : "Player";
}

function statNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(-5, Math.min(12, Math.trunc(number))) : fallback;
}

function createPlayer(body, role) {
  return {
    id: randomUUID(),
    name: sanitizeName(body.name),
    role,
    ready: role === "DM",
    abilityModifier: statNumber(body.abilityModifier),
    proficiencyBonus: statNumber(body.proficiencyBonus, 2),
    extraBonus: statNumber(body.extraBonus)
  };
}

function sanitizeSkill(value) {
  const skill = String(value || "").trim().replace(/\s+/g, " ").slice(0, 24);
  return skill || "Skill Check";
}

function challengeForBody(body) {
  return {
    id: randomUUID(),
    playerId: String(body.playerId || ""),
    type: "timing_bar",
    skill: sanitizeSkill(body.skill),
    dc: Math.max(5, Math.min(30, Math.trunc(Number(body.dc) || 15))),
    status: "pending",
    createdAt: new Date().toISOString()
  };
}

function sendJson(res, status, body) {
  res.writeHead(status, {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PATCH,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Content-Type": "application/json"
  });
  res.end(JSON.stringify(body));
}

function readBody(req) {
  return new Promise((resolveBody, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
      if (raw.length > 10000) {
        reject(new Error("Request body is too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolveBody(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error("Invalid JSON"));
      }
    });
  });
}

function broadcast(code) {
  const lobby = lobbies.get(code);
  if (!lobby) return;
  const payload = `event: lobby\ndata: ${JSON.stringify({ lobby: publicLobby(lobby) })}\n\n`;
  for (const res of listeners.get(code) || []) {
    res.write(payload);
  }
}

function addListener(code, res) {
  if (!listeners.has(code)) listeners.set(code, new Set());
  listeners.get(code).add(res);
  res.on("close", () => listeners.get(code)?.delete(res));
}

function serveStatic(req, res) {
  const requestPath = new URL(req.url, `http://${req.headers.host}`).pathname;
  const assetPath = requestPath === "/" ? "index.html" : requestPath.slice(1);
  const filePath = resolve(join(DIST_DIR, assetPath));

  if (!filePath.startsWith(DIST_DIR) || !existsSync(filePath)) {
    const indexPath = join(DIST_DIR, "index.html");
    if (!existsSync(indexPath)) return sendJson(res, 404, { error: "Run npm run build before serving the app." });
    res.writeHead(200, { "Content-Type": "text/html" });
    res.end(readFileSync(indexPath));
    return;
  }

  const contentTypes = {
    ".css": "text/css",
    ".html": "text/html",
    ".js": "text/javascript",
    ".json": "application/json",
    ".svg": "image/svg+xml"
  };

  res.writeHead(200, { "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream" });
  createReadStream(filePath).pipe(res);
}

async function handleApi(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  const parts = url.pathname.split("/").filter(Boolean);

  if (req.method === "OPTIONS") return sendJson(res, 204, {});

  if (req.method === "POST" && url.pathname === "/api/lobbies") {
    const body = await readBody(req);
    const code = createCode();
    const dm = createPlayer(body, "DM");
    const lobby = {
      code,
      status: "waiting",
      createdAt: new Date().toISOString(),
      players: [dm],
      challenges: [],
      results: []
    };
    lobbies.set(code, lobby);
    broadcast(code);
    return sendJson(res, 201, { lobby: publicLobby(lobby), playerId: dm.id });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "lobbies" && parts.length === 3) {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });
    return sendJson(res, 200, { lobby: publicLobby(lobby) });
  }

  if (req.method === "GET" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "events") {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });
    res.writeHead(200, {
      "Access-Control-Allow-Origin": "*",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
      "Content-Type": "text/event-stream"
    });
    addListener(code, res);
    res.write(`event: lobby\ndata: ${JSON.stringify({ lobby: publicLobby(lobby) })}\n\n`);
    return;
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "join") {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });
    if (lobby.status !== "waiting") return sendJson(res, 409, { error: "Lobby already started" });

    const body = await readBody(req);
    const player = createPlayer(body, "Player");
    lobby.players.push(player);
    broadcast(code);
    return sendJson(res, 200, { lobby: publicLobby(lobby), playerId: player.id });
  }

  if (req.method === "PATCH" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "players") {
    const code = normalizeCode(parts[2]);
    const playerId = parts[4];
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });
    const player = lobby.players.find((candidate) => candidate.id === playerId);
    if (!player) return sendJson(res, 404, { error: "Player not found" });

    const body = await readBody(req);
    player.ready = Boolean(body.ready);
    broadcast(code);
    return sendJson(res, 200, { lobby: publicLobby(lobby) });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "challenges") {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });

    const body = await readBody(req);
    const challenge = challengeForBody(body);
    const player = lobby.players.find((candidate) => candidate.id === challenge.playerId && candidate.role === "Player");
    if (!player) return sendJson(res, 404, { error: "Choose a connected player first" });

    lobby.challenges.push(challenge);
    broadcast(code);
    return sendJson(res, 201, { lobby: publicLobby(lobby), challenge });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "results") {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });

    const body = await readBody(req);
    const challenge = lobby.challenges.find((candidate) => candidate.id === body.challengeId);
    if (!challenge) return sendJson(res, 404, { error: "Challenge not found" });
    if (challenge.playerId !== body.playerId) return sendJson(res, 403, { error: "Challenge belongs to another player" });

    const result = {
      id: randomUUID(),
      challengeId: challenge.id,
      playerId: challenge.playerId,
      checkName: challenge.skill,
      resultTier: String(body.resultTier || "Failure"),
      accuracyPercent: Math.max(0, Math.min(100, Math.round(Number(body.accuracyPercent) || 0))),
      finalScore: Math.round(Number(body.finalScore) || 0),
      dc: challenge.dc,
      passed: Boolean(body.passed),
      createdAt: new Date().toISOString()
    };

    challenge.status = "complete";
    lobby.results.unshift(result);
    broadcast(code);
    return sendJson(res, 201, { lobby: publicLobby(lobby), result });
  }

  if (req.method === "POST" && parts[0] === "api" && parts[1] === "lobbies" && parts[3] === "start") {
    const code = normalizeCode(parts[2]);
    const lobby = lobbies.get(code);
    if (!lobby) return sendJson(res, 404, { error: "Lobby not found" });
    if (!lobby.players.every((player) => player.ready)) return sendJson(res, 409, { error: "Everyone must be ready first" });
    lobby.status = "started";
    broadcast(code);
    return sendJson(res, 200, { lobby: publicLobby(lobby) });
  }

  return sendJson(res, 404, { error: "Not found" });
}

createServer((req, res) => {
  if (req.url?.startsWith("/api/")) {
    handleApi(req, res).catch((error) => sendJson(res, 400, { error: error.message }));
    return;
  }
  serveStatic(req, res);
}).listen(PORT, "0.0.0.0", () => {
  console.log(`Lobby server running on http://127.0.0.1:${PORT}`);
});
