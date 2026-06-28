import { useRef, useMemo, useLayoutEffect, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getFloorTint, type PlayerColorLower } from "@/constants/playerColors";

/**
 * Tutorial-only floor: **same tile look as `ParticleFloor`** (1.6 planes, twin
 * ring shader, identical palette) plus an astraea-style diagonal traveling
 * highlight pulse. The real game board is unchanged — `GameScreen` still uses
 * `ParticleFloor` only.
 */
interface TutorialParticleFloorProps {
    gridWidth?: number;
    gridHeight?: number;
    spacing?: number;
    nodeStates?: (string | null)[][];
    /** Wave speed vs default (1 = same as astraea tutorial tuning). */
    pulseRateMultiplier?: number;
}

// Same tile tints as `ParticleFloor` — from `playerColors` SSOT.
const FLOOR_COLOR_MAP: Record<PlayerColorLower | "gray", THREE.Color> = {
    red: new THREE.Color(getFloorTint("RED")),
    green: new THREE.Color(getFloorTint("GREEN")),
    blue: new THREE.Color(getFloorTint("BLUE")),
    yellow: new THREE.Color(getFloorTint("YELLOW")),
    purple: new THREE.Color(getFloorTint("PURPLE")),
    cyan: new THREE.Color(getFloorTint("CYAN")),
    gray: new THREE.Color("#888888"),
};

export function TutorialParticleFloor({
    gridWidth = 10,
    gridHeight = 8,
    spacing = 2.5,
    nodeStates,
    pulseRateMultiplier = 1,
}: TutorialParticleFloorProps) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const [tempObject] = useState(() => new THREE.Object3D());
    const rippleStartTime = useRef<number>(-10);

    const { totalNodes, offsetX, offsetZ } = useMemo(
        () => ({
            totalNodes: gridWidth * gridHeight,
            offsetX: (gridWidth - 1) / 2,
            offsetZ: (gridHeight - 1) / 2,
        }),
        [gridWidth, gridHeight],
    );

    useLayoutEffect(() => {
        if (!meshRef.current) return;
        let i = 0;
        for (let gx = 0; gx < gridWidth; gx++) {
            for (let gz = 0; gz < gridHeight; gz++) {
                const x = (gx - offsetX) * spacing;
                const z = (gz - offsetZ) * spacing;
                tempObject.position.set(x, -2.55, z);
                tempObject.rotation.x = -Math.PI / 2;
                tempObject.scale.set(1, 1, 1);
                tempObject.updateMatrix();
                meshRef.current.setMatrixAt(i, tempObject.matrix);
                i++;
            }
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [gridWidth, gridHeight, spacing, offsetX, offsetZ, tempObject]);

    const colorArray = useMemo(() => {
        const array = new Float32Array(totalNodes * 3);
        const defaultColor = new THREE.Color("#333333");
        let i = 0;
        for (let gx = 0; gx < gridWidth; gx++) {
            for (let gz = 0; gz < gridHeight; gz++) {
                const nodeState = nodeStates ? nodeStates[gx][gz] : null;
                const color =
                    nodeState && nodeState in FLOOR_COLOR_MAP
                        ? FLOOR_COLOR_MAP[nodeState as keyof typeof FLOOR_COLOR_MAP]
                        : defaultColor;
                color.toArray(array, i * 3);
                i++;
            }
        }
        return array;
    }, [nodeStates, gridWidth, gridHeight, totalNodes]);

    /** 1 = tile receives diagonal pulse (any occupied cell, including gray). */
    const litArray = useMemo(() => {
        const array = new Float32Array(totalNodes);
        let i = 0;
        for (let gx = 0; gx < gridWidth; gx++) {
            for (let gz = 0; gz < gridHeight; gz++) {
                const nodeState = nodeStates ? nodeStates[gx][gz] : null;
                array[i] = nodeState ? 1.0 : 0.0;
                i++;
            }
        }
        return array;
    }, [nodeStates, gridWidth, gridHeight, totalNodes]);

    const uniforms = useMemo(
        () => ({
            uTime: { value: 0 },
            uRippleTime: { value: -10 },
            uWavePeriod: { value: 5.0 },
            uBoardAxis: { value: 0 },
        }),
        [],
    );

    useEffect(() => {
        const halfX = ((gridWidth - 1) / 2) * spacing;
        const halfZ = ((gridHeight - 1) / 2) * spacing;
        uniforms.uBoardAxis.value = (halfX + halfZ) / Math.SQRT2;
    }, [gridWidth, gridHeight, spacing, uniforms]);

    useEffect(() => {
        uniforms.uWavePeriod.value = 5.0 / Math.max(0.0001, pulseRateMultiplier);
    }, [pulseRateMultiplier, uniforms]);

    useFrame((_, delta) => {
        uniforms.uTime.value += delta;
        if (rippleStartTime.current >= 0) {
            rippleStartTime.current += delta;
            uniforms.uRippleTime.value = rippleStartTime.current;
            if (rippleStartTime.current > 3.0) {
                rippleStartTime.current = -10;
                uniforms.uRippleTime.value = -10;
            }
        }
    });

    const vertexShader = `
      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying float vLit;
      attribute vec3 instanceColor;
      attribute float instanceLit;

      void main() {
        vUv = uv;
        vColor = instanceColor;
        vLit = instanceLit;
        vec4 worldPos = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        vWorldPos = worldPos.xyz;
        vec4 mvPosition = modelViewMatrix * instanceMatrix * vec4(position, 1.0);
        gl_Position = projectionMatrix * mvPosition;
      }
    `;

    const fragmentShader = `
      uniform float uTime;
      uniform float uRippleTime;
      uniform float uGridExtent;
      uniform float uWavePeriod;
      uniform float uBoardAxis;

      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorldPos;
      varying float vLit;

      void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);

        float r1 = 0.18;
        float r2 = 0.24;
        float thickness = 0.012;
        float blur = 0.01;

        float ring1 = 1.0 - smoothstep(thickness, thickness + blur, abs(dist - r1));
        float ring2 = 1.0 - smoothstep(thickness, thickness + blur, abs(dist - r2));

        float alpha = ring1 + ring2;

        if (alpha < 0.01) discard;

        float rippleIntensity = 0.0;
        if (uRippleTime >= 0.0 && uRippleTime < 3.0) {
          float distFromCenter = length(vec2(vWorldPos.x, vWorldPos.z));
          float rippleSpeed = 25.0;
          float rippleRadius = uRippleTime * rippleSpeed;
          float rippleWidth = 8.0;
          float rippleDist = abs(distFromCenter - rippleRadius);
          rippleIntensity = 1.0 - smoothstep(0.0, rippleWidth, rippleDist);
          float fadeOut = 1.0 - smoothstep(1.5, 3.0, uRippleTime);
          rippleIntensity *= fadeOut;
          rippleIntensity *= 0.8 + 0.2 * sin(uRippleTime * 10.0 - distFromCenter * 0.5);
        }

        // Astraea-style diagonal pulse (same math as prior tutorial fork).
        float distAlong = (vWorldPos.x + vWorldPos.z) * 0.70710678;
        float preRoll = 2.0;
        float postRoll = 9.0;
        float waveTime = mod(uTime, uWavePeriod);
        float wavePos = mix(-uBoardAxis - preRoll, uBoardAxis + postRoll, waveTime / uWavePeriod);
        float dy = distAlong - wavePos;
        float leadingWidth = 0.9;
        float trailingWidth = 3.5;
        float width = mix(trailingWidth, leadingWidth, step(0.0, dy));
        float pulse = exp(-pow(dy / width, 2.0)) * vLit;

        vec3 pulseRgb = vec3(0.35, 0.55, 0.95) * pulse * 1.1;
        vec3 finalColor = vColor + rippleIntensity * vec3(0.5, 0.8, 1.0) + pulseRgb;
        float finalAlpha = alpha * (0.8 + rippleIntensity * 1.2) * (1.0 + pulse * 0.45);

        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `;

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, totalNodes]}>
            <planeGeometry args={[1.6, 1.6]}>
                <instancedBufferAttribute attach="attributes-instanceColor" args={[colorArray, 3]} />
                <instancedBufferAttribute attach="attributes-instanceLit" args={[litArray, 1]} />
            </planeGeometry>
            <shaderMaterial
                vertexShader={vertexShader}
                fragmentShader={fragmentShader}
                uniforms={uniforms}
                transparent
                depthWrite={false}
                side={THREE.DoubleSide}
                blending={THREE.AdditiveBlending}
            />
        </instancedMesh>
    );
}
