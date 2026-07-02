import type { GameRoom } from "./GameRoom";
import type { PlayerColor } from "../schema/GameState";

export type LinkedTeamId = "A" | "B";

export interface LinkedTeamConfig {
  teamId: LinkedTeamId;
  teamLabel: string;
  colors: PlayerColor[];
}

export interface LinkedTeamSnapshot extends LinkedTeamConfig {
  roomId: string;
  opponentRoomId: string;
  ready: boolean;
}

export interface LinkedSessionSnapshot {
  sessionId: string;
  durationSeconds: number;
  started: boolean;
  teams: Record<LinkedTeamId, LinkedTeamSnapshot | null>;
}

interface LinkedRoomRecord extends LinkedTeamConfig {
  roomId: string;
  opponentRoomId: string;
  ready: boolean;
  room?: GameRoom;
}

interface LinkedSessionRecord {
  sessionId: string;
  durationSeconds: number;
  started: boolean;
  teams: Partial<Record<LinkedTeamId, LinkedRoomRecord>>;
}

export const LINKED_SESSION_DURATION_SECONDS = 5 * 60;

export const LINKED_TEAM_CONFIGS: Record<LinkedTeamId, LinkedTeamConfig> = {
  A: {
    teamId: "A",
    teamLabel: "Team A",
    colors: ["RED", "GREEN", "BLUE"],
  },
  B: {
    teamId: "B",
    teamLabel: "Team B",
    colors: ["YELLOW", "PURPLE", "CYAN"],
  },
};

const linkedSessions = new Map<string, LinkedSessionRecord>();

function getOrCreateLinkedSession(sessionId: string, durationSeconds: number): LinkedSessionRecord {
  let record = linkedSessions.get(sessionId);
  if (!record) {
    // The parent session is intentionally tiny: it only remembers which two
    // GameRooms belong together, so the boards can stay independent.
    record = {
      sessionId,
      durationSeconds,
      started: false,
      teams: {},
    };
    linkedSessions.set(sessionId, record);
  }
  return record;
}

function toSnapshot(record: LinkedSessionRecord): LinkedSessionSnapshot {
  const teamSnapshot = (teamId: LinkedTeamId): LinkedTeamSnapshot | null => {
    const team = record.teams[teamId];
    if (!team) return null;
    return {
      teamId: team.teamId,
      teamLabel: team.teamLabel,
      colors: team.colors,
      roomId: team.roomId,
      opponentRoomId: team.opponentRoomId,
      ready: team.ready,
    };
  };

  return {
    sessionId: record.sessionId,
    durationSeconds: record.durationSeconds,
    started: record.started,
    teams: {
      A: teamSnapshot("A"),
      B: teamSnapshot("B"),
    },
  };
}

function tryStartLinkedSession(record: LinkedSessionRecord) {
  if (record.started) return;

  const teamA = record.teams.A;
  const teamB = record.teams.B;
  if (!teamA?.ready || !teamB?.ready || !teamA.room || !teamB.room) return;

  record.started = true;
  // Both rooms receive the same countdown target. This keeps the visible
  // countdown and the five-minute game timer aligned across both boards.
  const gameplayStartsAtMs = Date.now() + 10_000;
  teamA.room.startLinkedSession(gameplayStartsAtMs);
  teamB.room.startLinkedSession(gameplayStartsAtMs);
}

export function registerLinkedRoom(args: {
  sessionId: string;
  durationSeconds: number;
  teamId: LinkedTeamId;
  teamLabel: string;
  colors: PlayerColor[];
  roomId: string;
  room: GameRoom;
}) {
  const record = getOrCreateLinkedSession(args.sessionId, args.durationSeconds);
  record.durationSeconds = args.durationSeconds;
  record.teams[args.teamId] = {
    teamId: args.teamId,
    teamLabel: args.teamLabel,
    colors: args.colors,
    roomId: args.roomId,
    opponentRoomId: record.teams[args.teamId]?.opponentRoomId ?? "",
    ready: record.teams[args.teamId]?.ready ?? false,
    room: args.room,
  };
  tryStartLinkedSession(record);
}

export function setLinkedRoomOpponent(sessionId: string, teamId: LinkedTeamId, opponentRoomId: string) {
  const record = linkedSessions.get(sessionId);
  const team = record?.teams[teamId];
  if (!record || !team) return;

  // The opponent id is metadata only. Clients use it to know which second
  // room to join as a spectator; no gameplay messages are routed through it.
  team.opponentRoomId = opponentRoomId;
  team.room?.setLinkedOpponentRoomId(opponentRoomId);
}

export function markLinkedRoomReady(sessionId: string, teamId: LinkedTeamId) {
  const record = linkedSessions.get(sessionId);
  const team = record?.teams[teamId];
  if (!record || !team) return;

  // "Ready" means this team's GameRoom has all of its three color slots filled.
  // The coordinator waits for both teams before starting either board.
  team.ready = true;
  tryStartLinkedSession(record);
}

export function unregisterLinkedRoom(sessionId: string, teamId: LinkedTeamId, room: GameRoom) {
  const record = linkedSessions.get(sessionId);
  const team = record?.teams[teamId];
  if (!record || !team || team.room !== room) return;

  delete record.teams[teamId];
  if (!record.teams.A && !record.teams.B) {
    linkedSessions.delete(sessionId);
  }
}

export function getLinkedSessionSnapshot(sessionId: string): LinkedSessionSnapshot | null {
  const record = linkedSessions.get(sessionId);
  return record ? toSnapshot(record) : null;
}
