import { useRef, useMemo } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { getParticleShades, toUpperId, type PlayerColorLower } from "@/constants/playerColors";

type ParticleBrainProps = {
    color?: PlayerColorLower;
    isCollected?: boolean;
    onComplete?: () => void;
};

export function ParticleBrain({ color = "blue", isCollected = false }: ParticleBrainProps) {
    const pointsRef = useRef<THREE.Points>(null);
    const hasTriggeredExplosion = useRef(false);

    // Generate particles in a spherical distribution
    const particles = useMemo(() => {
        const count = 1000;
        const positions = new Float32Array(count * 3);
        const colors = new Float32Array(count * 3);
        const randoms = new Float32Array(count * 3);

        const [h1, h2, h3] = getParticleShades(toUpperId(color));
        const color1 = new THREE.Color(h1);
        const color2 = new THREE.Color(h2);
        const color3 = new THREE.Color(h3);

        for (let i = 0; i < count; i++) {
            const theta = Math.random() * Math.PI * 2;
            const phi = Math.acos(2 * Math.random() - 1);
            const radius = 0.5 + (Math.random() * 0.2); // Smaller for collectible

            positions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
            positions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
            positions[i * 3 + 2] = radius * Math.cos(phi);

            const mixRatio = Math.random();
            const finalColor = new THREE.Color().lerpColors(color1, color2, mixRatio);
            if (Math.random() > 0.8) finalColor.lerp(color3, 0.5);

            colors[i * 3] = finalColor.r;
            colors[i * 3 + 1] = finalColor.g;
            colors[i * 3 + 2] = finalColor.b;

            randoms[i * 3] = Math.random();
            randoms[i * 3 + 1] = Math.random();
            randoms[i * 3 + 2] = Math.random();
        }
        return { positions, colors, randoms };
    }, [color]);

    const uniforms = useMemo(() => ({
        uTime: { value: 0 },
        uPixelRatio: { value: Math.min(window.devicePixelRatio, 2) },
        uBrightness: { value: 0.3 }
    }), []);

    const vertexShader = `
    uniform float uTime;
    uniform float uPixelRatio;
    uniform float uBrightness;
    attribute vec3 aRandom;
    varying vec3 vColor;
    varying float vAlpha;

    vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
    vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
    vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

    float snoise(vec3 v) {
        const vec2 C = vec2(1.0/6.0, 1.0/3.0);
        const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
        vec3 i  = floor(v + dot(v, C.yyy) );
        vec3 x0 = v - i + dot(i, C.xxx) ;
        vec3 g = step(x0.yzx, x0.xyz);
        vec3 l = 1.0 - g;
        vec3 i1 = min( g.xyz, l.zxy );
        vec3 i2 = max( g.xyz, l.zxy );
        vec3 x1 = x0 - i1 + C.xxx;
        vec3 x2 = x0 - i2 + C.yyy;
        vec3 x3 = x0 - D.yyy;
        i = mod289(i);
        vec4 p = permute( permute( permute(
                   i.z + vec4(0.0, i1.z, i2.z, 1.0 ))
                 + i.y + vec4(0.0, i1.y, i2.y, 1.0 ))
                 + i.x + vec4(0.0, i1.x, i2.x, 1.0 ));
        float n_ = 0.142857142857;
        vec3  ns = n_ * D.wyz - D.xzx;
        vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
        vec4 x_ = floor(j * ns.z);
        vec4 y_ = floor(j - 7.0 * x_ );
        vec4 x = x_ *ns.x + ns.yyyy;
        vec4 y = y_ *ns.x + ns.yyyy;
        vec4 h = 1.0 - abs(x) - abs(y);
        vec4 b0 = vec4( x.xy, y.xy );
        vec4 b1 = vec4( x.zw, y.zw );
        vec4 s0 = floor(b0)*2.0 + 1.0;
        vec4 s1 = floor(b1)*2.0 + 1.0;
        vec4 sh = -step(h, vec4(0.0));
        vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy ;
        vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww ;
        vec3 p0 = vec3(a0.xy,h.x);
        vec3 p1 = vec3(a0.zw,h.y);
        vec3 p2 = vec3(a1.xy,h.z);
        vec3 p3 = vec3(a1.zw,h.w);
        vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2, p2), dot(p3,p3)));
        p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
        vec4 m = max(0.5 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
        m = m * m;
        return 105.0 * dot( m*m, vec4( dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3) ) );
    }

    void main() {
        vColor = color * uBrightness;
        // Slow animation speed
        float time = uTime * 0.05;
        vec3 newPos = position;

        vAlpha = 0.8;

        // Add subtle noise movement
        float noise = snoise(position * 2.0 + time);
        newPos += normalize(position) * noise * 0.1;

        vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
        gl_Position = projectionMatrix * mvPosition;
        gl_PointSize = 28.0 / -mvPosition.z * uPixelRatio;
    }
  `;

    const fragmentShader = `
    varying vec3 vColor;
    varying float vAlpha;
    void main() {
        vec2 center = gl_PointCoord - vec2(0.5);
        float dist = length(center);
        float alpha = 1.0 - smoothstep(0.3, 0.5, dist);
        if (alpha < 0.01) discard;
        gl_FragColor = vec4(vColor, alpha * vAlpha);
    }
  `;

    const totalRotation = useRef(0);
    const activationTime = useRef<number>(0);

    useFrame((state, delta) => {
        if (pointsRef.current) {
            const material = pointsRef.current.material as THREE.ShaderMaterial;
            material.uniforms.uTime.value = state.clock.elapsedTime;

            // Track when collectible becomes active/inactive
            if (isCollected && !hasTriggeredExplosion.current) {
                activationTime.current = state.clock.elapsedTime;
                hasTriggeredExplosion.current = true;
            } else if (!isCollected && hasTriggeredExplosion.current) {
                // Reset when disconnected
                hasTriggeredExplosion.current = false;
                activationTime.current = 0;
            }

            if (isCollected) {
                const elapsed = state.clock.elapsedTime - activationTime.current;

                // Brightness animation: Brighten when collected
                const brightnessProgress = Math.min(elapsed / 0.3, 1.0);
                material.uniforms.uBrightness.value = 0.3 + brightnessProgress * 0.4; // 0.3 -> 0.7

                // Faster constant rotation when connected (0.15 instead of 0.025)
                totalRotation.current += delta * 0.15;
                pointsRef.current.rotation.y = totalRotation.current;
                pointsRef.current.rotation.z = totalRotation.current * 0.5;
            } else {
                // Dim brightness when not collected
                const currentBrightness = material.uniforms.uBrightness.value;
                if (currentBrightness > 0.3) {
                    material.uniforms.uBrightness.value = Math.max(0.3, currentBrightness - delta * 2.0);
                }

                // Slower rotation when not collected
                totalRotation.current += delta * 0.025;
                pointsRef.current.rotation.y = totalRotation.current;
                pointsRef.current.rotation.z = state.clock.elapsedTime * 0.0125;
            }
        }
    });

    return (
        <points ref={pointsRef} renderOrder={3}>
            <bufferGeometry>
                <bufferAttribute attach="attributes-position" count={particles.positions.length / 3} array={particles.positions} itemSize={3} />
                <bufferAttribute attach="attributes-color" count={particles.colors.length / 3} array={particles.colors} itemSize={3} />
                <bufferAttribute attach="attributes-aRandom" count={particles.randoms.length / 3} array={particles.randoms} itemSize={3} />
            </bufferGeometry>
            <shaderMaterial vertexShader={vertexShader} fragmentShader={fragmentShader} uniforms={uniforms} vertexColors transparent blending={THREE.AdditiveBlending} depthWrite={false} depthTest={true} />
        </points>
    );
}
