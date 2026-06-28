import { CollectibleType } from "../schema/GameState";
import { BaseCollectible } from "./BaseCollectible";
import { NetworkCollectible } from "./NetworkCollectible";
import { BoxCollectible } from "./BoxCollectible";
import { EquilibriumCollectible } from "./EquilibriumCollectible";
import { CloneCollectible } from "./CloneCollectible";
import { VantageCollectible } from "./VantageCollectible";
import { GalaxyCollectible } from "./GalaxyCollectible";
import { PolyominoCollectible } from "./PolyominoCollectible";

export class CollectibleFactory {
  // The generic arguments tell TypeScript every key is a CollectibleType and every value is a BaseCollectible.
  // Without them, TypeScript may incorrectly infer the value type from only the first handler in the array.
  private static handlers: Map<CollectibleType, BaseCollectible> = new Map<CollectibleType, BaseCollectible>([
    ["network", new NetworkCollectible()],
    ["box", new BoxCollectible()],
    ["equilibrium", new EquilibriumCollectible()],
    ["clone", new CloneCollectible()],
    ["vantage", new VantageCollectible()],
    ["galaxy", new GalaxyCollectible()],
    ["polyomino", new PolyominoCollectible()],
  ]);

  static getHandler(type: CollectibleType): BaseCollectible {
    const handler = this.handlers.get(type);
    if (!handler) {
      throw new Error(`No handler found for collectible type: ${type}`);
    }
    return handler;
  }
}
