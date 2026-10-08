import { useEffect, useRef } from 'react';
import { useIsDark } from '../lib/useIsDark';
import { useUi } from '../state/store';

/*
 * The halftone dash-wave from sdsn-crm's Admin masthead (motion.dev/plus's
 * header): a 144x64 staggered grid of small leaning strokes riding a slowly
 * bending surface, each stroke growing in around its own centre on arrival
 * and lit where the crest passes. The surface math is the original's; the
 * palette runs aqua -> accent -> violet so it echoes the greeting and follows
 * the accent picked in Settings. It only moves while the window has focus;
 * in the background it holds its last frame and costs nothing.
 */
const VS = `
attribute vec2 aFlow;
attribute vec2 aCorner;
uniform vec2 uSize;
uniform float uTime;
uniform float uReveal;
varying vec2 vLocal;
varying float vLight;
varying float vAlpha;
varying float vGradient;
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
vec2 surface(float x, float row) {
  float phase = uTime * 0.13;
  float bend = sin(x * 2.1 + row * 0.7 + phase) * 0.37;
  float y = bend + row * 0.30;
  y += sin(x * 4.2 - row * 1.5 - phase * 0.7) * 0.065;
  float z = sin(x * 1.8 + row * 2.1 + phase * 0.4);
  return vec2(x + z * 0.035, y + z * row * 0.05);
}
void main() {
  float x = aFlow.x;
  float row = aFlow.y;
  float seed = hash(aFlow);
  vec2 p = surface(x, row);
  vec2 next = surface(x + 0.014, row);
  vec2 tangent = normalize((next - p) * uSize);
  float entrance = smoothstep(seed * 0.6, 0.9 + seed * 0.6, uReveal);
  float depth = 0.5 + 0.5 * sin(x * 1.8 + row * 2.1 + uTime * 0.052);
  vec2 direction = normalize(mix(vec2(0.52, 0.85), tangent, 0.65));
  vec2 normal = vec2(-direction.y, direction.x);
  float halfLength = 2.0 + depth * 2.2;
  float width = 0.6 + depth * 0.35;
  vec2 offset = direction * aCorner.x * halfLength + normal * aCorner.y * width;
  gl_Position = vec4(p + offset * entrance * 2.0 / uSize, 0.0, 1.0);
  vLocal = aCorner;
  float edge = 1.0 - smoothstep(0.7, 1.0, abs(row));
  float crest = pow(0.5 + 0.5 * sin(x * 1.65 + row * 2.0 + uTime * 0.052), 5.0);
  vLight = 0.45 + crest * 0.9;
  vAlpha = edge * entrance * (0.20 + depth * 0.42);
  vGradient = clamp(0.5 + p.x * 0.50 - p.y * 0.10, 0.0, 1.0);
}`;

const FS = `
precision mediump float;
uniform vec3 uWarm;
uniform vec3 uMid;
uniform vec3 uCool;
uniform vec3 uPaper;
varying vec2 vLocal;
varying float vLight;
varying float vAlpha;
varying float vGradient;
void main() {
  float stroke = (1.0 - smoothstep(0.25, 1.0, abs(vLocal.y)))
    * (1.0 - smoothstep(0.78, 1.0, abs(vLocal.x)));
  vec3 cool = mix(uMid, uCool, 0.55);
  vec3 pigment = vGradient < 0.46
    ? mix(uWarm, uMid, smoothstep(0.0, 0.46, vGradient))
    : mix(uMid, cool, smoothstep(0.46, 1.0, vGradient));
  vec3 colour = pigment * mix(0.68, 1.0, min(vLight, 1.0));
  colour = mix(colour, uPaper, max(0.0, vLight - 1.0) * 0.35);
  gl_FragColor = vec4(colour, stroke * vAlpha);
}`;

const COLS = 144;
const ROWS = 64;
const CORNERS: [number, number][] = [
  [-1, -1],
  [1, -1],
  [-1, 1],
  [-1, 1],
  [1, -1],
  [1, 1],
];
/** Past this many seconds every stroke stands; only the surface still moves. */
const ENTRANCE_S = 1.6;
/** After the entrance the surface drifts slowly enough that ~24fps reads as
 *  smooth, and it keeps Home off a 60fps GPU loop. */
const DRIFT_FRAME_MS = 1000 / 24;

function buildGrid(): Float32Array {
  const verts = new Float32Array(COLS * ROWS * 6 * 4);
  let vi = 0;
  for (let r = 0; r < ROWS; r++) {
    for (let col = 0; col < COLS; col++) {
      // odd rows staggered half a cell
      const fx = -1.4 + ((col + (r % 2) * 0.5) / (COLS - 1)) * 2.8;
      const fr = -1 + (r / (ROWS - 1)) * 2;
      for (const [cx, cy] of CORNERS) {
        verts[vi++] = fx;
        verts[vi++] = fr;
        verts[vi++] = cx;
        verts[vi++] = cy;
      }
    }
  }
  return verts;
}

/** Any CSS colour (hex, oklch, ...) as 0..1 sRGB, via a 1px canvas. */
function rgbOf(probe: CanvasRenderingContext2D, css: string): [number, number, number] {
  probe.clearRect(0, 0, 1, 1);
  probe.fillStyle = '#000';
  probe.fillStyle = css.trim() || '#000';
  probe.fillRect(0, 0, 1, 1);
  const d = probe.getImageData(0, 0, 1, 1).data;
  return [(d[0] ?? 0) / 255, (d[1] ?? 0) / 255, (d[2] ?? 0) / 255];
}

export function HalftoneWave({ className }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const accent = useUi((s) => s.accentColor);
  const dark = useIsDark();
  // Colours are re-read on the next frame rather than in this effect: App's
  // effect that writes --color-accent runs after ours (parents last).
  const paletteDirty = useRef(true);
  const redraw = useRef<() => void>(() => {});

  useEffect(() => {
    paletteDirty.current = true;
    redraw.current();
  }, [accent, dark]);

  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const gl = cv.getContext('webgl', { alpha: true, antialias: false, premultipliedAlpha: true });
    if (!gl) return;

    const prog = gl.createProgram();
    for (const [type, src] of [
      [gl.VERTEX_SHADER, VS],
      [gl.FRAGMENT_SHADER, FS],
    ] as const) {
      const sh = gl.createShader(type);
      if (!sh) return;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) return;
      gl.attachShader(prog, sh);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) return;
    gl.useProgram(prog);

    const verts = buildGrid();
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
    gl.bufferData(gl.ARRAY_BUFFER, verts, gl.STATIC_DRAW);
    for (const [name, offset] of [
      ['aFlow', 0],
      ['aCorner', 8],
    ] as const) {
      const loc = gl.getAttribLocation(prog, name);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 16, offset);
    }
    const uTime = gl.getUniformLocation(prog, 'uTime');
    const uReveal = gl.getUniformLocation(prog, 'uReveal');
    const uSize = gl.getUniformLocation(prog, 'uSize');
    const uWarm = gl.getUniformLocation(prog, 'uWarm');
    const uMid = gl.getUniformLocation(prog, 'uMid');
    const uCool = gl.getUniformLocation(prog, 'uCool');
    gl.uniform3f(gl.getUniformLocation(prog, 'uPaper'), 0.92757, 0.92224, 0.89912);
    gl.enable(gl.BLEND);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.clearColor(0, 0, 0, 0);

    const probe = document.createElement('canvas').getContext('2d', { willReadFrequently: true });
    const readPalette = () => {
      if (!probe) return;
      const css = getComputedStyle(cv);
      gl.uniform3f(uWarm, ...rgbOf(probe, css.getPropertyValue('--color-aqua')));
      gl.uniform3f(uMid, ...rgbOf(probe, css.getPropertyValue('--color-accent')));
      gl.uniform3f(uCool, ...rgbOf(probe, css.getPropertyValue('--color-violet')));
    };

    let t = 0;
    let raf = 0;
    let running = false;
    const draw = () => {
      if (paletteDirty.current) {
        paletteDirty.current = false;
        readPalette();
      }
      gl.uniform1f(uTime, t);
      gl.uniform1f(uReveal, t);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.drawArrays(gl.TRIANGLES, 0, verts.length / 4);
    };

    // Reduced motion slows the wave rather than stopping it (the original's
    // rule).
    const slow = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    let last = 0;
    let lastDraw = 0;
    const frame = (now: number) => {
      raf = requestAnimationFrame(frame);
      const delta = last ? Math.min(now - last, 40) : 0;
      last = now;
      t += (delta / 1000) * (slow ? 0.3 : 1);
      if (t > ENTRANCE_S && now - lastDraw < DRIFT_FRAME_MS) return;
      lastDraw = now;
      draw();
    };
    const start = () => {
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
    // While stopped, resize and palette changes still need one fresh frame.
    // It waits a frame so App has written --color-accent by then.
    const redrawOnce = () => {
      if (!running && !raf) raf = requestAnimationFrame(() => ((raf = 0), draw()));
    };
    redraw.current = redrawOnce;

    const resize = () => {
      const dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      const w = Math.max(1, Math.round(cv.clientWidth * dpr));
      const h = Math.max(1, Math.round(cv.clientHeight * dpr));
      if (cv.width !== w || cv.height !== h) {
        cv.width = w;
        cv.height = h;
        gl.viewport(0, 0, w, h);
      }
      gl.uniform2f(uSize, Math.max(1, cv.clientWidth), Math.max(1, cv.clientHeight));
      redrawOnce();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(cv);

    const onVisibility = () => (document.hidden ? stop() : start());
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', stop);
    window.addEventListener('focus', start);
    start();

    return () => {
      stop();
      redraw.current = () => {};
      ro.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', stop);
      window.removeEventListener('focus', start);
    };
  }, []);

  return <canvas ref={ref} aria-hidden="true" className={className} />;
}
