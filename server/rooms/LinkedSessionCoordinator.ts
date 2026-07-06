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
  // Holds the current shared abandon vote for this two-room match, if one is active.
  abandonVote?: LinkedAbandonVoteState;
}

interface LinkedAbandonVoteState {
  // Stores one vote per player color so a reconnecting player cannot vote twice with a new socket id.
  voterColors: Set<PlayerColor>;
  // Remembers who started the vote so both teams can show the same initiator in the HUD.
  initiatorColor: PlayerColor;
  // Stores the exact expiration time so every client can show the same countdown.
  expiresAt: number;
  // Keeps the timeout handle so the vote can be cancelled when it passes or the session closes.
  timer: ReturnType<typeof setTimeout> | null;
}

type LinkedAbandonVoteMessageType =
  | "abandonGameVoteStarted"
  | "abandonGameVoteUpdate"
  | "abandonGameVoteExpired";

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

// This ordered list lets helper functions visit both Team A and Team B without duplicating code.
const LINKED_TEAM_IDS: LinkedTeamId[] = ["A", "B"];

function getLinkedRooms(record: LinkedSessionRecord): GameRoom[] {
  // Collect only child GameRooms that are currently registered with this linked session.
  return LINKED_TEAM_IDS
    // Look up each team's room record from the parent linked-session record.
    .map((teamId) => record.teams[teamId]?.room)
    // Remove missing rooms while teaching TypeScript that the remaining values are real GameRoom objects.
    .filter((room): room is GameRoom => Boolean(room));
}

function getLinkedAbandonRequiredVotes(record: LinkedSessionRecord): number {
  // Sum both teams so linked abandon votes require the whole six-player match, not only one board.
  return LINKED_TEAM_IDS.reduce((total, teamId) => {
    // Read the registered team record when that child room exists.
    const team = record.teams[teamId];
    // Prefer the room's live player-slot count so local room rules stay in one place.
    const roomVotes = team?.room?.getAbandonGameRequiredVotes();
    // Fall back to the team's color count when the room object is temporarily unavailable.
    const expectedVotes = team?.colors.length ?? LINKED_TEAM_CONFIGS[teamId].colors.length;
    // Add this team's required votes to the running linked-session total.
    return total + (roomVotes ?? expectedVotes);
  }, 0);
}

function broadcastLinkedAbandonVote(record: LinkedSessionRecord, type: LinkedAbandonVoteMessageType, payload: Record<string, unknown>) {
  // Send the same vote message into both child GameRooms so both teams are notified together.
  for (const room of getLinkedRooms(record)) {
    // Ask each room to broadcast through its own Colyseus clients.
    room.broadcastLinkedAbandonGameVote(type, payload);
  }
}

function clearLinkedAbandonVote(record: LinkedSessionRecord) {
  // Stop the timeout if this vote still has one running.
  if (record.abandonVote?.timer) {
    // Clearing the timeout prevents an already-passed vote from later expiring.
    clearTimeout(record.abandonVote.timer);
  }
  // Remove the vote state so a future abandon request can start a clean vote.
  record.abandonVote = undefined;
}

function expireLinkedAbandonGameVote(sessionId: string) {
  // Look up the parent linked session for the vote timer that just fired.
  const record = linkedSessions.get(sessionId);
  // If the session or vote is already gone, there is nothing left to expire.
  if (!record?.abandonVote) return;

  // Remove the expired vote before broadcasting so any next vote starts fresh.
  clearLinkedAbandonVote(record);
  // Tell both teams that the shared abandon vote failed because it did not reach six votes in time.
  broadcastLinkedAbandonVote(record, "abandonGameVoteExpired", {});
  // Keep the server log readable when a linked abandon vote times out.
  console.log(`Linked session ${sessionId}: abandon game vote expired - not enough votes`);
}

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

export function submitLinkedAbandonGameVote(args: {
  // The parent linked-session id.
  sessionId: string;
  // The team id identifies the child GameRoom.
  teamId: LinkedTeamId;
  // The player color identifies the voter across the whole six-player linked match.
  voterColor: PlayerColor;
}) {
  // Find the parent linked session that owns the shared vote.
  const record = linkedSessions.get(args.sessionId);
  // Ignore stale votes if the parent linked session no longer exists.
  if (!record) return;

  // Find the team record that received this vote.
  const team = record.teams[args.teamId];
  // Ignore stale votes if this team's child room is not registered.
  if (!team?.room) return;

  // Start a new shared vote if this is the first abandon request in the current window.
  if (!record.abandonVote) {
    const voteWindowMs = team.room.getAbandonGameVoteWindowMs();
    // Create the shared vote state that both rooms will read from until it passes or expires.
    record.abandonVote = {
      voterColors: new Set<PlayerColor>(),
      initiatorColor: args.voterColor,
      expiresAt: Date.now() + voteWindowMs,
      // Fill this in immediately after creation so it can call the expiry helper later.
      timer: null,
    };
    // Schedule the shared vote to expire if all six players do not agree in time.
    record.abandonVote.timer = setTimeout(() => expireLinkedAbandonGameVote(args.sessionId), voteWindowMs);
  }

  // Read the active shared vote after the possible creation above.
  const vote = record.abandonVote;
  // Protect TypeScript and runtime behavior in case vote creation failed for an unexpected reason.
  if (!vote) return;
  // Stop duplicate votes from the same color while keeping the existing vote visible to everyone.
  if (vote.voterColors.has(args.voterColor)) return;

  // Add this player color to the linked-session-wide vote set.
  vote.voterColors.add(args.voterColor);
  // Team Match abandon needs all six players to agree.
  const requiredVotes = getLinkedAbandonRequiredVotes(record);
  // Count the unique player colors that have voted so far.
  const voteCount = vote.voterColors.size;

  // If this is the first vote, notify both rooms that the shared abandon vote has started.
  if (voteCount === 1) {
    broadcastLinkedAbandonVote(record, "abandonGameVoteStarted", {
      initiatorColor: vote.initiatorColor,
      expiresAt: vote.expiresAt,
      voteCount,
      // Include the six-player requirement so clients can display 1/6, 2/6, and so on.
      requiredVotes,
    });
  }

  // Tell both rooms about the latest vote count after every accepted vote.
  broadcastLinkedAbandonVote(record, "abandonGameVoteUpdate", {
    // Tell clients which player color just voted.
    voterColor: args.voterColor,
    // Tell clients how many unique linked-session players have voted.
    voteCount,
    // Tell clients how many total votes are required for the whole linked match.
    requiredVotes,
  });

  // Once all six linked players have voted, abandon both child GameRooms together.
  if (voteCount >= requiredVotes) {
    // Capture the child rooms before clearing state so the async abandon work has stable targets.
    const roomsToAbandon = getLinkedRooms(record);
    // Clear the shared vote so the expiry timer cannot fire after the vote has passed.
    clearLinkedAbandonVote(record);
    // Keep the server log clear about why both child rooms are ending.
    console.log(`Linked session ${args.sessionId}: game abandoned by all ${voteCount} players`);
    // Run the normal abandon cleanup in both child rooms without blocking the message handler.
    void Promise.all(roomsToAbandon.map((room) => room.executeLinkedSessionAbandonGame())).catch((err) => {
      console.error(`Linked session ${args.sessionId}: failed to abandon both rooms`, err);
    });
  }
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
    // Clear any shared abandon vote timer before deleting the parent linked session.
    clearLinkedAbandonVote(record);
    // Delete the parent linked session after both child rooms have gone away.
    linkedSessions.delete(sessionId);
  }
}

export function getLinkedSessionSnapshot(sessionId: string): LinkedSessionSnapshot | null {
  const record = linkedSessions.get(sessionId);
  return record ? toSnapshot(record) : null;
}
