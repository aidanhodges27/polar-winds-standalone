import { useRef, useMemo, useLayoutEffect, useState, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getFloorTint, type PlayerColorLower } from "@/constants/playerColors";

interface ParticleFloorProps {
    gridWidth?: number;
    gridHeight?: number;
    spacing?: number;
    nodeStates?: (string | null)[][];
    rippleTrigger?: number; // Increment this to trigger a ripple
}

export function ParticleFloor({ gridWidth = 10, gridHeight = 8, spacing = 2.5, nodeStates, rippleTrigger = 0 }: ParticleFloorProps) {
    const meshRef = useRef<THREE.InstancedMesh>(null);
    const [tempObject] = useState(() => new THREE.Object3D());
    const rippleStartTime = useRef<number>(-10); // Start with ripple already "finished"

    // 1. Grid layout
    const { totalNodes, offsetX, offsetZ } = useMemo(() => ({
        totalNodes: gridWidth * gridHeight,
        offsetX: (gridWidth - 1) / 2,
        offsetZ: (gridHeight - 1) / 2
    }), [gridWidth, gridHeight]);

    // Update instance matrices (positions)
    useLayoutEffect(() => {
        if (!meshRef.current) return;

        let i = 0;
        for (let gx = 0; gx < gridWidth; gx++) {
            for (let gz = 0; gz < gridHeight; gz++) {
                const x = (gx - offsetX) * spacing;
                const z = (gz - offsetZ) * spacing;

                tempObject.position.set(x, -2.55, z);
                tempObject.rotation.x = -Math.PI / 2; // Flat on floor
                tempObject.scale.set(1, 1, 1);

                tempObject.updateMatrix();
                meshRef.current.setMatrixAt(i, tempObject.matrix);
                i++;
            }
        }
        meshRef.current.instanceMatrix.needsUpdate = true;
    }, [gridWidth, gridHeight, spacing, offsetX, offsetZ, tempObject]);

    // 2. Colors array
    const colorArray = useMemo(() => {
        const array = new Float32Array(totalNodes * 3);
        const colorMap: Record<PlayerColorLower | "gray", THREE.Color> = {
            red: new THREE.Color(getFloorTint("RED")),
            green: new THREE.Color(getFloorTint("GREEN")),
            blue: new THREE.Color(getFloorTint("BLUE")),
            yellow: new THREE.Color(getFloorTint("YELLOW")),
            purple: new THREE.Color(getFloorTint("PURPLE")),
            cyan: new THREE.Color(getFloorTint("CYAN")),
            gray: new THREE.Color("#888888"), // Neutral (tutorial)
        };
        const defaultColor = new THREE.Color("#333333");

        let i = 0;
        for (let gx = 0; gx < gridWidth; gx++) {
            for (let gz = 0; gz < gridHeight; gz++) {
                const nodeState = nodeStates ? nodeStates[gx][gz] : null;
                const color = nodeState ? colorMap[nodeState as keyof typeof colorMap] : defaultColor;

                if (color) {
                    color.toArray(array, i * 3);
                } else {
                    defaultColor.toArray(array, i * 3);
                }
                i++;
            }
        }
        return array;
    }, [nodeStates, gridWidth, gridHeight, totalNodes]);

    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uRippleTime: { value: -10 },
        uGridExtent: { value: Math.max(offsetX, offsetZ) * spacing },
    }), []);

    // Trigger ripple when rippleTrigger changes
    useEffect(() => {
        if (rippleTrigger > 0) {
            rippleStartTime.current = 0;
        }
    }, [rippleTrigger]);

    // Update uniforms each frame
    useFrame((_, delta) => {
        uniforms.uTime.value += delta;
        if (rippleStartTime.current >= 0) {
            rippleStartTime.current += delta;
            uniforms.uRippleTime.value = rippleStartTime.current;
            // Stop updating after ripple completes (about 3 seconds)
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
      attribute vec3 instanceColor;

      void main() {
        vUv = uv;
        vColor = instanceColor;
        // Get world position of the instance
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

      varying vec2 vUv;
      varying vec3 vColor;
      varying vec3 vWorldPos;

      void main() {
        vec2 center = vUv - 0.5;
        float dist = length(center);

        // Two thin concentric circles
        float r1 = 0.18;
        float r2 = 0.24;
        float thickness = 0.012;
        float blur = 0.01;

        float ring1 = 1.0 - smoothstep(thickness, thickness + blur, abs(dist - r1));
        float ring2 = 1.0 - smoothstep(thickness, thickness + blur, abs(dist - r2));

        float alpha = ring1 + ring2;

        if (alpha < 0.01) discard;

        // Calculate ripple effect
        float rippleIntensity = 0.0;
        if (uRippleTime >= 0.0 && uRippleTime < 3.0) {
          // Distance from center of grid (world space)
          float distFromCenter = length(vec2(vWorldPos.x, vWorldPos.z));

          // Ripple expands outward from center
          float rippleSpeed = 25.0; // Units per second
          float rippleRadius = uRippleTime * rippleSpeed;
          float rippleWidth = 8.0; // Width of the ripple band

          // Calculate how close this particle is to the ripple front
          float rippleDist = abs(distFromCenter - rippleRadius);

          // Smooth falloff for the ripple
          rippleIntensity = 1.0 - smoothstep(0.0, rippleWidth, rippleDist);

          // Fade out the ripple over time
          float fadeOut = 1.0 - smoothstep(1.5, 3.0, uRippleTime);
          rippleIntensity *= fadeOut;

          // Add slight pulse to the ripple
          rippleIntensity *= 0.8 + 0.2 * sin(uRippleTime * 10.0 - distFromCenter * 0.5);
        }

        // Boost color intensity during ripple
        vec3 finalColor = vColor + rippleIntensity * vec3(0.5, 0.8, 1.0);
        float finalAlpha = alpha * (0.8 + rippleIntensity * 1.2);

        gl_FragColor = vec4(finalColor, finalAlpha);
      }
    `;

    return (
        <instancedMesh ref={meshRef} args={[undefined, undefined, totalNodes]}>
            <planeGeometry args={[1.6, 1.6]}>
                <instancedBufferAttribute attach="attributes-instanceColor" args={[colorArray, 3]} />
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
