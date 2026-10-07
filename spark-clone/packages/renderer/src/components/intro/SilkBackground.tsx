import { Canvas, useFrame } from '@react-three/fiber';
import { Component, type ReactNode, useMemo, useRef } from 'react';
import * as THREE from 'three';

// If WebGL is unavailable or the context is lost, render nothing — the intro's
// dark ground stays, and the text sequence (a sibling) is never affected.
class CanvasBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

// Fullscreen quad drawn straight in clip space — no camera math needed.
const VERT = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

// Flowing "silk" bands tinted across the app's aqua → azure → violet daylight
// palette over a near-black base, warped by layered value noise.
const FRAG = /* glsl */ `
  precision highp float;
  varying vec2 vUv;
  uniform float uTime;
  uniform vec3 uA;
  uniform vec3 uB;
  uniform vec3 uC;
  uniform vec3 uBg;

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    float a = hash(i);
    float b = hash(i + vec2(1.0, 0.0));
    float c = hash(i + vec2(0.0, 1.0));
    float d = hash(i + vec2(1.0, 1.0));
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0;
    float amp = 0.5;
    for (int i = 0; i < 5; i++) {
      v += amp * noise(p);
      p *= 2.0;
      amp *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = vUv;
    float t = uTime * 0.12;

    float warp = fbm(uv * 2.5 + vec2(t * 0.6, -t * 0.4));
    float flow = uv.x * 2.0 + warp * 1.6 + sin(uv.y * 4.0 + t * 1.5) * 0.35;
    float bands = sin(flow * 3.14159265 + t * 2.0) * 0.5 + 0.5;
    bands = pow(bands, 1.4);

    float g = clamp(uv.x * 0.7 + warp * 0.5 + sin(uv.y * 2.0 + t) * 0.1, 0.0, 1.0);
    vec3 col = mix(uA, uB, smoothstep(0.0, 0.55, g));
    col = mix(col, uC, smoothstep(0.5, 1.0, g));

    float sheen = smoothstep(0.15, 0.95, bands * 0.8 + fbm(uv * 3.0 - t) * 0.35);
    vec3 color = mix(uBg, col, sheen * 0.7);
    color += col * pow(bands, 8.0) * 0.25;

    float d = distance(uv, vec2(0.5));
    color *= 1.0 - d * 0.5;

    gl_FragColor = vec4(color, 1.0);
  }
`;

function SilkPlane() {
  const mat = useRef<THREE.ShaderMaterial>(null);
  const uniforms = useMemo(
    () => ({
      uTime: { value: 0 },
      uA: { value: new THREE.Color('#57e6b0') }, // aqua
      uB: { value: new THREE.Color('#5aa8f2') }, // azure
      uC: { value: new THREE.Color('#9d84f2') }, // violet
      uBg: { value: new THREE.Color('#0e0e12') }, // near-black base
    }),
    [],
  );
  useFrame((_, dt) => {
    const u = mat.current?.uniforms.uTime;
    if (u) u.value += dt;
  });
  return (
    <mesh>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial ref={mat} vertexShader={VERT} fragmentShader={FRAG} uniforms={uniforms} />
    </mesh>
  );
}

/**
 * `still`: reduced motion — render on demand instead of a 60fps full-screen
 * shader loop. DPR capped at 1.5: the soft silk gains nothing from 2x and the
 * fragment shader cost scales with pixel count.
 */
export function SilkBackground({ still = false }: { still?: boolean }) {
  return (
    <CanvasBoundary>
      {/* R3F forces the Canvas wrapper to position:relative, so keep it inside
          an absolutely-positioned box — otherwise its full-height container
          sits in normal flow and pushes sibling content off-screen. */}
      <div className="absolute inset-0">
        <Canvas
          dpr={[1, 1.5]}
          frameloop={still ? 'demand' : 'always'}
          gl={{ antialias: true }}
          camera={{ position: [0, 0, 1] }}
        >
          <SilkPlane />
        </Canvas>
      </div>
    </CanvasBoundary>
  );
}
