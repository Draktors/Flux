import { useEffect, useRef } from 'react'
import type { RankStyle } from './rankStyle'

const FLOW_MS = 1200
const RESOLUTION = 0.6
const DRIFT_PER_SECOND = 0.05

const VERTEX = `attribute vec2 position;
void main() { gl_Position = vec4(position, 0.0, 1.0); }`

const FRAGMENT = `#extension GL_OES_standard_derivatives : enable
precision highp float;
uniform vec2 resolution;
uniform float time;
uniform vec3 light;
uniform vec3 main_;
uniform vec3 deep;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * f * (f * (f * 6.0 - 15.0) + 10.0);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
    u.y
  );
}

float fbm(vec2 p) {
  float value = 0.0;
  float amplitude = 0.55;
  for (int i = 0; i < 3; i++) {
    value += amplitude * noise(p);
    p = p * 1.9 + vec2(1.7, 9.2);
    amplitude *= 0.42;
  }
  return value;
}

void main() {
  vec2 uv = gl_FragCoord.xy / resolution;
  vec2 p = uv * vec2(resolution.x / resolution.y, 1.0) * vec2(0.8, 1.15);
  vec2 q = vec2(fbm(p * 0.9 + vec2(0.0, time * 0.16)), fbm(p * 0.9 + vec2(5.2, 1.3 - time * 0.1)));
  vec2 r = vec2(fbm(p + 2.1 * q + vec2(1.7, 9.2)), fbm(p + 2.1 * q + vec2(8.3, 2.8)));
  float field = fbm(p * 0.8 + 2.4 * r);

  vec2 slope = vec2(dFdx(field), dFdy(field)) * resolution.y * 0.34;
  vec3 normal = normalize(vec3(-slope, 1.0));
  vec3 lamp = normalize(vec3(-0.5, 0.62, 0.6));
  float diffuse = max(dot(normal, lamp), 0.0);
  float gloss = pow(max(dot(reflect(-lamp, normal), vec3(0.0, 0.0, 1.0)), 0.0), 14.0);

  vec3 color = mix(deep, main_, smoothstep(0.16, 0.72, field));
  color *= 0.42 + 1.0 * diffuse;
  color += light * gloss * 0.62;
  gl_FragColor = vec4(color + (hash(gl_FragCoord.xy) - 0.5) * 0.02, 1.0);
}`

type Rgb = [number, number, number]

interface Palette {
  light: Rgb
  main: Rgb
  deep: Rgb
}

function rgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

function paletteOf(style: RankStyle): Palette {
  return { light: rgb(style.light), main: rgb(style.main), deep: rgb(style.deep) }
}

function mixRgb(from: Rgb, to: Rgb, amount: number): Rgb {
  return from.map((value, index) => value + (to[index] - value) * amount) as Rgb
}

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type) as WebGLShader
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return shader
}

class Silk {
  private readonly uniforms: Record<string, WebGLUniformLocation | null>
  private palette: Palette
  private time = 3.2
  private drift = 0
  private frame = 0
  private driftFrame = 0

  constructor(
    private readonly gl: WebGLRenderingContext,
    style: RankStyle,
  ) {
    gl.getExtension('OES_standard_derivatives')
    const program = gl.createProgram() as WebGLProgram
    gl.attachShader(program, compile(gl, gl.VERTEX_SHADER, VERTEX))
    gl.attachShader(program, compile(gl, gl.FRAGMENT_SHADER, FRAGMENT))
    gl.linkProgram(program)
    gl.useProgram(program)
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer())
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
    this.uniforms = Object.fromEntries(
      ['resolution', 'time', 'light', 'main_', 'deep'].map(name => [
        name,
        gl.getUniformLocation(program, name),
      ]),
    )
    this.palette = paletteOf(style)
  }

  draw(): void {
    const { gl, uniforms, palette } = this
    gl.viewport(0, 0, gl.canvas.width, gl.canvas.height)
    gl.uniform2f(uniforms.resolution, gl.canvas.width, gl.canvas.height)
    gl.uniform1f(uniforms.time, this.time + this.drift)
    gl.uniform3fv(uniforms.light, palette.light)
    gl.uniform3fv(uniforms.main_, palette.main)
    gl.uniform3fv(uniforms.deep, palette.deep)
    gl.drawArrays(gl.TRIANGLES, 0, 3)
  }

  flowTo(style: RankStyle): void {
    cancelAnimationFrame(this.frame)
    const target = paletteOf(style)
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      this.palette = target
      this.draw()
      return
    }
    const from = this.palette
    const startTime = this.time
    const start = performance.now()
    const step = (now: number) => {
      const progress = Math.min(1, (now - start) / FLOW_MS)
      const eased = 1 - (1 - progress) ** 3
      this.palette = {
        light: mixRgb(from.light, target.light, eased),
        main: mixRgb(from.main, target.main, eased),
        deep: mixRgb(from.deep, target.deep, eased),
      }
      this.time = startTime + eased * 0.9
      this.draw()
      if (progress < 1) this.frame = requestAnimationFrame(step)
    }
    this.frame = requestAnimationFrame(step)
  }

  // Slow continuous flow of the same silk, for screens with nothing else moving
  setDrift(enabled: boolean): void {
    cancelAnimationFrame(this.driftFrame)
    if (!enabled || window.matchMedia('(prefers-reduced-motion: reduce)').matches) return
    let last = performance.now()
    const step = (now: number) => {
      this.drift += ((now - last) / 1000) * DRIFT_PER_SECOND
      last = now
      this.draw()
      this.driftFrame = requestAnimationFrame(step)
    }
    this.driftFrame = requestAnimationFrame(step)
  }

  stop(): void {
    cancelAnimationFrame(this.frame)
    cancelAnimationFrame(this.driftFrame)
  }
}

export function Stage({ style, drift = false }: { style: RankStyle; drift?: boolean }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const silk = useRef<Silk | null>(null)

  useEffect(() => {
    const element = canvas.current
    const gl = element?.getContext('webgl', { antialias: false, preserveDrawingBuffer: true })
    if (!element || !gl) return undefined
    const scene = new Silk(gl, style)
    silk.current = scene
    const resize = () => {
      const scale = RESOLUTION * window.devicePixelRatio
      element.width = Math.round(element.clientWidth * scale)
      element.height = Math.round(element.clientHeight * scale)
      scene.draw()
    }
    const observer = new ResizeObserver(resize)
    observer.observe(element)
    resize()
    return () => {
      observer.disconnect()
      scene.stop()
      silk.current = null
    }
  }, [])

  useEffect(() => {
    silk.current?.flowTo(style)
  }, [style])

  useEffect(() => {
    silk.current?.setDrift(drift)
    return () => silk.current?.setDrift(false)
  }, [drift])

  return <canvas ref={canvas} className="stage" aria-hidden="true" />
}
