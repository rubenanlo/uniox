import { useEffect, useRef } from 'react';
import { useIsDark } from '../../lib/useIsDark';
import { useUi } from '../../state/store';

/**
 * The Sprint board's header wash: Turnout's terrain ridge (sdsn-crm
 * src/pages/home.ts, the app-head "terrain" canvas), ported as-is. A grid of
 * short line segments drapes over four broad seeded hills with small waves
 * riding the ridges; a focus band keeps mid-distance lines crisp while near
 * and far ones blur and dim, and light catches surfaces seen edge-on.
 *
 * Lines take the theme's aqua, accent and violet across the width (like
 * Home's wave); glints are paper white in dark and deep ink in light.
 *
 * Cost rules (as HalftoneWave): the loop runs only while the window is
 * focused and visible, at ~30fps, and draws one still frame otherwise or
 * under reduced motion.
 */
const COLS = 192;
const ROWS = 112;
const INSTANCES = COLS * ROWS * 2;
const FRAME_MS = 33;
// Turnout seeds with this slug, so the landscape is the same one.
const SEED = 'react-ios-app-folder';

function hashSeed(n: string): number {
  if (!n) return 0;
  let e = 2166136261;
  for (let i = 0; i < n.length; i++) e = Math.imul(e ^ n.charCodeAt(i), 16777619);
  e = Math.imul(e ^ (e >>> 16), 2246822507);
  e = Math.imul(e ^ (e >>> 13), 3266489909);
  e ^= e >>> 16;
  return Math.fround(((e >>> 0) / 4294967296) * 4096);
}
const hillPart = (t: string, s: string, lo: number, hi: number) =>
  Math.fround(lo + (hashSeed(`${SEED}:terrain:${t}:${s}`) / 4096) * (hi - lo));
type Range = [number, number];
const hill = (t: string, x: Range, depth: Range, height: Range, width: Range) => [
  hillPart(t, 'x', x[0], x[1]),
  hillPart(t, 'depth', depth[0], depth[1]),
  hillPart(t, 'height', height[0], height[1]),
  hillPart(t, 'width', width[0], width[1]),
];
const HILLS = {
  A: hill('a', [-4.6, -1.4], [0.2, 2.4], [0.65, 1.55], [0.34, 0.74]),
  B: hill('b', [0, 3.8], [-0.5, 2.2], [0.55, 1.45], [0.36, 0.8]),
  C: hill('c', [-2.6, 1.4], [-3.2, -1.1], [0.4, 1.2], [0.36, 0.72]),
  D: hill('d', [2.1, 5], [-3.7, -1.3], [0.4, 1.15], [0.35, 0.72]),
};

const VS = `precision highp float;
attribute vec2 aCorner; attribute float aId;
uniform float uT; uniform float uPhase; uniform vec2 uRes;
uniform vec4 uField; uniform float uSize;
uniform vec4 uHillA; uniform vec4 uHillB; uniform vec4 uHillC; uniform vec4 uHillD;
varying float vAcross; varying vec2 vScreen; varying float vLight;
varying float vDepth; varying float vOpacity; varying float vEnergy;
const float COLS = 192.0; const float ROWS = 112.0;
vec3 terrainAt(vec2 p) {
  float t = (uT + uPhase) * 0.075;
  vec2 a = p - (uHillA.xy + vec2(sin(t) * 0.32, cos(t * 0.8) * 0.25));
  vec2 b = p - (uHillB.xy + vec2(cos(t * 0.7) * 0.38, sin(t * 0.9) * 0.35));
  vec2 c = p - (uHillC.xy + vec2(sin(t * 0.6) * 0.30, 0.0));
  vec2 d = p - (uHillD.xy + vec2(0.0, cos(t) * 0.25));
  vec2 wa = uHillA.w * vec2(1.0, 1.35);
  vec2 wb = uHillB.w * vec2(1.0, 1.11);
  vec2 wc = uHillC.w * vec2(1.0, 1.40);
  vec2 wd = uHillD.w * vec2(1.0, 1.35);
  float ha = uHillA.z * exp(-dot(a * wa, a * wa));
  float hb = uHillB.z * exp(-dot(b * wb, b * wb));
  float hc = uHillC.z * exp(-dot(c * wc, c * wc));
  float hd = uHillD.z * exp(-dot(d * wd, d * wd));
  float phaseA = p.x * 3.2 + p.y * 2.3 + t;
  float phaseB = p.x * 6.1 - p.y * 4.7 - t * 0.8;
  float phaseC = p.x * 0.85 + p.y * 1.2 - t;
  float detail = 0.035 * sin(phaseA) + 0.015 * sin(phaseB) + 0.10 * sin(phaseC);
  vec2 slope = -2.0 * (ha * a * wa * wa + hb * b * wb * wb + hc * c * wc * wc + hd * d * wd * wd)
    + 0.035 * cos(phaseA) * vec2(3.2, 2.3)
    + 0.015 * cos(phaseB) * vec2(6.1, -4.7)
    + 0.10 * cos(phaseC) * vec2(0.85, 1.2);
  return vec3(ha + hb + hc + hd + detail, slope);
}
float focusAt(float d) { return 1.0 - smoothstep(0.07, 0.38, abs(d - 0.58)); }
vec4 pointAt(vec2 cell) {
  vec2 uv = cell / vec2(COLS, ROWS);
  vec2 p = (uv - 0.5) * vec2(12.0, 8.0);
  vec3 terr = terrainAt(p);
  float persp = 0.65 + uv.y * 0.80;
  vec2 pos = vec2(p.x / 5.0 * persp, mix(-0.50, 1.50, uv.y) - terr.x * 0.68 * persp);
  float hspan = max(uField.z, uField.w * 2.2);
  float narrow = 1.0 - uField.z / hspan;
  vec2 screen = uField.xy + vec2((pos.x - narrow * 0.30) * hspan, pos.y * uField.w);
  vec3 normal = normalize(vec3(-terr.y, 1.0, -terr.z));
  vec3 view = normalize(vec3(-p.x * 0.045, 0.42, 1.0));
  float focus = focusAt(uv.y);
  float light = pow(1.0 - abs(dot(normal, view)), 4.0) * focus * focus * focus;
  return vec4(screen, light, uv.y);
}
void main() {
  float crossv = mod(aId, 2.0);
  float cellId = floor(aId / 2.0);
  vec2 cell = vec2(mod(cellId, COLS), floor(cellId / COLS));
  vec2 toNext = crossv > 0.5 ? vec2(0.0, 1.0) : vec2(1.0, 0.0);
  vec4 a = pointAt(cell);
  vec4 b = pointAt(cell + toNext);
  vec2 delta = b.xy - a.xy;
  vec2 dir = delta / max(length(delta), 0.001);
  float along = aCorner.x * 0.5 + 0.5;
  float depth = mix(a.w, b.w, along);
  float sigma = uSize * (0.32 + (1.0 - focusAt(depth)) * 2.16);
  vec2 position = mix(a.xy, b.xy, along) + vec2(-dir.y, dir.x) * aCorner.y * sigma * 3.0;
  gl_Position = vec4(position / uRes * vec2(2.0, -2.0) + vec2(-1.0, 1.0), 0.0, 1.0);
  vAcross = aCorner.y; vScreen = position;
  vLight = mix(a.z, b.z, along); vDepth = depth;
  vOpacity = crossv > 0.5 ? 0.14 : 0.72;
  vEnergy = max(min(1.0, uSize * 0.34 / sigma), 0.24);
}`;

const FS = `precision mediump float;
uniform highp float uT; uniform highp vec4 uField;
uniform vec3 uAccent; uniform vec3 uWarm; uniform vec3 uMid; uniform vec3 uCool;
varying float vAcross; varying vec2 vScreen; varying float vLight;
varying float vDepth; varying float vOpacity; varying float vEnergy;
float fieldVisibility(vec2 pos) {
  vec2 inset = uField.zw - abs(pos - uField.xy);
  vec2 fade = clamp(uField.zw * vec2(0.24, 0.52), vec2(48.0), vec2(160.0));
  vec2 vis = smoothstep(vec2(0.0), fade, inset);
  return vis.x * vis.y;
}
void main() {
  float shape = exp(-4.5 * vAcross * vAcross);
  float distanceFade = smoothstep(0.0, 0.20, vDepth) * (0.60 + vDepth * 0.40);
  float light = 0.50 + vLight * 1.20;
  float alpha = min(1.0, shape * vEnergy * vOpacity * distanceFade * light
    * fieldVisibility(vScreen) * smoothstep(0.0, 1.2, uT));
  float x = clamp(vScreen.x / max(uField.z * 2.0, 1.0), 0.0, 1.0);
  vec3 line = x < 0.5 ? mix(uWarm, uMid, x * 2.0) : mix(uMid, uCool, x * 2.0 - 1.0);
  vec3 colour = mix(line * 0.70, uAccent, vLight * 0.78);
  gl_FragColor = vec4(colour * alpha, alpha);
}`;

function rgbOf(probe: CanvasRenderingContext2D, css: string): [number, number, number] {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css.trim() || '#000';
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [(d[0] ?? 0) / 255, (d[1] ?? 0) / 255, (d[2] ?? 0) / 255];
}

export function TerrainField({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accent = useUi((s) => s.accentColor);
  const darkPalette = useUi((s) => s.darkPalette);
  const lightPalette = useUi((s) => s.lightPalette);
  const dark = useIsDark();
  // Re-read colours on the next frame: App writes --color-accent after us.
  const paletteDirty = useRef(true);
  const redraw = useRef<() => void>(() => {});
  useEffect(() => {
    paletteDirty.current = true;
    redraw.current();
  }, [accent, dark, darkPalette, lightPalette]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext('webgl', { alpha: true, premultipliedAlpha: true });
    const ext = gl?.getExtension('ANGLE_instanced_arrays');
    if (!gl || !ext) return;

    const sh = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null;
    };
    const vs = sh(gl.VERTEX_SHADER, VS);
    const fs = sh(gl.FRAGMENT_SHADER, FS);
    if (!vs || !fs) return;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs);
    gl.attachShader(prog, fs);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    // one quad's corners, instanced once per grid edge
    const corners = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, corners);
    gl.bufferData(
      gl.ARRAY_BUFFER,
      new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
      gl.STATIC_DRAW,
    );
    const aCorner = gl.getAttribLocation(prog, 'aCorner');
    gl.enableVertexAttribArray(aCorner);
    gl.vertexAttribPointer(aCorner, 2, gl.FLOAT, false, 0, 0);
    const ids = new Float32Array(INSTANCES);
    for (let i = 0; i < INSTANCES; i++) ids[i] = i;
    const idBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, idBuf);
    gl.bufferData(gl.ARRAY_BUFFER, ids, gl.STATIC_DRAW);
    const aId = gl.getAttribLocation(prog, 'aId');
    gl.enableVertexAttribArray(aId);
    gl.vertexAttribPointer(aId, 1, gl.FLOAT, false, 0, 0);
    ext.vertexAttribDivisorANGLE(aId, 1);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const u = (n: string) => gl.getUniformLocation(prog, n);
    const uT = u('uT');
    const uRes = u('uRes');
    const uField = u('uField');
    const uAccent = u('uAccent');
    const uWarm = u('uWarm');
    const uMid = u('uMid');
    const uCool = u('uCool');
    gl.uniform1f(u('uPhase'), hashSeed(SEED));
    gl.uniform1f(u('uSize'), 1.25);
    gl.uniform4fv(u('uHillA'), HILLS.A);
    gl.uniform4fv(u('uHillB'), HILLS.B);
    gl.uniform4fv(u('uHillC'), HILLS.C);
    gl.uniform4fv(u('uHillD'), HILLS.D);
    // Line colours follow the theme like Home's wave: aqua, the accent and
    // violet across the width. Glints stay Turnout's paper white in dark
    // and turn deep ink in light so they read on warm paper.
    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const readPalette = () => {
      if (!probe) return;
      const css = getComputedStyle(cv);
      const dark = document.documentElement.classList.contains('dark');
      gl.uniform3f(uWarm, ...rgbOf(probe, css.getPropertyValue('--color-aqua')));
      gl.uniform3f(uMid, ...rgbOf(probe, css.getPropertyValue('--color-accent')));
      gl.uniform3f(uCool, ...rgbOf(probe, css.getPropertyValue('--color-violet')));
      if (dark) gl.uniform3f(uAccent, 0.92757, 0.92224, 0.89912);
      else gl.uniform3f(uAccent, 0.09, 0.13, 0.27);
    };

    const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    // start a little in so the fade-in (uT 0 to 1.2s) has finished when still
    let t = still ? 4 : 0;
    let raf = 0;
    let running = false;
    let last = 0;
    let lastDraw = 0;
    let disposed = false;
    const draw = () => {
      // StrictMode's dev remount shares the GL context; a frame queued by the
      // first mount must not touch the second mount's program.
      if (disposed) return;
      if (paletteDirty.current) {
        paletteDirty.current = false;
        readPalette();
      }
      gl.uniform1f(uT, t);
      gl.clear(gl.COLOR_BUFFER_BIT);
      ext.drawArraysInstancedANGLE(gl.TRIANGLES, 0, 6, INSTANCES);
    };
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const delta = last ? Math.min(now - last, 50) : 0;
      last = now;
      t += delta / 1000;
      if (now - lastDraw < FRAME_MS) return;
      lastDraw = now;
      draw();
    };
    const redrawOnce = () => {
      if (!running && !raf) raf = requestAnimationFrame(() => ((raf = 0), draw()));
    };
    const start = () => {
      if (still) return redrawOnce();
      if (running || document.hidden || !document.hasFocus()) return;
      running = true;
      cancelAnimationFrame(raf);
      last = 0;
      raf = requestAnimationFrame(frame);
    };
    const stop = () => {
      running = false;
      cancelAnimationFrame(raf);
      raf = 0;
    };

    // geometry lives in CSS pixels; the buffer runs at up to 1.5x
    const resize = () => {
      const w = Math.max(1, cv.clientWidth);
      const h = Math.max(1, cv.clientHeight);
      const s = Math.min(window.devicePixelRatio || 1, 1.5);
      const bw = Math.max(1, Math.round(w * s));
      const bh = Math.max(1, Math.round(h * s));
      if (cv.width !== bw || cv.height !== bh) {
        cv.width = bw;
        cv.height = bh;
      }
      gl.viewport(0, 0, bw, bh);
      gl.uniform2f(uRes, w, h);
      gl.uniform4f(uField, w / 2, h / 2, w / 2, h / 2);
      redrawOnce();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);
    redraw.current = redrawOnce;

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', stop);
    window.addEventListener('focus', start);
    start();
    if (!running) redrawOnce();

    return () => {
      disposed = true;
      paletteDirty.current = true;
      stop();
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', stop);
      window.removeEventListener('focus', start);
      gl.deleteBuffer(corners);
      gl.deleteBuffer(idBuf);
      gl.deleteProgram(prog);
      gl.deleteShader(vs);
      gl.deleteShader(fs);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
