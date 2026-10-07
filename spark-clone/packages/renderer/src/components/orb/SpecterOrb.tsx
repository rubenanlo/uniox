import { Canvas, useFrame, useThree } from '@react-three/fiber';
import type { PointerEvent as ReactPointerEvent, ReactNode } from 'react';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from 'react';
import * as THREE from 'three';
import { cn } from '../../lib/utils';

export interface SpecterOrbProps {
  /** Width of the container */
  width?: string | number;
  /** Height of the container */
  height?: string | number;
  /** Extra classes for the container */
  className?: string;
  /** Content stacked above the orb */
  children?: ReactNode;
  /** Radius of the smooth core before displacement */
  radius?: number;
  /** How far the noise pushes the surface outward */
  turbulence?: number;
  /** Frequency of the displacement field */
  noiseScale?: number;
  /** Speed the field drifts through the orb */
  flowSpeed?: number;
  /** Octaves of noise layered onto the surface */
  octaves?: number;
  /** Amplitude falloff between octaves */
  roughness?: number;
  /** Frequency gain between octaves */
  lacunarity?: number;
  /** Maximum ray march iterations */
  steps?: number;
  /** Fraction of each distance estimate to advance */
  stride?: number;
  /** Scales the orb inside the frame */
  zoom?: number;
  /** Radius of the circular cutout */
  maskRadius?: number;
  /** Softness of the circular cutout */
  maskFeather?: number;
  /** Key light color */
  colorA?: string;
  /** Fill light color */
  colorB?: string;
  /** Ambient wrap color */
  colorC?: string;
  /** Strength of the two opposing rim lights */
  rimStrength?: number;
  /** Tightness of the rim falloff */
  rimPower?: number;
  /** Color of the primary highlight */
  specularColorA?: string;
  /** Color of the secondary highlight */
  specularColorB?: string;
  /** Strength of both highlights */
  specularStrength?: number;
  /** Tightness of the highlights */
  specularSharpness?: number;
  /** Strength of the halo around the silhouette */
  glowStrength?: number;
  /** Tightness of the halo falloff */
  glowFalloff?: number;
  /** Contrast curve applied at the end */
  gamma?: number;
  /** Overall gain */
  brightness?: number;
  /** Master alpha of the canvas */
  opacity?: number;
  /** Fill behind the orb, accepts "transparent" */
  backgroundColor?: string;
  /** Let the pointer swing the lighting */
  cursorInteraction?: boolean;
  /** How far the pointer swings the lighting */
  cursorLight?: number;
  /** Drop resolution when the frame rate falls short */
  adaptiveQuality?: boolean;
  /** Frame rate the adaptive pass aims for */
  targetFps?: number;
  /** Upper bound on device pixel ratio */
  dpr?: number;
  /** Hold the animation still */
  paused?: boolean;
}

const orbVertex = `
varying vec2 vPlane;

void main() {
  vPlane = uv;
  gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const orbFragment = `
precision highp float;

varying vec2 vPlane;
uniform vec2 uCanvas;
uniform float uClock;
uniform float uCore;
uniform float uSwell;
uniform float uGrain;
uniform float uFlow;
uniform int uBands;
uniform float uDecay;
uniform float uClimb;
uniform float uNorm;
uniform int uSteps;
uniform float uStride;
uniform float uZoom;
uniform float uMaskRadius;
uniform float uMaskFeather;
uniform vec3 uInkA;
uniform vec3 uInkB;
uniform vec3 uInkC;
uniform float uRim;
uniform float uRimShape;
uniform vec3 uSheenA;
uniform vec3 uSheenB;
uniform float uSheen;
uniform float uSheenTight;
uniform float uHaze;
uniform float uHazeTight;
uniform float uGamma;
uniform float uGain;
uniform float uOpacity;
uniform vec3 uBackdrop;
uniform float uBackdropAlpha;
uniform vec2 uSwing;

const float SKIN = 0.002;

float spark(vec3 cell) {
  cell = fract(cell * 0.3183099 + vec3(0.71, 0.113, 0.419));
  cell *= 17.0;
  return fract(cell.x * cell.y * cell.z * (cell.x + cell.y + cell.z));
}

float wisp(vec3 spot) {
  vec3 anchor = floor(spot);
  vec3 lean = fract(spot);
  lean = lean * lean * (3.0 - 2.0 * lean);
  float n000 = spark(anchor + vec3(0.0, 0.0, 0.0));
  float n100 = spark(anchor + vec3(1.0, 0.0, 0.0));
  float n010 = spark(anchor + vec3(0.0, 1.0, 0.0));
  float n110 = spark(anchor + vec3(1.0, 1.0, 0.0));
  float n001 = spark(anchor + vec3(0.0, 0.0, 1.0));
  float n101 = spark(anchor + vec3(1.0, 0.0, 1.0));
  float n011 = spark(anchor + vec3(0.0, 1.0, 1.0));
  float n111 = spark(anchor + vec3(1.0, 1.0, 1.0));
  return mix(
    mix(mix(n000, n100, lean.x), mix(n010, n110, lean.x), lean.y),
    mix(mix(n001, n101, lean.x), mix(n011, n111, lean.x), lean.y),
    lean.z
  );
}

float shell(vec3 spot) {
  vec3 probe = spot * uGrain + vec3(0.0, 0.0, uClock * uFlow);
  float sum = 0.0;
  float amp = 1.0;
  for (int i = 0; i < 5; i++) {
    if (i >= uBands) break;
    sum += wisp(probe) * amp;
    probe *= uClimb;
    amp *= uDecay;
  }
  return sum * uNorm;
}

float field(vec3 spot) {
  return length(spot) - uCore - shell(spot) * uSwell;
}

vec3 slope(vec3 spot) {
  vec2 nudge = vec2(0.0025, 0.0);
  float here = field(spot);
  return normalize(
    here - vec3(
      field(spot - nudge.xyy),
      field(spot - nudge.yxy),
      field(spot - nudge.yyx)
    )
  );
}

float rimTerm(vec3 normal, vec3 ray, vec3 axis) {
  float lean = sqrt(max(dot(normal, axis), 0.0)) * 1.5 - dot(normal, -ray);
  return pow(max(lean, 0.0), uRimShape);
}

float gloss(vec3 toLight, vec3 toEye, vec3 normal, float tight) {
  vec3 between = normalize(toLight + toEye);
  return pow(max(dot(normal, between), 0.0), tight);
}

void main() {
  vec2 plane = (vPlane * 2.0 - 1.0) * vec2(uCanvas.x / max(uCanvas.y, 1.0), 1.0) / max(uZoom, 0.05);

  float span = length(plane);
  float disc = 1.0 - smoothstep(uMaskRadius - uMaskFeather, uMaskRadius, span);

  vec3 lit = vec3(0.0);

  if (disc > 0.0) {
    vec3 eye = vec3(0.0, 0.0, -1.0);
    vec3 ray = normalize(vec3(plane, 1.0));

    float hull = uCore + uSwell;
    float toward = dot(eye, ray);
    float gap = dot(eye, eye) - hull * hull;
    float root = toward * toward - gap;

    if (root < 0.0) {
      vec3 grazed = eye + ray * max(-toward, 0.0);
      float nearest = max(field(grazed), 0.0);
      vec3 wash = max(dot(plane, vec2(0.707)), 0.0) * uInkA
        + max(dot(plane, vec2(-0.707)), 0.0) * uInkB
        + uInkC;
      lit = pow(max(1.0 - nearest, 0.0), uHazeTight) * wash * uHaze;
    } else {
      float reach = sqrt(root);
      float travel = max(-toward - reach, 0.0);
      float limit = -toward + reach;
      float nearest = 1.0e9;
      bool struck = false;
      vec3 landed = eye + ray * travel;

      for (int i = 0; i < 96; i++) {
        if (i >= uSteps) break;
        vec3 at = eye + ray * travel;
        float march = field(at);
        nearest = min(nearest, march);
        if (march < SKIN) {
          struck = true;
          landed = at;
          break;
        }
        travel += max(march * uStride, SKIN);
        if (travel > limit) break;
      }

      if (!struck) {
        vec3 wash = max(dot(plane, vec2(0.707)), 0.0) * uInkA
          + max(dot(plane, vec2(-0.707)), 0.0) * uInkB
          + uInkC;
        lit = pow(max(1.0 - max(nearest, 0.0), 0.0), uHazeTight) * wash * uHaze;
      } else {
        vec3 normal = slope(landed);
        vec3 toEye = normalize(eye - landed);

        vec3 axis = normalize(vec3(0.707 + uSwing.x, 0.707 + uSwing.y, 0.0));
        lit += uInkA * rimTerm(normal, ray, axis) * uRim;
        lit += uInkB * rimTerm(normal, ray, -axis) * uRim;
        lit += uInkC * rimTerm(normal, ray, vec3(0.0, 0.0, -1.0)) * uRim * 0.667;

        vec3 keyDir = normalize(vec3(0.6 + uSwing.x, 0.8 + uSwing.y, -0.5));
        vec3 fillDir = normalize(vec3(-0.6 + uSwing.x, -0.8 + uSwing.y, 0.0));
        lit += uSheenA * gloss(keyDir, toEye, normal, uSheenTight) * uSheen;
        lit += uSheenB * gloss(fillDir, toEye, normal, uSheenTight * 1.33) * uSheen * 0.75;
      }
    }

    lit = pow(max(lit, 0.0), vec3(uGamma));
  }

  lit *= uGain * disc;

  float cover = clamp(max(lit.r, max(lit.g, lit.b)), 0.0, 1.0);
  float rest = uBackdropAlpha * (1.0 - cover);
  gl_FragColor = vec4(lit + uBackdrop * rest, cover + rest) * uOpacity;
}
`;

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

const subscribeToScreen = () => () => {};

const readScreenDpr = () => window.devicePixelRatio || 1;

const isClear = (paint: string) => {
  const tidy = paint.trim().toLowerCase();
  return tidy === 'transparent' || tidy === 'none' || tidy === '';
};

interface SwingState {
  x: number;
  y: number;
  toX: number;
  toY: number;
}

interface OrbCoreProps {
  awake: boolean;
  ceiling: number;
  readSwing: () => SwingState;
  radius: number;
  turbulence: number;
  noiseScale: number;
  flowSpeed: number;
  octaves: number;
  roughness: number;
  lacunarity: number;
  steps: number;
  stride: number;
  zoom: number;
  maskRadius: number;
  maskFeather: number;
  colorA: string;
  colorB: string;
  colorC: string;
  rimStrength: number;
  rimPower: number;
  specularColorA: string;
  specularColorB: string;
  specularStrength: number;
  specularSharpness: number;
  glowStrength: number;
  glowFalloff: number;
  gamma: number;
  brightness: number;
  opacity: number;
  backgroundColor: string;
  cursorInteraction: boolean;
  cursorLight: number;
  adaptiveQuality: boolean;
  targetFps: number;
  paused: boolean;
  calm: boolean;
}

const OrbCore = ({
  awake,
  ceiling,
  readSwing,
  radius,
  turbulence,
  noiseScale,
  flowSpeed,
  octaves,
  roughness,
  lacunarity,
  steps,
  stride,
  zoom,
  maskRadius,
  maskFeather,
  colorA,
  colorB,
  colorC,
  rimStrength,
  rimPower,
  specularColorA,
  specularColorB,
  specularStrength,
  specularSharpness,
  glowStrength,
  glowFalloff,
  gamma,
  brightness,
  opacity,
  backgroundColor,
  cursorInteraction,
  cursorLight,
  adaptiveQuality,
  targetFps,
  paused,
  calm,
}: OrbCoreProps) => {
  const { gl, invalidate, setDpr } = useThree();
  const materialRef = useRef<THREE.ShaderMaterial | null>(null);
  const elapsed = useRef(0);
  const budget = useRef({
    scale: ceiling,
    frames: 0,
    span: 0,
    wins: 0,
    roof: Infinity,
  });

  const field = useMemo(() => {
    const bands = clamp(Math.round(octaves), 1, 5);
    const decay = clamp(roughness, 0.05, 0.95);
    const climb = Math.max(lacunarity, 1.1);
    let amp = 1;
    let total = 0;
    for (let i = 0; i < bands; i++) {
      total += amp;
      amp *= decay;
    }
    return { bands, decay, climb, norm: 1 / total };
  }, [octaves, roughness, lacunarity]);

  useEffect(() => {
    const meter = budget.current;
    meter.scale = ceiling;
    meter.roof = Infinity;
    meter.wins = 0;
    setDpr(ceiling);
  }, [ceiling, setDpr]);

  const uniforms = useMemo(
    () => ({
      uBands: { value: 3 },
      uDecay: { value: 0.5 },
      uClimb: { value: 2 },
      uNorm: { value: 1 },
      uCanvas: { value: new THREE.Vector2(1, 1) },
      uClock: { value: 0 },
      uCore: { value: 0.35 },
      uSwell: { value: 0.3 },
      uGrain: { value: 1 },
      uFlow: { value: 0.3 },
      uSteps: { value: 32 },
      uStride: { value: 1 },
      uZoom: { value: 1 },
      uMaskRadius: { value: 1 },
      uMaskFeather: { value: 0.02 },
      uInkA: { value: new THREE.Color('#4da6ff') },
      uInkB: { value: new THREE.Color('#9959ff') },
      uInkC: { value: new THREE.Color('#6680ff') },
      uRim: { value: 0.75 },
      uRimShape: { value: 3 },
      uSheenA: { value: new THREE.Color('#669fff') },
      uSheenB: { value: new THREE.Color('#998fff') },
      uSheen: { value: 1 },
      uSheenTight: { value: 12 },
      uHaze: { value: 1 },
      uHazeTight: { value: 32 },
      uGamma: { value: 1.25 },
      uGain: { value: 1 },
      uOpacity: { value: 1 },
      uBackdrop: { value: new THREE.Color('#0a0a0a') },
      uBackdropAlpha: { value: 1 },
      uSwing: { value: new THREE.Vector2(0, 0) },
    }),
    [],
  );

  useFrame((_, delta) => {
    const material = materialRef.current;
    if (!material || !awake) return;

    const beat = Math.min(delta, 0.05);
    const still = paused || calm;
    if (!still) elapsed.current += beat;

    const u = material.uniforms;
    const buffer = gl.getDrawingBufferSize(new THREE.Vector2());
    u['uBands']!.value = field.bands;
    u['uDecay']!.value = field.decay;
    u['uClimb']!.value = field.climb;
    u['uNorm']!.value = field.norm;
    (u['uCanvas']!.value as THREE.Vector2).set(Math.max(buffer.x, 1), Math.max(buffer.y, 1));
    u['uClock']!.value = elapsed.current;
    u['uCore']!.value = Math.max(radius, 0.02);
    u['uSwell']!.value = Math.max(turbulence, 0);
    u['uGrain']!.value = Math.max(noiseScale, 0.05);
    u['uFlow']!.value = flowSpeed;
    u['uSteps']!.value = clamp(Math.round(steps), 4, 96);
    u['uStride']!.value = clamp(stride, 0.25, 1.5);
    u['uZoom']!.value = Math.max(zoom, 0.1);
    u['uMaskRadius']!.value = Math.max(maskRadius, 0.05);
    u['uMaskFeather']!.value = clamp(maskFeather, 0.001, 1);
    (u['uInkA']!.value as THREE.Color).set(colorA);
    (u['uInkB']!.value as THREE.Color).set(colorB);
    (u['uInkC']!.value as THREE.Color).set(colorC);
    u['uRim']!.value = Math.max(rimStrength, 0);
    u['uRimShape']!.value = Math.max(rimPower, 0.2);
    (u['uSheenA']!.value as THREE.Color).set(specularColorA);
    (u['uSheenB']!.value as THREE.Color).set(specularColorB);
    u['uSheen']!.value = Math.max(specularStrength, 0);
    u['uSheenTight']!.value = Math.max(specularSharpness, 1);
    u['uHaze']!.value = Math.max(glowStrength, 0);
    u['uHazeTight']!.value = Math.max(glowFalloff, 1);
    u['uGamma']!.value = clamp(gamma, 0.2, 4);
    u['uGain']!.value = Math.max(brightness, 0);
    u['uOpacity']!.value = clamp(opacity, 0, 1);

    if (isClear(backgroundColor)) {
      u['uBackdropAlpha']!.value = 0;
    } else {
      u['uBackdropAlpha']!.value = 1;
      (u['uBackdrop']!.value as THREE.Color).set(backgroundColor);
    }

    const swing = readSwing();
    swing.x += (swing.toX - swing.x) * Math.min(beat * 4, 1);
    swing.y += (swing.toY - swing.y) * Math.min(beat * 4, 1);
    if (cursorInteraction) {
      (u['uSwing']!.value as THREE.Vector2).set(swing.x * cursorLight, swing.y * cursorLight);
    } else {
      (u['uSwing']!.value as THREE.Vector2).set(0, 0);
    }

    const meter = budget.current;
    meter.frames += 1;
    meter.span += delta;
    if (meter.span >= 0.75) {
      const fps = meter.frames / meter.span;
      meter.frames = 0;
      meter.span = 0;
      if (adaptiveQuality && elapsed.current > 0.5) {
        if (fps < targetFps * 0.85 && meter.scale > 0.5) {
          meter.roof = meter.scale;
          meter.scale = Math.max(0.5, meter.scale * 0.75);
          meter.wins = 0;
          setDpr(meter.scale);
        } else if (fps >= targetFps * 0.95 && meter.scale < ceiling) {
          meter.wins += 1;
          const next = Math.min(ceiling, meter.scale * 1.25);
          if (meter.wins >= 3 && next < meter.roof * 0.98) {
            meter.scale = next;
            meter.wins = 0;
            setDpr(next);
          }
        } else {
          meter.wins = 0;
        }
      }
    }

    // A still orb (paused or reduced-motion) renders once per external
    // invalidation (prop changes auto-invalidate in demand mode) instead of
    // self-perpetuating a 60fps loop over a static image.
    if (!still) invalidate();
  });

  return (
    <mesh frustumCulled={false}>
      <planeGeometry args={[2, 2]} />
      <shaderMaterial
        ref={materialRef}
        uniforms={uniforms}
        vertexShader={orbVertex}
        fragmentShader={orbFragment}
        transparent
        premultipliedAlpha
        depthTest={false}
        depthWrite={false}
      />
    </mesh>
  );
};

const SpecterOrb = ({
  width = '100%',
  height = '100%',
  className,
  children,
  radius = 0.35,
  turbulence = 0.3,
  noiseScale = 1,
  flowSpeed = 0.3,
  octaves = 3,
  roughness = 0.5,
  lacunarity = 2,
  steps = 32,
  stride = 1,
  zoom = 1,
  maskRadius = 1,
  maskFeather = 0.02,
  colorA = '#4da6ff',
  colorB = '#9959ff',
  colorC = '#6680ff',
  rimStrength = 0.75,
  rimPower = 3,
  specularColorA = '#669fff',
  specularColorB = '#998fff',
  specularStrength = 1,
  specularSharpness = 12,
  glowStrength = 1,
  glowFalloff = 32,
  gamma = 1.25,
  brightness = 1,
  opacity = 1,
  backgroundColor = '#0a0a0a',
  cursorInteraction = true,
  cursorLight = 0.35,
  adaptiveQuality = true,
  targetFps = 60,
  dpr = 2,
  paused = false,
}: SpecterOrbProps) => {
  const rootRef = useRef<HTMLDivElement | null>(null);
  const swing = useRef<SwingState>({ x: 0, y: 0, toX: 0, toY: 0 });
  const [awake, setAwake] = useState(false);
  const [calm, setCalm] = useState(false);
  const screenDpr = useSyncExternalStore(subscribeToScreen, readScreenDpr, () => 1);

  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const sync = () => setCalm(query.matches);
    sync();
    query.addEventListener('change', sync);
    return () => query.removeEventListener('change', sync);
  }, []);

  useEffect(() => {
    const node = rootRef.current;
    if (!node) return;
    const watcher = new IntersectionObserver(([entry]) => setAwake(!!entry?.isIntersecting), {
      rootMargin: '120px',
    });
    watcher.observe(node);
    return () => watcher.disconnect();
  }, []);

  const readSwing = useCallback(() => swing.current, []);

  const aimAt = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    const node = rootRef.current;
    if (!node) return;
    const box = node.getBoundingClientRect();
    if (!box.width || !box.height) return;
    swing.current.toX = (event.clientX - box.left) / box.width - 0.5;
    swing.current.toY = 0.5 - (event.clientY - box.top) / box.height;
  }, []);

  const release = useCallback(() => {
    swing.current.toX = 0;
    swing.current.toY = 0;
  }, []);

  const ceiling = useMemo(() => clamp(Math.min(screenDpr, dpr), 0.5, 2), [screenDpr, dpr]);

  return (
    <div
      ref={rootRef}
      className={cn('relative overflow-hidden', className)}
      style={{
        width,
        height,
        backgroundColor: isClear(backgroundColor) ? undefined : backgroundColor,
      }}
      onPointerMove={cursorInteraction ? aimAt : undefined}
      onPointerLeave={cursorInteraction ? release : undefined}
    >
      <Canvas
        className="absolute inset-0"
        dpr={ceiling}
        frameloop={awake && !paused && !calm ? 'always' : 'demand'}
        gl={{
          antialias: false,
          alpha: true,
          powerPreference: 'high-performance',
        }}
        orthographic
      >
        <OrbCore
          awake={awake}
          ceiling={ceiling}
          readSwing={readSwing}
          radius={radius}
          turbulence={turbulence}
          noiseScale={noiseScale}
          flowSpeed={flowSpeed}
          octaves={octaves}
          roughness={roughness}
          lacunarity={lacunarity}
          steps={steps}
          stride={stride}
          zoom={zoom}
          maskRadius={maskRadius}
          maskFeather={maskFeather}
          colorA={colorA}
          colorB={colorB}
          colorC={colorC}
          rimStrength={rimStrength}
          rimPower={rimPower}
          specularColorA={specularColorA}
          specularColorB={specularColorB}
          specularStrength={specularStrength}
          specularSharpness={specularSharpness}
          glowStrength={glowStrength}
          glowFalloff={glowFalloff}
          gamma={gamma}
          brightness={brightness}
          opacity={opacity}
          backgroundColor={backgroundColor}
          cursorInteraction={cursorInteraction}
          cursorLight={cursorLight}
          adaptiveQuality={adaptiveQuality}
          targetFps={targetFps}
          paused={paused}
          calm={calm}
        />
      </Canvas>
      {children ? <div className="relative z-10 h-full w-full">{children}</div> : null}
    </div>
  );
};

export default SpecterOrb;
