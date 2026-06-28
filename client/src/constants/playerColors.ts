/**
 * Player Color — Single Source of Truth
 * ─────────────────────────────────────────
 * The server/schema uses the canonical IDs "RED" | "GREEN" | "BLUE" as
 * opaque player identifiers (Player 1 / 2 / 3). Those tokens flow through
 * level configs, collectibles, enemy personalities, and scoring — they are
 * LOGIC, not visuals, and must not be renamed.
 *
 * This module is the ONLY place the client maps those IDs to visuals:
 *   - `label`    — human-readable name (e.g. "Ember" vs id `RED`)
 *   - `palette`  — hex shades consumed by meshes, particles, UI, floor tints
 *   - `tailwindTextClass` — class used by pure-DOM UI (e.g. ResultsOverlay)
 *   - `uiLabelHex` — optional hex for player-tinted **text** on dark chrome when
 *     `palette.main` is low-contrast (e.g. GREEN monochrome uses white on-board only).
 *
 * Palette values align with `astraea-rift` (e.g. GREEN as monochrome white
 * on the board via `floorTint`). Change colors only here.
 */

// ── Canonical IDs (matches server/schema `PlayerColor`) ─────────────────────
// Uppercase IDs are what the server sends over the network.
export type PlayerColorId = "RED" | "GREEN" | "BLUE" | "YELLOW" | "PURPLE" | "CYAN";
// Lowercase IDs are easier to use in client-only render maps and CSS-ish names.
export type PlayerColorLower = "red" | "green" | "blue" | "yellow" | "purple" | "cyan";

// This ordered list is reused by loops so the UI does not need separate hard-coded color arrays.
export const PLAYER_COLOR_IDS: readonly PlayerColorId[] = ["RED", "GREEN", "BLUE", "YELLOW", "PURPLE", "CYAN"] as const;

// ── Palette shape ────────────────────────────────────────────────────────────
export interface PlayerPalette {
  /** Primary hex — lanterns, collectibles, UI chips, drag ghost, player mesh main. */
  main: string;
  /** Mid shade — player mesh glow, particle emitter secondary. */
  glow: string;
  /** Light shade — player mesh rim, particle emitter tertiary. */
  rim: string;
  /**
   * Optional override for ParticleBrain's tri-shade emission.
   * Falls back to [main, glow, rim] when omitted.
   */
  particleShades?: readonly [string, string, string];
  /**
   * Optional override for ParticleFloor tinting.
   * When omitted, ParticleFloor uses `main`.
   */
  floorTint?: string;
  /**
   * Optional override for bridge diagonals (GameScreen).
   * Falls back to `main`.
   */
  bridge?: string;
}

export interface PlayerTheme {
  id: PlayerColorId;
  idLower: PlayerColorLower;
  /** Human-readable display name. Decoupled from `id`. */
  label: string;
  /** Tailwind text-color class used by pure-DOM UI. */
  tailwindTextClass: string;
  /**
   * Hex for player-attributed text (HUD, lobby names, voice list). Defaults to `palette.main`.
   */
  uiLabelHex?: string;
  palette: PlayerPalette;
  /**
   * Wireframe/edge-line color for meshes tinted with this player's color.
   */
  edgeColor: string;
  edgeOpacity: number;
}

// ── THE palette (visuals only; IDs unchanged) ───────────────────────────────
// `Record<PlayerColorId, PlayerTheme>` means every PlayerColorId must have a theme.
export const PLAYER_COLORS: Record<PlayerColorId, PlayerTheme> = {
  RED: {
    id: "RED",
    idLower: "red",
    label: "Orange",
    tailwindTextClass: "text-orange-500",
    palette: {
      main: "#ff8c1a",
      glow: "#ffa84d",
      rim: "#ffc585",
    },
    edgeColor: "#ffffff",
    edgeOpacity: 0.08,
  },
  GREEN: {
    id: "GREEN",
    idLower: "green",
    label: "White",
    tailwindTextClass: "text-white",
    uiLabelHex: "#ffffff",
    palette: {
      main: "#ffffff",
      glow: "#ffffff",
      rim: "#ffffff",
      floorTint: "#cccccc",
    },
    edgeColor: "#000000",
    edgeOpacity: 0.12,
  },
  BLUE: {
    id: "BLUE",
    idLower: "blue",
    label: "Blue",
    tailwindTextClass: "text-blue-500",
    palette: {
      main: "#1a73ff",
      glow: "#4d94ff",
      rim: "#8fb8ff",
    },
    edgeColor: "#ffffff",
    edgeOpacity: 0.08,
  },
  YELLOW: {
    id: "YELLOW",
    idLower: "yellow",
    label: "Yellow",
    tailwindTextClass: "text-yellow-300",
    palette: {
      main: "#ffd21a",
      glow: "#ffe66d",
      rim: "#fff2a8",
    },
    edgeColor: "#000000",
    edgeOpacity: 0.12,
  },
  PURPLE: {
    id: "PURPLE",
    idLower: "purple",
    label: "Purple",
    tailwindTextClass: "text-purple-400",
    palette: {
      main: "#a855f7",
      glow: "#c084fc",
      rim: "#e9d5ff",
    },
    edgeColor: "#ffffff",
    edgeOpacity: 0.08,
  },
  CYAN: {
    id: "CYAN",
    idLower: "cyan",
    label: "Cyan",
    tailwindTextClass: "text-cyan-300",
    palette: {
      main: "#22d3ee",
      glow: "#67e8f9",
      rim: "#a5f3fc",
    },
    edgeColor: "#ffffff",
    edgeOpacity: 0.08,
  },
};

// ── Helpers ─────────────────────────────────────────────────────────────────-

export function getPlayerHex(id: PlayerColorId): string {
  return PLAYER_COLORS[id].palette.main;
}

/** Text / labels on dark HUD — uses `uiLabelHex` when set (GREEN), else `palette.main`. */
export function getPlayerUiLabelHex(id: PlayerColorId): string {
  const t = PLAYER_COLORS[id];
  return t.uiLabelHex ?? t.palette.main;
}

export function getPlayerPalette(id: PlayerColorId): PlayerPalette {
  return PLAYER_COLORS[id].palette;
}

export function getParticleShades(id: PlayerColorId): readonly [string, string, string] {
  const p = PLAYER_COLORS[id].palette;
  return p.particleShades ?? [p.main, p.glow, p.rim];
}

export function getFloorTint(id: PlayerColorId): string {
  const p = PLAYER_COLORS[id].palette;
  return p.floorTint ?? p.main;
}

export function getBridgeHex(id: PlayerColorId): string {
  const p = PLAYER_COLORS[id].palette;
  return p.bridge ?? p.main;
}

export function toLowerId(id: PlayerColorId): PlayerColorLower {
  return PLAYER_COLORS[id].idLower;
}

export function toUpperId(lower: PlayerColorLower): PlayerColorId {
  // The input type guarantees `lower` is one of our known lowercase IDs.
  return lower.toUpperCase() as PlayerColorId;
}

export function getPlayerTailwindTextClass(id: PlayerColorId): string {
  return PLAYER_COLORS[id].tailwindTextClass;
}

export function getPlayerEdgeColor(id: PlayerColorId): string {
  return PLAYER_COLORS[id].edgeColor;
}

export function getPlayerEdgeOpacity(id: PlayerColorId): number {
  return PLAYER_COLORS[id].edgeOpacity;
}

// Quick lookup for "what hex color should this player ID use?"
export const PLAYER_HEX: Record<PlayerColorId, string> = {
  RED: PLAYER_COLORS.RED.palette.main,
  GREEN: PLAYER_COLORS.GREEN.palette.main,
  BLUE: PLAYER_COLORS.BLUE.palette.main,
  YELLOW: PLAYER_COLORS.YELLOW.palette.main,
  PURPLE: PLAYER_COLORS.PURPLE.palette.main,
  CYAN: PLAYER_COLORS.CYAN.palette.main,
};

// Same color lookup as PLAYER_HEX, keyed by lowercase IDs for renderer code.
export const PLAYER_HEX_LOWER: Record<PlayerColorLower, string> = {
  red: PLAYER_COLORS.RED.palette.main,
  green: PLAYER_COLORS.GREEN.palette.main,
  blue: PLAYER_COLORS.BLUE.palette.main,
  yellow: PLAYER_COLORS.YELLOW.palette.main,
  purple: PLAYER_COLORS.PURPLE.palette.main,
  cyan: PLAYER_COLORS.CYAN.palette.main,
};

// Labels shown in UI instead of raw server IDs.
export const PLAYER_COLOR_LABEL: Record<PlayerColorId, string> = {
  RED: PLAYER_COLORS.RED.label,
  GREEN: PLAYER_COLORS.GREEN.label,
  BLUE: PLAYER_COLORS.BLUE.label,
  YELLOW: PLAYER_COLORS.YELLOW.label,
  PURPLE: PLAYER_COLORS.PURPLE.label,
  CYAN: PLAYER_COLORS.CYAN.label,
};

/** UI copy for a server player id (`GREEN` → theme label, e.g. "Monochrome"). */
export function getPlayerDisplayLabel(color: string): string {
  // `color` may be any server string, so check the lookup before casting it.
  if (color in PLAYER_COLOR_LABEL) {
    return PLAYER_COLOR_LABEL[color as PlayerColorId];
  }
  return color;
}
