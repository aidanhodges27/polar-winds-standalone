import { BaseCollectible, CollectibleScoreContext, SpawnValidationContext } from "./BaseCollectible";
import { Collectible, PlayerColor } from "../schema/GameState";
import { MapSchema } from "@colyseus/schema";
import { GridCell } from "../schema/GameState";

/**
 * Polyomino Collectible
 *
 * Each player color has a specific polyomino shape assigned to them.
 * The collectible is activated when it sits on a grid region that matches
 * the polyomino shape in the player's color.
 *
 * Activation rules:
 * - The collectible position must be containable within the polyomino shape
 * - All cells of the shape must be filled with the matching color
 * - The shape can be rotated or reflected (all 8 isometries are checked)
 *
 * Scores 10 points when activated, 14 points when gold.
 */

// Define polyomino shapes as arrays of [x, y] offsets from origin
// Each shape is associated with a player color
type PolyominoShape = Array<[number, number]>;

// Shape definitions based on the provided images.
// Because this is `Record<PlayerColor, ...>`, TypeScript requires one shape for every playable color.
const POLYOMINO_SHAPES: Record<PlayerColor, PolyominoShape> = {
  // RED: 2x4 rectangle (8 cells)
  // Shape:
  // ##
  // ##
  // ##
  // ##
  RED: [
    [0, 0], [1, 0],
    [0, 1], [1, 1],
    [0, 2], [1, 2],
    [0, 3], [1, 3]
  ],

  // GREEN: Diagonal stair pattern (7 cells) - rotated 90° clockwise
  // Shape:
  //   ##
  //  ##
  // ##
  // #
  GREEN: [
    [2, 0], [3, 0],
    [1, 1], [2, 1],
    [0, 2], [1, 2],
    [0, 3]
  ],

  // BLUE: L-shaped stair pattern (7 cells)
  // Shape:
  //   ##
  //  ###
  //  ##
  BLUE: [
    [1, 0], [2, 0],
    [0, 1], [1, 1], [2, 1],
    [0, 2], [1, 2]
  ],

  // YELLOW: Plus pattern (5 cells)
  YELLOW: [
    [1, 0],
    [0, 1], [1, 1], [2, 1],
    [1, 2]
  ],

  // PURPLE: T-shaped pattern (7 cells)
  PURPLE: [
    [0, 0], [1, 0], [2, 0],
    [1, 1],
    [1, 2],
    [1, 3],
    [1, 4]
  ],

  // CYAN: Zigzag pattern (7 cells)
  CYAN: [
    [0, 0], [1, 0],
    [1, 1], [2, 1],
    [2, 2], [3, 2],
    [3, 3]
  ]
};

export class PolyominoCollectible extends BaseCollectible {
  private readonly SCORE = 10;
  private readonly GOLD_SCORE = 14;

  /**
   * Generate all 8 isometries (4 rotations x 2 reflections) of a shape
   */
  private getAllIsometries(shape: PolyominoShape): PolyominoShape[] {
    const isometries: PolyominoShape[] = [];

    // Start with original and its reflection
    let current = shape;
    let reflected = this.reflectShape(shape);

    for (let rotation = 0; rotation < 4; rotation++) {
      // Add current rotation of original
      isometries.push(this.normalizeShape(current));
      // Add current rotation of reflected
      isometries.push(this.normalizeShape(reflected));

      // Rotate for next iteration
      current = this.rotateShape90(current);
      reflected = this.rotateShape90(reflected);
    }

    // Remove duplicates (some shapes have symmetries)
    return this.removeDuplicateShapes(isometries);
  }

  /**
   * Rotate shape 90 degrees clockwise: (x, y) -> (y, -x)
   */
  private rotateShape90(shape: PolyominoShape): PolyominoShape {
    return shape.map(([x, y]) => [y, -x]);
  }

  /**
   * Reflect shape across y-axis: (x, y) -> (-x, y)
   */
  private reflectShape(shape: PolyominoShape): PolyominoShape {
    return shape.map(([x, y]) => [-x, y]);
  }

  /**
   * Normalize shape so minimum x and y are both 0
   */
  private normalizeShape(shape: PolyominoShape): PolyominoShape {
    const minX = Math.min(...shape.map(([x]) => x));
    const minY = Math.min(...shape.map(([, y]) => y));
    return shape.map(([x, y]) => [x - minX, y - minY]);
  }

  /**
   * Remove duplicate shapes (shapes with same set of coordinates)
   */
  private removeDuplicateShapes(shapes: PolyominoShape[]): PolyominoShape[] {
    const seen = new Set<string>();
    const unique: PolyominoShape[] = [];

    for (const shape of shapes) {
      // Sort coordinates to create canonical representation
      const sorted = [...shape].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      const key = JSON.stringify(sorted);

      if (!seen.has(key)) {
        seen.add(key);
        unique.push(shape);
      }
    }

    return unique;
  }

  /**
   * Check if a polyomino shape placed at a given offset contains the collectible position
   * and all shape cells have the required color
   */
  private checkShapeAtOffset(
    shape: PolyominoShape,
    offsetX: number,
    offsetY: number,
    collectibleX: number,
    collectibleY: number,
    requiredColor: PlayerColor,
    gridColors: MapSchema<GridCell>
  ): boolean {
    // Convert collectible position to integer grid coordinates
    const clueGridX = Math.floor(collectibleX);
    const clueGridY = Math.floor(collectibleY);

    // Check if clue position is within the shape
    const clueInShape = shape.some(
      ([sx, sy]) => offsetX + sx === clueGridX && offsetY + sy === clueGridY
    );
    if (!clueInShape) {
      return false;
    }

    // Check all shape cells have the required color
    for (const [sx, sy] of shape) {
      const gridX = offsetX + sx;
      const gridY = offsetY + sy;
      const key = `${gridX},${gridY}`;
      const cell = gridColors.get(key);

      if (!cell || cell.color !== requiredColor) {
        return false;
      }
    }

    return true;
  }

  /**
   * Check if the collectible is activated (contained in matching polyomino shape)
   */
  isActivated(context: CollectibleScoreContext): boolean {
    const { collectible, gridColors, color } = context;

    // Get the shape for this color
    const baseShape = POLYOMINO_SHAPES[color];
    if (!baseShape) {
      return false;
    }

    // Get all isometries of the shape
    const isometries = this.getAllIsometries(baseShape);

    // For each isometry, try all possible offsets where the shape could contain the clue
    for (const shape of isometries) {
      // Calculate bounding box of the shape
      const maxX = Math.max(...shape.map(([x]) => x));
      const maxY = Math.max(...shape.map(([, y]) => y));

      // The collectible grid position
      const clueGridX = Math.floor(collectible.x);
      const clueGridY = Math.floor(collectible.y);

      // Try all offsets where the clue could be within the shape
      // The shape's cells span from offset to offset + max, so:
      // offset <= clueGrid <= offset + max
      // Therefore: clueGrid - max <= offset <= clueGrid
      for (let offsetX = clueGridX - maxX; offsetX <= clueGridX; offsetX++) {
        for (let offsetY = clueGridY - maxY; offsetY <= clueGridY; offsetY++) {
          if (this.checkShapeAtOffset(
            shape,
            offsetX,
            offsetY,
            collectible.x,
            collectible.y,
            color,
            gridColors
          )) {
            return true;
          }
        }
      }
    }

    return false;
  }

  /**
   * Gold condition: the connected component containing the collectible
   * matches the polyomino shape exactly (no extra cells).
   */
  isGold(context: CollectibleScoreContext): boolean {
    if (!this.isActivated(context)) {
      return false;
    }

    const { collectible, color, components } = context;
    const clueGridX = Math.floor(collectible.x);
    const clueGridY = Math.floor(collectible.y);

    // Find the connected component containing the collectible
    const component = components.find(comp =>
      comp.some(cell => cell.x === clueGridX && cell.y === clueGridY)
    );
    if (!component) {
      return false;
    }

    const baseShape = POLYOMINO_SHAPES[color];
    if (!baseShape) {
      return false;
    }

    // Component must have the same number of cells as the shape
    if (component.length !== baseShape.length) {
      return false;
    }

    // Normalize the component cells the same way we normalize shapes
    const compMinX = Math.min(...component.map(c => c.x));
    const compMinY = Math.min(...component.map(c => c.y));
    const normalizedComp = component
      .map(c => [c.x - compMinX, c.y - compMinY] as [number, number])
      .sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const compKey = JSON.stringify(normalizedComp);

    // Check if the component matches any isometry of the shape
    const isometries = this.getAllIsometries(baseShape);
    for (const shape of isometries) {
      const sorted = [...shape].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
      if (JSON.stringify(sorted) === compKey) {
        return true;
      }
    }

    return false;
  }

  calculateScore(context: CollectibleScoreContext): number {
    if (!this.isActivated(context)) {
      return 0;
    }
    if (this.isGold(context)) {
      return this.GOLD_SCORE;
    }
    return this.SCORE;
  }

  isValidSpawnPosition(context: SpawnValidationContext): boolean {
    const { x, y, minBound, maxBound, existingCollectibles } = context;

    // Polyomino spawns at integer positions (on nodes)
    const gridX = Math.floor(x);
    const gridY = Math.floor(y);

    // Must be within bounds
    if (gridX < minBound || gridX > maxBound) {
      return false;
    }
    if (gridY < minBound || gridY > maxBound) {
      return false;
    }

    // Check no other polyomino collectible is at the same position
    for (const other of existingCollectibles) {
      if (other.type === "polyomino" && other.x === x && other.y === y) {
        return false;
      }
    }

    return true;
  }

  /**
   * Get the shape for a given color (useful for rendering)
   */
  static getShapeForColor(color: PlayerColor): PolyominoShape {
    return POLYOMINO_SHAPES[color];
  }
}
