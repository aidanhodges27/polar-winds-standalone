import { useMemo } from 'react';
import * as THREE from 'three';
import { getPlayerHex } from "@/constants/playerColors";
import { ThickEdges } from './OutlineMaterial';

// Polyomino shape definitions matching the server.
// Each shape is an array of [x, y] offsets for the small cubes that draw the clue.
type PolyominoShape = Array<[number, number]>;

const POLYOMINO_SHAPES: Record<string, PolyominoShape> = {
  // RED: 2x4 rectangle (8 cells)
  RED: [
    [0, 0], [1, 0],
    [0, 1], [1, 1],
    [0, 2], [1, 2],
    [0, 3], [1, 3]
  ],

  // GREEN: Diagonal stair pattern (7 cells) - rotated 90° clockwise
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

// Neutral uses RED shape as default
const getShapeForColor = (color: string): PolyominoShape => {
  if (color === 'NEUTRAL' || !POLYOMINO_SHAPES[color]) {
    return POLYOMINO_SHAPES.RED;
  }
  return POLYOMINO_SHAPES[color];
};

// Center the shape around origin
const centerShape = (shape: PolyominoShape): PolyominoShape => {
  const minX = Math.min(...shape.map(([x]) => x));
  const maxX = Math.max(...shape.map(([x]) => x));
  const minY = Math.min(...shape.map(([, y]) => y));
  const maxY = Math.max(...shape.map(([, y]) => y));

  const centerX = (minX + maxX) / 2;
  const centerY = (minY + maxY) / 2;

  return shape.map(([x, y]) => [x - centerX, y - centerY]);
};

export function Polyomino({
  color = getPlayerHex("RED"),
  playerColor = "RED",
  scale = 1,
  connected = false,
  ...props
}: {
  color?: string;
  playerColor?: string;
  scale?: number;
  connected?: boolean;
} & any) {
  // Size of each cube in the polyomino
  const cubeSize = 0.25;

  const cubeGeometry = useMemo(() => new THREE.BoxGeometry(cubeSize, cubeSize, cubeSize), []);

  // Get the shape for this player color and center it
  const shape = centerShape(getShapeForColor(playerColor));

  const spacing = 0.28; // Slightly larger than cube for small gaps

  return (
    <group {...props} scale={scale}>
      {shape.map(([x, y], index) => (
        <group key={index} position={[x * spacing, 0, y * spacing]}>
          {/* Main mesh */}
          <mesh geometry={cubeGeometry}>
            <meshStandardMaterial
              color={color}
              roughness={0.3}
              metalness={0.6}
              emissive={color}
              emissiveIntensity={connected ? 1 : 0}
            />
          </mesh>
          {/* Thick edge outline */}
          <ThickEdges geometry={cubeGeometry} />
        </group>
      ))}
    </group>
  );
}
