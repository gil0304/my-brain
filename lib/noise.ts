/**
 * 決定的な乱数とノイズ。
 * 毎回同じ「脳」が生成されるよう、レイアウトはすべてシード付きで計算する。
 */

export type Rng = () => number

export function createRng(seed: number): Rng {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export const clamp = (v: number, min: number, max: number) => Math.min(max, Math.max(min, v))
export const lerp = (a: number, b: number, t: number) => a + (b - a) * t
export function smoothstep(edge0: number, edge1: number, x: number) {
  const t = clamp((x - edge0) / (edge1 - edge0), 0, 1)
  return t * t * (3 - 2 * t)
}

/** Ken Perlin の Improved Noise (シード付き置換表) */
export function createPerlin(seed: number) {
  const rng = createRng(seed)
  const base = Array.from({ length: 256 }, (_, i) => i)
  for (let i = 255; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[base[i], base[j]] = [base[j]!, base[i]!]
  }
  const p = new Uint8Array(512)
  for (let i = 0; i < 512; i++) p[i] = base[i & 255]!

  const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10)
  const grad = (hash: number, x: number, y: number, z: number) => {
    const h = hash & 15
    const u = h < 8 ? x : y
    const v = h < 4 ? y : h === 12 || h === 14 ? x : z
    return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v)
  }

  return function perlin3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255
    const Y = Math.floor(y) & 255
    const Z = Math.floor(z) & 255
    x -= Math.floor(x)
    y -= Math.floor(y)
    z -= Math.floor(z)
    const u = fade(x)
    const v = fade(y)
    const w = fade(z)
    const A = p[X]! + Y
    const AA = p[A]! + Z
    const AB = p[A + 1]! + Z
    const B = p[X + 1]! + Y
    const BA = p[B]! + Z
    const BB = p[B + 1]! + Z
    return lerp(
      lerp(
        lerp(grad(p[AA]!, x, y, z), grad(p[BA]!, x - 1, y, z), u),
        lerp(grad(p[AB]!, x, y - 1, z), grad(p[BB]!, x - 1, y - 1, z), u),
        v,
      ),
      lerp(
        lerp(grad(p[AA + 1]!, x, y, z - 1), grad(p[BA + 1]!, x - 1, y, z - 1), u),
        lerp(grad(p[AB + 1]!, x, y - 1, z - 1), grad(p[BB + 1]!, x - 1, y - 1, z - 1), u),
        v,
      ),
      w,
    )
  }
}
