import { BaseCollectible, CollectibleScoreContext, SpawnValidationContext } from "./BaseCollectible";

export class EquilibriumCollectible extends BaseCollectible {
  private readonly REQUIRED_COUNT = 3;
  private readonly baseScore = 20;
  private readonly goldScore = 40;

  calculateScore(context: CollectibleScoreContext): number {
    if (!this.isActivated(context)) return 0;
    return this.isGold(context) ? this.goldScore : this.baseScore;
  }

  isActivated(context: CollectibleScoreContext): boolean {
    const { collectible, gridColors } = context;
    const { x, y } = collectible;

    // Count nodes of each player color in the 3x3 grid surrounding the collectible
    const counts: Record<string, number> = {
      RED: 0,
      GREEN: 0,
      BLUE: 0,
    };

    // Counts the colors surrounding the collectible in a 3x3 area, starting from the upper-left corner.
    // dx represents the starting x search position relative to the center.
    // dy represents the starting y position relative to the center.
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const cellKey = `${x + dx},${y + dy}`;
        const cell = gridColors.get(cellKey);
        if (cell && cell.color) {
          counts[cell.color]++;
        }
      }
    }

    // Activated when there are exactly 3 nodes of each player
    return (
      counts.RED === this.REQUIRED_COUNT &&
      counts.GREEN === this.REQUIRED_COUNT &&
      counts.BLUE === this.REQUIRED_COUNT
    );
  }

  isGold(context: CollectibleScoreContext): boolean {
    const activated = this.isActivated(context);
    const { collectible, gridColors } = context;
    const { x, y } = collectible;

    if (!activated) {
      return false;
    }

    // Gold if the middle node is a singleton (no orthogonal neighbor shares its color)
    const centerKey = `${x},${y}`;
    const centerCell = gridColors.get(centerKey);
    const centerColor = centerCell?.color;

    if (!centerColor) {
      return false;
    }

    const neighbors = [
      { dx: -1, dy: 0 },
      { dx: 1, dy: 0 },
      { dx: 0, dy: -1 },
      { dx: 0, dy: 1 },
    ];

    for (const { dx, dy } of neighbors) {
      const neighborKey = `${x + dx},${y + dy}`;
      const neighborCell = gridColors.get(neighborKey);
      if (neighborCell?.color === centerColor) {
        console.log(`Equilibrium at (${x},${y}): NOT gold - center ${centerColor} has same-color neighbor at ${neighborKey}`);
        return false;
      }
    }

    console.log(`Equilibrium at (${x},${y}): IS GOLD - center node is a singleton`);
    return true;
  }

  isValidSpawnPosition(context: SpawnValidationContext): boolean {
    const { x, y, minBound, maxBound } = context;
    // Equilibrium clues cannot be on edges - need 1 cell margin for the 3x3 check
    return x > minBound && x < maxBound && y > minBound && y < maxBound;
  }
}
