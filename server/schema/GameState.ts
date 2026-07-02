import { Schema, type, MapSchema, ArraySchema } from "@colyseus/schema";

// `as const` keeps these as exact string values, not just a generic `string[]`.
// That lets TypeScript build a safe union type from this single source of truth.
export const PLAYER_COLORS = ["RED", "GREEN", "BLUE", "YELLOW", "PURPLE", "CYAN"] as const;
// This becomes: "RED" | "GREEN" | "BLUE" | "YELLOW" | "PURPLE" | "CYAN".
export type PlayerColor = typeof PLAYER_COLORS[number];

export class Player extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") color: PlayerColor = "RED";
  @type("string") sessionId: string = "";
  @type("string") name: string = "";
  @type("string") school: string = "";
  @type("string") discordName: string = "";
}

export type CollectibleType = "network" | "box" | "equilibrium" | "clone" | "vantage" | "galaxy" | "polyomino";

export type CollectibleColor = PlayerColor | "NEUTRAL";

export type CollectibleOrientation = 0 | 90 | 180 | 270;

export class Collectible extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") color: CollectibleColor = "RED";
  @type("string") id: string = "";
  @type("string") type: CollectibleType = "network";
  @type("boolean") isActivated: boolean = false;
  @type("boolean") isGold: boolean = false;
  @type("number") orientation: CollectibleOrientation = 0;
  @type("boolean") isFlipped: boolean = false;
  @type("string") shapeData: string = ""; // JSON string for polyomino shapes from level spec
  @type("number") score: number = 0;
}

export type EnemyPersonality = "red-avoiding" | "green-avoiding" | "blue-avoiding" | "same-color-avoiding" | "prismatic";

export class Enemy extends Schema {
  @type("number") x: number = 0;
  @type("number") y: number = 0;
  @type("string") id: string = "";
  @type("string") personality: EnemyPersonality = "red-avoiding";
}

export class GridCell extends Schema {
  @type("string") color: PlayerColor | undefined;
}

export class GameState extends Schema {
  // Linked-session fields are empty for normal games. When two GameRooms are
  // paired together, clients use these labels to show which board belongs to
  // Team A or Team B without changing any board/scoring data.
  @type("string") linkedSessionId: string = "";

  @type("string") linkedTeamId: string = "";

  @type("string") linkedTeamLabel: string = "";

  @type("string") linkedOpponentRoomId: string = "";

  @type("number") gameDurationSeconds: number = 30 * 60;

  @type("number") gridWidth: number = 10;
  @type("number") gridHeight: number = 8;

  @type({ map: Player }) players = new MapSchema<Player>();

  @type({ map: GridCell }) gridColors = new MapSchema<GridCell>();

  @type([Collectible]) collectibles = new ArraySchema<Collectible>();

  @type([Enemy]) enemies = new ArraySchema<Enemy>();

  @type({ map: "number" }) scores = new MapSchema<number>();

  @type("number") totalScore: number = 0;

  @type("number") highScore: number = 0;

  @type("boolean") gameStarted: boolean = false;

  @type("number") countdown: number = 0;

  @type("boolean") isGameOver: boolean = false;

  @type("number") timeRemaining: number = 30 * 60; // 30 minutes in seconds

  @type("number") stage: number = 1;

  @type(["number"]) stageThresholds = new ArraySchema<number>();

  @type("number") seed: number = 0;
}
