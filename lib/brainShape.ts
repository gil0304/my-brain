/**
 * 「遠くから見ると脳に見える」ための形状定義。
 *
 * 座標系 (脳ローカル): x = 左右 (+ が右半球), y = 上下, z = 前後 (+ が前頭葉側)
 * 大脳(左右の半球) + 小脳 + 脳幹 を陰関数(field < 0 が内側)とパラメトリック曲面で表す。
 */
import { clamp, createPerlin, createRng, smoothstep, type Rng } from './noise'

export type Vec3 = [number, number, number]

const HEMI_CX = 0.6
const HEMI_CY = 0.02
const HEMI_RZ = 1.58

const CEREBELLUM_C: Vec3 = [0, -0.66, -0.95]
const CEREBELLUM_R: Vec3 = [0.9, 0.36, 0.52]

const STEM_A: Vec3 = [0, -0.45, -0.38]
const STEM_B: Vec3 = [0, -1.5, -0.6]

/** カメラの注視点にしている脳全体のおおよその中心と半径 */
export const BRAIN_CENTER: Vec3 = [0, -0.18, 0]
export const BRAIN_RADIUS = 1.9

// ---------------------------------------------------------------- 大脳半球

/** 左右幅。前頭葉側を少し細く、内側(縦裂側)は平らに */
function hemiRx(outward: number, t: number) {
  return outward >= 0 ? 0.74 * (1 - 0.12 * t) : 0.6 * (1 - 0.06 * t)
}

/** 高さ。上は後ろ寄りが一番高いドーム、下は側頭葉が中央で垂れ下がる */
function hemiRy(outward: number, up: boolean, t: number) {
  if (up) return 1 - 0.22 * (t + 0.12) ** 2
  const temporal = Math.exp(-(((t + 0.02) / 0.42) ** 2)) * smoothstep(-0.25, 0.75, outward)
  return 0.5 + 0.37 * temporal
}

function hemiPoint(side: 1 | -1, u: Vec3) {
  const [ux, uy, uz] = u
  const outward = side * ux
  const rx = hemiRx(outward, uz)
  const ry = hemiRy(outward, uy >= 0, uz)
  const p: Vec3 = [side * HEMI_CX + ux * rx, HEMI_CY + uy * ry, uz * HEMI_RZ]
  const n = normalize([ux / rx, uy / ry, uz / HEMI_RZ])
  return { p, n, outward, t: uz }
}

function hemiField(side: 1 | -1, x: number, y: number, z: number) {
  const lx = x - side * HEMI_CX
  const t = clamp(z / HEMI_RZ, -1, 1)
  const rx = hemiRx(side * lx, t)
  const ux = clamp(lx / rx, -1, 1)
  const ry = hemiRy(side * ux, y - HEMI_CY >= 0, t)
  const qx = lx / rx
  const qy = (y - HEMI_CY) / ry
  const qz = z / HEMI_RZ
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - 1
}

// ---------------------------------------------------------------- 小脳・脳幹

function cerebellumField(x: number, y: number, z: number) {
  const qx = (x - CEREBELLUM_C[0]) / CEREBELLUM_R[0]
  const qy = (y - CEREBELLUM_C[1]) / CEREBELLUM_R[1]
  const qz = (z - CEREBELLUM_C[2]) / CEREBELLUM_R[2]
  return Math.sqrt(qx * qx + qy * qy + qz * qz) - 1
}

const stemRadius = (t: number) => 0.21 - 0.05 * t

function stemField(x: number, y: number, z: number) {
  const ab = sub(STEM_B, STEM_A)
  const ap = sub([x, y, z], STEM_A)
  const t = clamp(dot(ap, ab) / dot(ab, ab), 0, 1)
  const c = add(STEM_A, scale(ab, t))
  return length(sub([x, y, z], c)) / stemRadius(t) - 1
}

/** field < 0 なら脳の内側 (値はおおよそ正規化された距離) */
export function brainField(p: Vec3) {
  const [x, y, z] = p
  return Math.min(hemiField(1, x, y, z), hemiField(-1, x, y, z), cerebellumField(x, y, z), stemField(x, y, z))
}

/** 大脳だけの field (ノードは大脳に配置する) */
export function cerebrumField(p: Vec3) {
  return Math.min(hemiField(1, p[0], p[1], p[2]), hemiField(-1, p[0], p[1], p[2]))
}

/** 点を半球の中心方向へ少しずつ寄せて、指定の深さまで大脳の内側に入れる */
export function nudgeInside(p: Vec3, depth = 0.12): Vec3 {
  const side = p[0] >= 0 ? 1 : -1
  const anchor: Vec3 = [side * HEMI_CX * 0.9, HEMI_CY - 0.05, 0]
  let q: Vec3 = [...p]
  for (let i = 0; i < 80 && cerebrumField(q) > -depth; i++) {
    q = add(q, scale(sub(anchor, q), 0.05))
  }
  return q
}

// ---------------------------------------------------------------- 皮質の粒子

export interface CortexPoint {
  p: Vec3
  /** 脳回(盛り上がり)ほど明るい */
  shade: number
  /** 0: 大脳, 1: 小脳, 2: 脳幹 */
  part: 0 | 1 | 2
}

/**
 * 脳の表面を粒子でサンプリングする。
 * ノイズのゼロ交差を「溝(脳溝)」として間引くことで、脳のシワが浮かび上がる。
 */
export function sampleCortex(count: number, seed = 7): CortexPoint[] {
  const rng = createRng(seed)
  const perlin = createPerlin(seed + 101)
  const out: CortexPoint[] = []

  const hemiCount = Math.round(count * 0.82)
  const cerebCount = Math.round(count * 0.12)
  const stemCount = count - hemiCount - cerebCount

  // 大脳
  for (let guard = 0; out.length < hemiCount && guard < hemiCount * 30; guard++) {
    const side: 1 | -1 = rng() < 0.5 ? 1 : -1
    const { p, n, outward, t } = hemiPoint(side, randomUnit(rng))
    // 内側の壁(大脳縦裂)はまばらに
    if (outward < -0.3 && rng() > 0.22) continue
    // 反対側の半球・小脳に埋もれた点は見えないので捨てる
    if (hemiField(side === 1 ? -1 : 1, p[0], p[1], p[2]) < 0) continue
    if (cerebellumField(p[0], p[1], p[2]) < -0.05) continue

    // 脳溝: ドメインワープしたパーリンノイズのゼロ交差を溝にする
    const f = 2.35
    const wx = p[0] * f + 0.55 * perlin(p[0] * 1.3 + 11.1, p[1] * 1.3, p[2] * 1.3)
    const wy = p[1] * f + 0.55 * perlin(p[0] * 1.3, p[1] * 1.3 + 23.7, p[2] * 1.3)
    const wz = p[2] * f + 0.55 * perlin(p[0] * 1.3, p[1] * 1.3, p[2] * 1.3 + 5.3)
    const nv = perlin(wx, wy, wz) + 0.4 * perlin(wx * 2.1, wy * 2.1, wz * 2.1)
    const ridge = Math.abs(nv)
    let groove = 1 - smoothstep(0.025, 0.1, ridge)

    // 外側溝(シルビウス裂): 側頭葉を前頭・頭頂葉から分ける大きな溝
    if (outward > 0.15 && t > -0.55 && t < 0.45) {
      const ys = -0.16 - 0.42 * t
      groove = Math.max(groove, 1 - smoothstep(0.02, 0.06, Math.abs(p[1] - ys)))
    }
    if (groove > 0.5 && rng() > 0.08) continue

    const depth = groove * 0.07 + rng() ** 2 * 0.05
    out.push({
      p: sub(p, scale(n, depth)),
      shade: 0.45 + 0.55 * smoothstep(0.08, 0.45, ridge),
      part: 0,
    })
  }

  // 小脳: 横縞(小脳回)
  const cStart = out.length
  for (let guard = 0; out.length - cStart < cerebCount && guard < cerebCount * 30; guard++) {
    const u = randomUnit(rng)
    const p: Vec3 = [
      CEREBELLUM_C[0] + u[0] * CEREBELLUM_R[0],
      CEREBELLUM_C[1] + u[1] * CEREBELLUM_R[1],
      CEREBELLUM_C[2] + u[2] * CEREBELLUM_R[2],
    ]
    if (cerebrumField(p) < 0.02 || stemField(p[0], p[1], p[2]) < 0) continue
    const stripe = Math.abs(Math.sin((p[1] - CEREBELLUM_C[1]) * 36 + p[2] * 5 + perlin(p[0] * 3, p[1] * 3, p[2] * 3) * 1.6))
    if (stripe < 0.3 && rng() > 0.1) continue
    const n = normalize([u[0] / CEREBELLUM_R[0], u[1] / CEREBELLUM_R[1], u[2] / CEREBELLUM_R[2]])
    out.push({ p: sub(p, scale(n, rng() ** 2 * 0.04)), shade: 0.35 + 0.5 * stripe, part: 1 })
  }

  // 脳幹
  const sStart = out.length
  const axis = sub(STEM_B, STEM_A)
  const e1 = normalize(cross(axis, [1, 0, 0]))
  const e2 = normalize(cross(axis, e1))
  for (let guard = 0; out.length - sStart < stemCount && guard < stemCount * 30; guard++) {
    const t = rng()
    const a = rng() * Math.PI * 2
    const r = stemRadius(t)
    const c = add(STEM_A, scale(axis, t))
    const p = add(c, add(scale(e1, Math.cos(a) * r), scale(e2, Math.sin(a) * r)))
    if (cerebrumField(p) < 0.02 || cerebellumField(p[0], p[1], p[2]) < 0) continue
    out.push({ p, shade: 0.3 + 0.4 * (1 - t), part: 2 })
  }

  return out
}

/** 大脳の内側にランダムな点を置く (外側の皮質寄りに偏らせる) */
export function randomInsideCerebrum(rng: Rng): Vec3 {
  for (;;) {
    const p: Vec3 = [(rng() * 2 - 1) * 1.4, -0.85 + rng() * 1.9, (rng() * 2 - 1) * 1.6]
    const f = cerebrumField(p)
    if (f > -0.07) continue
    // 中心部は少なめ
    if (f < -0.45 && rng() > 0.25) continue
    return p
  }
}

// ---------------------------------------------------------------- ベクトル小道具

export function randomUnit(rng: Rng): Vec3 {
  const z = rng() * 2 - 1
  const a = rng() * Math.PI * 2
  const r = Math.sqrt(1 - z * z)
  return [r * Math.cos(a), r * Math.sin(a), z]
}
export const add = (a: Vec3, b: Vec3): Vec3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
export const sub = (a: Vec3, b: Vec3): Vec3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
export const scale = (a: Vec3, s: number): Vec3 => [a[0] * s, a[1] * s, a[2] * s]
export const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
export const length = (a: Vec3) => Math.sqrt(dot(a, a))
export const distance = (a: Vec3, b: Vec3) => length(sub(a, b))
export const cross = (a: Vec3, b: Vec3): Vec3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
]
export function normalize(a: Vec3): Vec3 {
  const l = length(a) || 1
  return [a[0] / l, a[1] / l, a[2] / l]
}
