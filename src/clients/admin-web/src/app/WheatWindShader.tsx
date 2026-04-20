import { useEffect, useRef } from 'react';
import { useTheme } from './ThemeProvider';

const VERT = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

const FRAG = `
  precision highp float;
  uniform vec2 u_res;
  uniform vec2 u_mouse;
  uniform float u_time;
  uniform vec3 u_pal0; // soil
  uniform vec3 u_pal1; // earth
  uniform vec3 u_pal2; // green
  uniform vec3 u_pal3; // sky / light
  uniform vec3 u_pal4; // accent (golden tip)

  float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p){
    vec2 i = floor(p), f = fract(p);
    vec2 u = f*f*(3.0-2.0*f);
    return mix(mix(hash(i+vec2(0,0)), hash(i+vec2(1,0)), u.x),
               mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), u.x), u.y);
  }
  float fbm(vec2 p){ float s=0.0, a=0.5; for(int i=0;i<5;i++){ s+=a*noise(p); p*=2.1; a*=0.5; } return s; }

  void main(){
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 m  = u_mouse / u_res;
    float t = u_time;

    float horizon = 0.22;

    vec3 sky = mix(u_pal2, u_pal3, smoothstep(horizon, 1.0, uv.y));
    sky += fbm(uv * 4.0 + t*0.05) * 0.04;

    float soilGrain = fbm(uv * vec2(150.0, 35.0));
    float furrow = sin(uv.y * 80.0 + fbm(uv*3.0)*4.0) * 0.5 + 0.5;
    vec3 soil = u_pal0 * (0.78 + soilGrain * 0.30);
    soil = mix(soil, soil * 0.72, furrow * 0.30);

    vec3 color = uv.y < horizon ? soil : sky;

    float stalkFreq = 180.0;
    float sx = uv.x * stalkFreq;
    float si = floor(sx);
    float sHash = hash(vec2(si, 0.0));
    float maxH = horizon + 0.04 + sHash * 0.28;
    float mx = m.x;
    float sway = sin(t*1.2 + si*0.22) * 0.012;
    sway += (uv.x - mx) * 0.035 * smoothstep(0.35, 0.0, abs(uv.x - mx));
    float sf = fract(sx + sway * stalkFreq);
    float stalkBody = smoothstep(0.14, 0.0, abs(sf - 0.5));
    float stalkAlpha = stalkBody * smoothstep(maxH, horizon, uv.y) * step(horizon, uv.y);

    float heightFactor = smoothstep(horizon, maxH, uv.y);
    vec3 stalkColor = mix(u_pal1, u_pal2, heightFactor);
    stalkColor = mix(stalkColor, u_pal4, smoothstep(0.88, 1.0, heightFactor) * 0.7);
    color = mix(color, stalkColor, stalkAlpha);

    float tipY = smoothstep(maxH-0.015, maxH, uv.y) - smoothstep(maxH, maxH+0.005, uv.y);
    color = mix(color, u_pal4, tipY * stalkBody * 0.8);

    color += u_pal3 * smoothstep(0.45, 0.0, distance(uv, m)) * 0.15;

    gl_FragColor = vec4(color, 1.0);
  }
`;

// Palettes [soil, earth, green, sky, accent]
const PALETTES: Record<string, [number, number, number][]> = {
  'fresh.light': [
    [0.42, 0.27, 0.14], [0.53, 0.63, 0.22], [0.51, 0.82, 0.73], [0.82, 0.94, 0.9], [0.0, 0.95, 0.45],
  ],
  'fresh.dark': [
    [0.07, 0.09, 0.06], [0.11, 0.20, 0.12], [0.22, 0.40, 0.34], [0.14, 0.22, 0.24], [0.0, 1.0, 0.4],
  ],
  'dusk.light': [
    [0.24, 0.14, 0.10], [0.55, 0.28, 0.12], [0.78, 0.50, 0.22], [1.00, 0.72, 0.55], [1.0, 0.58, 0.25],
  ],
  'dusk.dark': [
    [0.07, 0.05, 0.04], [0.23, 0.11, 0.05], [0.42, 0.22, 0.10], [0.20, 0.12, 0.18], [1.0, 0.6, 0.25],
  ],
};

export function WheatWindShader() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const { theme, mode } = useTheme();
  const paletteKey = `${theme}.${mode}`;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const gl = canvas.getContext('webgl', { antialias: false, premultipliedAlpha: true });
    if (!gl) return;

    const compile = (type: number, src: string) => {
      const s = gl.createShader(type)!;
      gl.shaderSource(s, src);
      gl.compileShader(s);
      return s;
    };
    const program = gl.createProgram()!;
    gl.attachShader(program, compile(gl.VERTEX_SHADER, VERT));
    gl.attachShader(program, compile(gl.FRAGMENT_SHADER, FRAG));
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return;

    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);

    let raf = 0;
    const start = performance.now();
    let mouse = [window.innerWidth / 2, window.innerHeight / 2];
    let smoothMouse: [number, number] = [mouse[0], mouse[1]];
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    const resize = () => {
      canvas.width = window.innerWidth * dpr;
      canvas.height = window.innerHeight * dpr;
      canvas.style.width = window.innerWidth + 'px';
      canvas.style.height = window.innerHeight + 'px';
    };
    resize();

    const onMove = (e: MouseEvent) => {
      mouse = [e.clientX * dpr, (window.innerHeight - e.clientY) * dpr];
    };
    window.addEventListener('resize', resize);
    window.addEventListener('mousemove', onMove);

    const render = () => {
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.useProgram(program);
      const loc = gl.getAttribLocation(program, 'a_pos');
      gl.bindBuffer(gl.ARRAY_BUFFER, buf);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);

      gl.uniform2f(gl.getUniformLocation(program, 'u_res'), canvas.width, canvas.height);
      smoothMouse[0] += (mouse[0] - smoothMouse[0]) * 0.08;
      smoothMouse[1] += (mouse[1] - smoothMouse[1]) * 0.08;
      gl.uniform2f(gl.getUniformLocation(program, 'u_mouse'), smoothMouse[0], smoothMouse[1]);
      gl.uniform1f(gl.getUniformLocation(program, 'u_time'), (performance.now() - start) / 1000);

      const pal = PALETTES[paletteKey] ?? PALETTES['fresh.light'];
      gl.uniform3fv(gl.getUniformLocation(program, 'u_pal0'), pal[0]);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_pal1'), pal[1]);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_pal2'), pal[2]);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_pal3'), pal[3]);
      gl.uniform3fv(gl.getUniformLocation(program, 'u_pal4'), pal[4]);

      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      raf = requestAnimationFrame(render);
    };
    render();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', resize);
      window.removeEventListener('mousemove', onMove);
    };
  }, [paletteKey]);

  return (
    <canvas
      ref={canvasRef}
      aria-hidden
      className="pointer-events-none fixed inset-0 z-0 h-screen w-screen"
    />
  );
}
