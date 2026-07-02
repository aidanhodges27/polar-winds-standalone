import "dotenv/config";
import { Server, matchMaker } from "colyseus";
import { Encoder } from "@colyseus/schema";

// Increase buffer size for large game state (default is 8KB)
Encoder.BUFFER_SIZE = 16 * 1024;
import { monitor } from "@colyseus/monitor";
import { createServer } from "http";
import express from "express";
import cors from "cors";
import { join, dirname } from "path";
import { writeFileSync } from "fs";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { GameRoom } from "./rooms/GameRoom";
import { parseUnrealExport } from "./config/LevelSpec";
import {
  LINKED_SESSION_DURATION_SECONDS,
  LINKED_TEAM_CONFIGS,
  getLinkedSessionSnapshot,
  setLinkedRoomOpponent,
} from "./rooms/LinkedSessionCoordinator";

const port = Number(process.env.PORT || 2567);
const app = express();

// Configure CORS for production
app.use(cors({
  origin: process.env.CLIENT_URL || "*",
  credentials: true
}));
app.use(express.json());

// Health check endpoint
app.get("/health", (_req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

// Admin endpoint: update collectible spawn config or level spec
app.post("/api/admin/update-config", (req, res) => {
  try {
    const config = req.body?.config;
    if (!config || typeof config !== "object") {
      return res.status(400).json({ success: false, error: "Missing or invalid config object" });
    }

    // Detect format
    if (config.clues_per_stage) {
      // Unreal export format → convert to LevelSpec and save
      const levelSpec = parseUnrealExport(config);
      const outPath = join(__dirname, "config/levels/admin-custom.json");
      writeFileSync(outPath, JSON.stringify(levelSpec, null, 2), "utf-8");
      return res.json({ success: true, format: "unreal_export", file: "admin-custom.json" });
    }

    if (config.stages) {
      // Native level spec format → save directly
      const outPath = join(__dirname, "config/levels/admin-custom.json");
      writeFileSync(outPath, JSON.stringify(config, null, 2), "utf-8");
      return res.json({ success: true, format: "level_spec", file: "admin-custom.json" });
    }

    if (config.collectible_spawn_rules) {
      // Native collectible spawn config → overwrite collectible-spawn.json
      const outPath = join(__dirname, "config/collectible-spawn.json");
      writeFileSync(outPath, JSON.stringify(config, null, 2), "utf-8");
      return res.json({ success: true, format: "spawn_config" });
    }

    return res.status(400).json({
      success: false,
      error: "Unrecognized format. Expected collectible_spawn_rules, stages, or clues_per_stage."
    });
  } catch (err: any) {
    console.error("Failed to update config:", err);
    return res.status(500).json({ success: false, error: err.message });
  }
});

// Create a Colyseus room programmatically (called by platform edge functions)
app.post("/api/create-colyseus-room", async (req, res) => {
  try {
    const { soloMode, devMode, levelSpec, levelSpecJson, apiKey, challengeNumber } = req.body;

    const expectedKey = process.env.PLATFORM_API_KEY;
    if (!expectedKey || apiKey !== expectedKey) {
      return res.status(401).json({ error: "Unauthorized" });
    }

    const room = await matchMaker.createRoom("game_room", {
      soloMode: soloMode || false,
      devMode: devMode || false,
      levelSpec: levelSpec || undefined,
      levelSpecJson: levelSpecJson || undefined,
      challengeNumber: challengeNumber ?? undefined,
      platformManaged: true,
    });

    return res.json({
      success: true,
      roomId: room.roomId,
    });
  } catch (err: any) {
    console.error("Failed to create room:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Create two GameRoom instances that are tied together by one parent session id.
// The parent session is just metadata; each child GameRoom still owns its own
// board, players, scoring, collectibles, and websocket state.
app.post("/api/create-linked-session", async (_req, res) => {
  try {
    const sessionId = randomUUID().slice(0, 8).toUpperCase();
    const durationSeconds = LINKED_SESSION_DURATION_SECONDS;
    const teamA = LINKED_TEAM_CONFIGS.A;
    const teamB = LINKED_TEAM_CONFIGS.B;

    const roomA = await matchMaker.createRoom("game_room", {
      linkedSessionId: sessionId,
      linkedTeamId: teamA.teamId,
      linkedTeamLabel: teamA.teamLabel,
      allowedColors: teamA.colors,
      sharedDurationSeconds: durationSeconds,
    });

    const roomB = await matchMaker.createRoom("game_room", {
      linkedSessionId: sessionId,
      linkedTeamId: teamB.teamId,
      linkedTeamLabel: teamB.teamLabel,
      allowedColors: teamB.colors,
      sharedDurationSeconds: durationSeconds,
    });

    setLinkedRoomOpponent(sessionId, "A", roomB.roomId);
    setLinkedRoomOpponent(sessionId, "B", roomA.roomId);

    return res.json({
      success: true,
      sessionId,
      durationSeconds,
      teams: {
        A: { ...teamA, roomId: roomA.roomId, opponentRoomId: roomB.roomId },
        B: { ...teamB, roomId: roomB.roomId, opponentRoomId: roomA.roomId },
      },
    });
  } catch (err: any) {
    console.error("Failed to create linked session:", err);
    return res.status(500).json({ error: err.message });
  }
});

// Resolve a parent session code back into its two child room ids. Friends use
// this to join the same two-board match after the creator shares the code.
app.get("/api/linked-session/:sessionId", (req, res) => {
  const sessionId = String(req.params.sessionId || "").trim().toUpperCase();
  const snapshot = getLinkedSessionSnapshot(sessionId);
  if (!snapshot) {
    return res.status(404).json({ error: "Linked session not found" });
  }
  return res.json({ success: true, ...snapshot });
});

// Serve the built client (in production or when dist exists)
const clientDistPath = join(process.cwd(), "../client/dist");
app.use(express.static(clientDistPath));

const server = createServer(app);
const gameServer = new Server({
  server,
  // Increase ping interval and retries for players with high latency connections
  pingInterval: 10000,
  pingMaxRetries: 5,
});

// Register the GameRoom. New games always create a fresh room (client.create),
// and players join an existing game by its Colyseus room id (client.joinById),
// so no matchmaking filter is needed.
gameServer.define("game_room", GameRoom);

// Attach Colyseus monitor
app.use("/colyseus", monitor());

// SPA fallback — serve index.html for any non-API, non-asset route
app.get("/{*path}", (_req, res) => {
  res.sendFile(join(clientDistPath, "index.html"));
});

// (removed) On startup this previously ran a server-startup-cleanup step to mark
// stale active sessions as abandoned and clear the matchmaking queue (rooms are
// gone after a deploy/restart). The standalone build has no DB or matchmaking
// queue, so there is nothing to clean up.

// Graceful shutdown: clean up rooms on SIGTERM (sent by the host before kill)
// Each room's onDispose() will mark active sessions as abandoned in the DB.
let isShuttingDown = false;
process.on("SIGTERM", () => {
  if (isShuttingDown) return;
  isShuttingDown = true;
  console.log("SIGTERM received — starting graceful shutdown...");
  gameServer.gracefullyShutdown(true);
});

void (async () => {
  try {
    await gameServer.listen(port);
    console.log(`Colyseus server listening on port ${port}`);
    console.log(`Monitor available at: http://localhost:${port}/colyseus`);
    console.log(`Environment: ${process.env.NODE_ENV || "development"}`);
  } catch (err: unknown) {
    const code = err && typeof err === "object" && "code" in err ? (err as NodeJS.ErrnoException).code : undefined;
    if (code === "EADDRINUSE") {
      console.error(
        `\nPort ${port} is already in use (game server + HTTP API).\n` +
          `Stop the other process: Ctrl+C in its terminal, or run:\n` +
          `  lsof -i :${port}   # then kill <PID>\n` +
          `If you ran "npm run dev" twice, leave only one running.\n`
      );
    } else {
      console.error("Failed to start Colyseus server:", err);
    }
    process.exit(1);
  }
})();
