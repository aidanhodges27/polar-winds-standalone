import { BaseCollectible, CollectibleScoreContext, SpawnValidationContext } from "./BaseCollectible";

export class NetworkCollectible extends BaseCollectible {
  private readonly goldBonus = 5;
  private readonly baseScore = 1;

  protected getSpawnEdgeConstraints(): { minEdge: number; maxEdge: number } {
    return { minEdge: 1, maxEdge: 4 };
  }

  isValidSpawnPosition(context: SpawnValidationContext): boolean {
    const { x, y, minBound, maxBound, color, existingCollectibles, gridMinX, gridMaxX, gridMinY, gridMaxY } = context;

    // Check if position is within bounds
    if (x < minBound || x > maxBound || y < minBound || y > maxBound) {
      return false;
    }

    // Check if this position is on the outermost edge (edge 1)
    // Use rectangular grid bounds when available, fall back to square bounds
    const mX = gridMinX ?? minBound;
    const MX = gridMaxX ?? maxBound;
    const mY = gridMinY ?? minBound;
    const MY = gridMaxY ?? maxBound;
    const isOnOuterEdge = x === mX || x === MX || y === mY || y === MY;

    if (isOnOuterEdge) {
      // Only 1 network collectible of each color allowed on the outermost edge
      let edgeCount = 0;
      for (const collectible of existingCollectibles) {
        if (collectible.type === "network" && collectible.color === color) {
          const isCollectibleOnOuterEdge =
            collectible.x === mX || collectible.x === MX ||
            collectible.y === mY || collectible.y === MY;
          if (isCollectibleOnOuterEdge) {
            edgeCount++;
          }
        }
      }

      if (edgeCount >= 1) {
        return false;
      }
    }

    return true;
  }

  calculateScore(context: CollectibleScoreContext): number {
    const { collectible, gridColors, allCollectibles, color, components } = context;

    // Find which component this collectible belongs to (if any)
    let myComponent: Array<{ x: number; y: number }> | null = null;

    // Check if the collectible position has a painted tile of this color
    const cellKey = `${collectible.x},${collectible.y}`;
    const cell = gridColors.get(cellKey);
    if (!cell || cell.color !== color) {
      return 0; // Not claimed by this color
    }

    // Find the component this collectible is in
    for (const component of components) {
      if (component.some((c) => c.x === collectible.x && c.y === collectible.y)) {
        myComponent = component;
        break;
      }
    }

    if (!myComponent) {
      return 0; // Not in any component
    }

    // Find all network collectibles of this color in the same component
    const componentSet = new Set(myComponent.map((c) => `${c.x},${c.y}`));
    const networksInComponent = allCollectibles.filter((c) => {
      if (c.color !== color || c.type !== "network") return false;
      const cKey = `${c.x},${c.y}`;
      const cCell = gridColors.get(cKey);
      if (!cCell || cCell.color !== color) return false;
      return componentSet.has(cKey);
    });

    let cluesInNetwork = networksInComponent.length;
    if (cluesInNetwork < 2) return 0;

    if (this.checkCluesAtEndpoints(myComponent, componentSet, networksInComponent)) {
      cluesInNetwork += this.goldBonus;
    }

    return (cluesInNetwork - 1) * this.baseScore;
  }

  isActivated(context: CollectibleScoreContext): boolean {
    const { collectible, gridColors, allCollectibles, color, components } = context;

    // Check if the collectible position has a painted tile of this color
    const cellKey = `${collectible.x},${collectible.y}`;
    const cell = gridColors.get(cellKey);
    if (!cell || cell.color !== color) {
      return false;
    }

    // Find the component this collectible is in
    let myComponent: Array<{ x: number; y: number }> | null = null;
    for (const component of components) {
      if (component.some((c) => c.x === collectible.x && c.y === collectible.y)) {
        myComponent = component;
        break;
      }
    }

    if (!myComponent) {
      return false;
    }

    // Find all network collectibles of this color in the same component
    const networksInComponent = allCollectibles.filter((c) => {
      if (c.color !== color || c.type !== "network") return false;

      // Check if claimed
      const cKey = `${c.x},${c.y}`;
      const cCell = gridColors.get(cKey);
      if (!cCell || cCell.color !== color) return false;

      // Check if in this component
      return myComponent!.some((comp) => comp.x === c.x && comp.y === c.y);
    });

    // Activated if there are at least 2 networks in the component
    return networksInComponent.length >= 2;
  }

  // The only new condition to gold a network collectible is that the endpoints of a network must be a network collectible.
  // In other words, you cannot have a network collectible in the middle of a network, the collectible must be at the ends.
  isGold(context: CollectibleScoreContext): boolean {
    if (!this.isActivated(context)) return false;

    const { collectible, gridColors, allCollectibles, color, components } = context;

    let myComponent: Array<{ x: number; y: number }> | null = null;
    for (const component of components) {
      if (component.some((c) => c.x === collectible.x && c.y === collectible.y)) {
        myComponent = component;
        break;
      }
    }
    if (!myComponent) return false;

    const componentSet = new Set(myComponent.map((c) => `${c.x},${c.y}`));
    const networksInComponent = allCollectibles.filter((c) => {
      if (c.color !== color || c.type !== "network") return false;
      const cKey = `${c.x},${c.y}`;
      const cCell = gridColors.get(cKey);
      if (!cCell || cCell.color !== color) return false;
      return componentSet.has(cKey);
    });

    return this.checkCluesAtEndpoints(myComponent, componentSet, networksInComponent);
  }

  private checkCluesAtEndpoints(
    component: Array<{ x: number; y: number }>,
    componentSet: Set<string>,
    networksInComponent: Array<{ x: number; y: number }>
  ): boolean {
    const networkSet = new Set(networksInComponent.map((c) => `${c.x},${c.y}`));
    const directions = [
      { dx: 1, dy: 0 },
      { dx: -1, dy: 0 },
      { dx: 0, dy: 1 },
      { dx: 0, dy: -1 },
    ];

    for (const cell of component) {
      let degree = 0;
      for (const dir of directions) {
        if (componentSet.has(`${cell.x + dir.dx},${cell.y + dir.dy}`)) {
          degree++;
        }
      }
      const isEndpoint = degree === 1;
      const hasClue = networkSet.has(`${cell.x},${cell.y}`);

      if (isEndpoint !== hasClue) {
        return false;
      }
    }

    return true;
  }
}
