/**
 * 脳内ネットワークの3Dオブジェクト一式。
 * - ノード (InstancedMesh の球体) + 発光のにじみ (Points)
 * - 接続線 (LineSegments 1回の描画, 光が流れるシェーダー)
 * - 脳の形を描く皮質の粒子 / 背景の星 (Points)
 *
 * レイアウトは初回に1度だけ計算し、以降は微小な浮遊と発光のアニメーションだけを行う。
 */
import * as THREE from 'three'
import type { BrainGraph, GraphNode } from '~/lib/brainGraph'
import { CORE_ID } from '~/lib/brainGraph'
import { clamp, createRng } from '~/lib/noise'
import {
  add,
  distance,
  normalize,
  nudgeInside,
  randomInsideCerebrum,
  randomUnit,
  sampleCortex,
  scale,
  type Vec3,
} from '~/lib/brainShape'
import type { QualitySettings } from '~/lib/quality'

export type SceneNodeKind = 'core' | 'category' | 'child' | 'neuron'

export interface SceneNode {
  id: string
  kind: SceneNodeKind
  graph: GraphNode | null
  categoryIndex: number
  base: THREE.Vector3
  /** 現在の(アニメーション後の)位置 */
  pos: THREE.Vector3
  color: THREE.Color
  radius: number
  haloSize: number
  haloAlpha: number
  colorBoost: number
  baseBright: number
  bright: number
  brightTarget: number
  scale: number
  scaleTarget: number
  reveal: number
  delay: number
  phase: number
  breathSpeed: number
  float: { amp: number; fx: number; fy: number; fz: number; px: number; py: number; pz: number }
}

export interface SceneEdge {
  a: number
  b: number
  kind: 'core' | 'tree' | 'link' | 'mesh'
  base: number
  alpha: number
  alphaTarget: number
  /** 線分の数 (カテゴリーをまたぐリンクは弧を描くので分割する) */
  segments: number
  /** 頂点バッファ内の開始線分 */
  offset: number
}

export interface SharedUniforms {
  uTime: THREE.IUniform<number>
  /** 浮遊用の時間。スクリーンショットモードでは止める */
  uFloatTime: THREE.IUniform<number>
  uReveal: THREE.IUniform<number>
  /** 1ワールド単位が深度1でどれだけのピクセルになるか */
  uScale: THREE.IUniform<number>
  uPixelRatio: THREE.IUniform<number>
}

export function createSharedUniforms(): SharedUniforms {
  return {
    uTime: { value: 0 },
    uFloatTime: { value: 0 },
    uReveal: { value: 0 },
    uScale: { value: 800 },
    uPixelRatio: { value: 1 },
  }
}

const CORE_POS: Vec3 = [0, 0.04, 0]
const DUST_BASE = new THREE.Color('#7f93d6')

// ------------------------------------------------------------------ shaders

const COLOR_OUT = /* glsl */ `
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
`

const haloVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aAlpha;
  uniform float uScale;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    gl_PointSize = aSize * uScale / max(0.05, -mv.z);
    vColor = aColor;
    vAlpha = aAlpha;
  }
`
const haloFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float glow = exp(-d * d * 5.0) * (1.0 - d);
    float core = exp(-d * d * 28.0);
    gl_FragColor = vec4(vColor * (glow * 0.75 + core * 0.6), vAlpha);
    ${COLOR_OUT}
  }
`

const lineVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aT;
  attribute float aSeed;
  attribute float aAlpha;
  attribute float aPulse;
  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vPulse;
  void main() {
    vColor = aColor;
    vT = aT;
    vSeed = aSeed;
    vAlpha = aAlpha;
    vPulse = aPulse;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`
const lineFragment = /* glsl */ `
  uniform float uTime;
  varying vec3 vColor;
  varying float vT;
  varying float vSeed;
  varying float vAlpha;
  varying float vPulse;
  float hash(float x) { return fract(sin(x * 12.9898) * 43758.5453); }
  void main() {
    // 線の上を光の粒がゆっくり流れる。すべての線で同時に流れないよう周期ごとにランダムで間引く
    float speed = 0.16 + vSeed * 0.22;
    float cycle = uTime * speed + vSeed * 17.0;
    float gate = step(0.45, hash(floor(cycle) + vSeed * 91.0));
    float head = fract(cycle) * 1.5 - 0.25;
    float d = vT - head;
    float pulse = exp(-d * d * 160.0) * vPulse * gate;
    float a = vAlpha * (1.0 + pulse * 5.0);
    gl_FragColor = vec4(vColor * (1.0 + pulse * 1.2), a);
    ${COLOR_OUT}
  }
`

const dustVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aShade;
  attribute float aDelay;
  attribute float aSeed;
  uniform float uTime;
  uniform float uFloatTime;
  uniform float uReveal;
  uniform float uScale;
  uniform float uSize;
  uniform vec3 uCore;
  uniform vec3 uFocus;
  uniform float uFocusAmt;
  uniform float uFocusRadius;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float r = clamp((uReveal - aDelay) / 0.55, 0.0, 1.0);
    r = 1.0 - pow(1.0 - r, 3.0);
    vec3 p = mix(uCore, position, r);
    p += 0.01 * vec3(
      sin(uFloatTime * 0.6 + aSeed * 6.283),
      sin(uFloatTime * 0.7 + aSeed * 12.1),
      cos(uFloatTime * 0.5 + aSeed * 19.7)
    );
    vec4 mv = modelViewMatrix * vec4(p, 1.0);
    gl_Position = projectionMatrix * mv;

    float twinkle = 0.78 + 0.22 * sin(uTime * (0.6 + aSeed * 1.4) + aSeed * 40.0);
    float focus = 1.0 - smoothstep(uFocusRadius * 0.35, uFocusRadius, distance(position, uFocus));
    float dim = mix(1.0, mix(0.1, 1.5, focus), uFocusAmt);
    vAlpha = aShade * twinkle * dim * r;
    vColor = aColor;
    gl_PointSize = max(1.3, uSize * (0.55 + aShade * 0.6) * uScale / max(0.05, -mv.z));
  }
`
const dustFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = 1.0 - d;
    gl_FragColor = vec4(vColor, vAlpha * a * a);
    ${COLOR_OUT}
  }
`

const starVertex = /* glsl */ `
  attribute vec3 aColor;
  attribute float aSize;
  attribute float aSeed;
  uniform float uTime;
  uniform float uPixelRatio;
  uniform float uReveal;
  uniform float uScale;
  uniform float uWorldSize;
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    vec4 mv = modelViewMatrix * vec4(position, 1.0);
    gl_Position = projectionMatrix * mv;
    float twinkle = 0.55 + 0.45 * sin(uTime * (0.3 + aSeed * 1.2) + aSeed * 60.0);
    vAlpha = twinkle * clamp(uReveal * 1.5, 0.0, 1.0);
    vColor = aColor;
    float px = uWorldSize > 0.0 ? aSize * uWorldSize * uScale / max(0.05, -mv.z) : aSize * uPixelRatio;
    gl_PointSize = max(1.0, px);
  }
`
const starFragment = /* glsl */ `
  varying vec3 vColor;
  varying float vAlpha;
  void main() {
    float d = length(gl_PointCoord - 0.5) * 2.0;
    if (d > 1.0) discard;
    float a = pow(1.0 - d, 1.6);
    gl_FragColor = vec4(vColor, vAlpha * a);
    ${COLOR_OUT}
  }
`

function additiveMaterial(params: THREE.ShaderMaterialParameters) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.AdditiveBlending,
    ...params,
  })
}

// ------------------------------------------------------------------ layout

function minDistSq(p: Vec3, points: Vec3[]) {
  let m = Infinity
  for (const q of points) {
    const dx = p[0] - q[0]
    const dy = p[1] - q[1]
    const dz = p[2] - q[2]
    const d = dx * dx + dy * dy + dz * dz
    if (d < m) m = d
  }
  return m
}

function createLayout(graph: BrainGraph, quality: QualitySettings) {
  const nodes: SceneNode[] = []
  const placed: Vec3[] = []
  const rngMotion = createRng(99)

  const push = (
    id: string,
    kind: SceneNodeKind,
    p: Vec3,
    color: THREE.Color,
    categoryIndex: number,
    graphNode: GraphNode | null,
  ) => {
    const isNeuron = kind === 'neuron'
    const look = {
      core: { radius: 0.05, haloSize: 0.6, haloAlpha: 0.5, colorBoost: 1.4, baseBright: 1.2, amp: 0.012 },
      category: { radius: 0.064, haloSize: 0.6, haloAlpha: 0.42, colorBoost: 1.35, baseBright: 1.2, amp: 0.025 },
      child: { radius: 0.032, haloSize: 0.28, haloAlpha: 0.38, colorBoost: 1.15, baseBright: 1, amp: 0.035 },
      neuron: { radius: 0.0, haloSize: 0.1, haloAlpha: 0.22, colorBoost: 0.9, baseBright: 0, amp: 0.045 },
    }[kind]
    const radius = isNeuron ? 0.009 + rngMotion() * 0.012 : look.radius
    const baseBright = isNeuron ? 0.5 + rngMotion() * 0.45 : look.baseBright
    const d = distance(p, CORE_POS)
    nodes.push({
      id,
      kind,
      graph: graphNode,
      categoryIndex,
      base: new THREE.Vector3(...p),
      pos: new THREE.Vector3(...CORE_POS),
      color,
      radius,
      haloSize: isNeuron ? look.haloSize * (0.7 + rngMotion() * 0.6) : look.haloSize,
      haloAlpha: look.haloAlpha,
      colorBoost: look.colorBoost,
      baseBright,
      bright: baseBright,
      brightTarget: baseBright,
      scale: 1,
      scaleTarget: 1,
      reveal: 0,
      delay: kind === 'core' ? 0 : clamp(d / 2.1, 0, 1) * 0.5 + rngMotion() * 0.08,
      phase: rngMotion() * Math.PI * 2,
      breathSpeed: 0.7 + rngMotion() * 0.6,
      float: {
        amp: look.amp * (0.6 + rngMotion() * 0.8),
        fx: 0.25 + rngMotion() * 0.35,
        fy: 0.25 + rngMotion() * 0.35,
        fz: 0.25 + rngMotion() * 0.35,
        px: rngMotion() * Math.PI * 2,
        py: rngMotion() * Math.PI * 2,
        pz: rngMotion() * Math.PI * 2,
      },
    })
    placed.push(p)
  }

  // 中心: 名前のノード
  const core = graph.byId.get(CORE_ID)!
  push(CORE_ID, 'core', CORE_POS, new THREE.Color(core.color), -1, core)

  // カテゴリー: 脳の各領域 (前頭葉・側頭葉・後頭葉…) に配置
  const catPos: Vec3[] = []
  const catColors: THREE.Color[] = []
  graph.categories.forEach((cat, ci) => {
    const p = nudgeInside(cat.region ?? [0, 0.5, 0], 0.16)
    catPos.push(p)
    catColors.push(new THREE.Color(cat.color))
    push(cat.id, 'category', p, catColors[ci]!, ci, cat)
  })

  // ワード: 親(カテゴリー or ワード)の周りに、外側寄りに散らす。入れ子のワードはさらにその周りに
  const rngChild = createRng(1337)
  const placeChildren = (parentId: string, center: Vec3, ci: number) => {
    const parent = graph.byId.get(parentId)!
    const outward = normalize(center)
    const nested = parent.kind === 'child'
    const [rMin, rRange, need] = nested ? [0.22, 0.12, 0.17] : [0.32, 0.22, 0.22]
    for (const cid of parent.childIds) {
      let p: Vec3 | null = null
      for (let attempt = 0; attempt < 80 && !p; attempt++) {
        const dir = normalize(add(randomUnit(rngChild), scale(outward, nested ? 0.8 : 0.45)))
        const candidate = nudgeInside(add(center, scale(dir, rMin + rngChild() * rRange)), 0.05)
        const d = attempt < 50 ? need : need * 0.75
        if (minDistSq(candidate, placed) >= d * d) p = candidate
      }
      p ??= nudgeInside(add(center, scale(randomUnit(rngChild), rMin + rRange / 2)), 0.05)
      push(cid, 'child', p, catColors[ci]!, ci, graph.byId.get(cid)!)
      placeChildren(cid, p, ci)
    }
  }
  graph.categories.forEach((cat, ci) => placeChildren(cat.id, catPos[ci]!, ci))

  // ニューロン: 脳全体を埋める小さなノード。一番近いカテゴリーの色に染まる
  const rngNeuron = createRng(2024)
  const white = new THREE.Color('#ffffff')
  for (let k = 0; k < quality.neuronCount; k++) {
    let p: Vec3 | null = null
    for (let attempt = 0; attempt < 60 && !p; attempt++) {
      const candidate = randomInsideCerebrum(rngNeuron)
      if (minDistSq(candidate, placed) >= 0.12 * 0.12) p = candidate
    }
    if (!p) continue
    let best = 0
    let bestD = Infinity
    catPos.forEach((c, ci) => {
      const d = distance(p!, c)
      if (d < bestD) {
        bestD = d
        best = ci
      }
    })
    const color = catColors[best]!.clone().lerp(white, 0.15 + rngNeuron() * 0.2)
    push(`n${k}`, 'neuron', p, color, best, null)
  }

  // 接続
  const indexById = new Map(nodes.map((n, i) => [n.id, i]))
  const edges: SceneEdge[] = []
  const keys = new Set<string>()
  const degree = new Array(nodes.length).fill(0)
  const connect = (a: number, b: number, kind: SceneEdge['kind']) => {
    if (a === b) return
    const key = a < b ? `${a}-${b}` : `${b}-${a}`
    if (keys.has(key)) return
    keys.add(key)
    degree[a]++
    degree[b]++
    const base = { core: 0.2, tree: 0.36, link: 0.32, mesh: 0.11 }[kind]
    edges.push({ a, b, kind, base, alpha: base, alphaTarget: base, segments: kind === 'link' ? 16 : 1, offset: 0 })
  }
  for (const e of graph.edges) connect(indexById.get(e.a)!, indexById.get(e.b)!, e.kind)

  const nearest = (i: number, filter: (j: number) => boolean, count: number, maxDist: number) => {
    const list: { j: number; d: number }[] = []
    for (let j = 0; j < nodes.length; j++) {
      if (j === i || !filter(j)) continue
      const d = nodes[i]!.base.distanceTo(nodes[j]!.base)
      if (d <= maxDist) list.push({ j, d })
    }
    return list.sort((x, y) => x.d - y.d).slice(0, count)
  }
  nodes.forEach((n, i) => {
    if (n.kind !== 'neuron') return
    const near = nearest(i, (j) => nodes[j]!.kind !== 'core' && degree[j] < 6, 2, 0.46)
    const list = near.length ? near : nearest(i, (j) => nodes[j]!.kind !== 'core', 1, 1.2)
    list.forEach(({ j }) => connect(i, j, 'mesh'))
  })
  nodes.forEach((n, i) => {
    if (n.kind !== 'child') return
    nearest(i, (j) => nodes[j]!.kind === 'neuron', 2, 0.55).forEach(({ j }) => connect(i, j, 'mesh'))
  })

  return { nodes, edges, indexById, catPos, catColors }
}

// ------------------------------------------------------------------ main

export function useBrainNodes(graph: BrainGraph, quality: QualitySettings, uniforms: SharedUniforms) {
  const group = new THREE.Group()
  group.name = 'brain'
  const { nodes, edges, indexById, catPos, catColors } = createLayout(graph, quality)
  const disposables: { dispose(): void }[] = []
  const track = <T extends { dispose(): void }>(o: T) => (disposables.push(o), o)

  // ---- ノード (球体)
  const sphereGeo = track(new THREE.IcosahedronGeometry(1, 3))
  const sphereMat = track(new THREE.MeshBasicMaterial({ color: 0xffffff }))
  const spheres = new THREE.InstancedMesh(sphereGeo, sphereMat, nodes.length)
  spheres.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
  spheres.instanceColor = new THREE.InstancedBufferAttribute(new Float32Array(nodes.length * 3), 3)
  spheres.instanceColor.setUsage(THREE.DynamicDrawUsage)
  spheres.frustumCulled = false
  group.add(spheres)

  // ---- 発光のにじみ
  const haloGeo = track(new THREE.BufferGeometry())
  const haloPos = new Float32Array(nodes.length * 3)
  const haloColor = new Float32Array(nodes.length * 3)
  const haloSize = new Float32Array(nodes.length)
  const haloAlpha = new Float32Array(nodes.length)
  haloGeo.setAttribute('position', new THREE.BufferAttribute(haloPos, 3).setUsage(THREE.DynamicDrawUsage))
  haloGeo.setAttribute('aColor', new THREE.BufferAttribute(haloColor, 3))
  haloGeo.setAttribute('aSize', new THREE.BufferAttribute(haloSize, 1).setUsage(THREE.DynamicDrawUsage))
  haloGeo.setAttribute('aAlpha', new THREE.BufferAttribute(haloAlpha, 1).setUsage(THREE.DynamicDrawUsage))
  nodes.forEach((n, i) => n.color.toArray(haloColor, i * 3))
  const halos = new THREE.Points(
    haloGeo,
    track(additiveMaterial({ vertexShader: haloVertex, fragmentShader: haloFragment, uniforms: { uScale: uniforms.uScale } })),
  )
  halos.frustumCulled = false
  halos.renderOrder = 2
  group.add(halos)

  // ---- 接続線
  let segmentCount = 0
  edges.forEach((e) => {
    e.offset = segmentCount
    segmentCount += e.segments
  })
  const lineGeo = track(new THREE.BufferGeometry())
  const linePos = new Float32Array(segmentCount * 6)
  const lineColor = new Float32Array(segmentCount * 6)
  const lineT = new Float32Array(segmentCount * 2)
  const lineSeed = new Float32Array(segmentCount * 2)
  const lineAlpha = new Float32Array(segmentCount * 2)
  const linePulse = new Float32Array(segmentCount * 2)
  const rngLine = createRng(77)
  const segColor = new THREE.Color()
  edges.forEach((e) => {
    const ca = nodes[e.a]!.color
    const cb = nodes[e.b]!.color
    const seed = rngLine()
    const pulse = { core: 0.7, tree: 0.8, link: 1.2, mesh: 0.45 }[e.kind]
    for (let s = 0; s < e.segments; s++) {
      const v = (e.offset + s) * 2
      for (let end = 0; end < 2; end++) {
        const t = (s + end) / e.segments
        segColor.copy(ca).lerp(cb, t).toArray(lineColor, (v + end) * 3)
        lineT[v + end] = t
        lineSeed[v + end] = seed
        linePulse[v + end] = pulse
      }
    }
  })
  lineGeo.setAttribute('position', new THREE.BufferAttribute(linePos, 3).setUsage(THREE.DynamicDrawUsage))
  lineGeo.setAttribute('aColor', new THREE.BufferAttribute(lineColor, 3))
  lineGeo.setAttribute('aT', new THREE.BufferAttribute(lineT, 1))
  lineGeo.setAttribute('aSeed', new THREE.BufferAttribute(lineSeed, 1))
  lineGeo.setAttribute('aAlpha', new THREE.BufferAttribute(lineAlpha, 1).setUsage(THREE.DynamicDrawUsage))
  lineGeo.setAttribute('aPulse', new THREE.BufferAttribute(linePulse, 1))
  const lines = new THREE.LineSegments(
    lineGeo,
    track(additiveMaterial({ vertexShader: lineVertex, fragmentShader: lineFragment, uniforms: { uTime: uniforms.uTime } })),
  )
  lines.frustumCulled = false
  lines.renderOrder = 1
  group.add(lines)

  // ---- 皮質の粒子 (遠くから見ると「脳」に見える層)
  const cortex = sampleCortex(quality.cortexCount, 7)
  const dustGeo = track(new THREE.BufferGeometry())
  const dPos = new Float32Array(cortex.length * 3)
  const dColor = new Float32Array(cortex.length * 3)
  const dShade = new Float32Array(cortex.length)
  const dDelay = new Float32Array(cortex.length)
  const dSeed = new Float32Array(cortex.length)
  const rngDust = createRng(5)
  const tmp = new THREE.Color()
  cortex.forEach((pt, i) => {
    dPos.set(pt.p, i * 3)
    // 近い2つのカテゴリー色をなめらかに混ぜ、遠いほどベースの青白い色に寄せる
    let i1 = 0
    let i2 = 0
    let d1 = Infinity
    let d2 = Infinity
    catPos.forEach((c, ci) => {
      const d = distance(pt.p, c)
      if (d < d1) {
        d2 = d1
        i2 = i1
        d1 = d
        i1 = ci
      } else if (d < d2) {
        d2 = d
        i2 = ci
      }
    })
    const w2 = Math.exp(-(d2 - d1) * 6) * 0.5
    tmp.copy(catColors[i1]!).lerp(catColors[i2]!, w2)
    const regionStrength = pt.part === 0 ? 0.3 + 0.5 * Math.exp(-(d1 * d1) / (2 * 0.6 * 0.6)) : 0.12
    tmp.lerp(DUST_BASE, 1 - regionStrength)
    tmp.toArray(dColor, i * 3)
    dShade[i] = pt.shade * (pt.part === 0 ? 0.62 : 0.42)
    dDelay[i] = clamp(distance(pt.p, CORE_POS) / 2.2, 0, 1) * 0.5 + rngDust() * 0.12
    dSeed[i] = rngDust()
  })
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3))
  dustGeo.setAttribute('aColor', new THREE.BufferAttribute(dColor, 3))
  dustGeo.setAttribute('aShade', new THREE.BufferAttribute(dShade, 1))
  dustGeo.setAttribute('aDelay', new THREE.BufferAttribute(dDelay, 1))
  dustGeo.setAttribute('aSeed', new THREE.BufferAttribute(dSeed, 1))
  const dustUniforms = {
    uTime: uniforms.uTime,
    uFloatTime: uniforms.uFloatTime,
    uReveal: uniforms.uReveal,
    uScale: uniforms.uScale,
    uSize: { value: quality.tier === 'high' ? 0.016 : 0.019 },
    uCore: { value: new THREE.Vector3(...CORE_POS) },
    uFocus: { value: new THREE.Vector3() },
    uFocusAmt: { value: 0 },
    uFocusRadius: { value: 1 },
  }
  const dust = new THREE.Points(
    dustGeo,
    track(additiveMaterial({ vertexShader: dustVertex, fragmentShader: dustFragment, uniforms: dustUniforms })),
  )
  dust.frustumCulled = false
  dust.renderOrder = 3
  group.add(dust)

  // ---- 背景: 遠くの星 + 脳の周りを漂うチリ (奥行きの演出)
  const background = new THREE.Group()
  const makeStars = (count: number, rMin: number, rMax: number, sizeMin: number, sizeMax: number, worldSize: number, seed: number) => {
    const rng = createRng(seed)
    const geo = track(new THREE.BufferGeometry())
    const pos = new Float32Array(count * 3)
    const col = new Float32Array(count * 3)
    const size = new Float32Array(count)
    const sd = new Float32Array(count)
    const palette = [new THREE.Color('#9fb6ff'), new THREE.Color('#ffffff'), new THREE.Color('#7fe9ff'), new THREE.Color('#c7a8ff')]
    for (let i = 0; i < count; i++) {
      const dir = randomUnit(rng)
      const r = rMin + (rMax - rMin) * Math.pow(rng(), 0.7)
      pos.set(scale(dir, r), i * 3)
      const c = palette[Math.floor(rng() * palette.length)]!.clone().multiplyScalar(0.35 + rng() * 0.5)
      c.toArray(col, i * 3)
      size[i] = sizeMin + (sizeMax - sizeMin) * rng() ** 2
      sd[i] = rng()
    }
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3))
    geo.setAttribute('aColor', new THREE.BufferAttribute(col, 3))
    geo.setAttribute('aSize', new THREE.BufferAttribute(size, 1))
    geo.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1))
    const points = new THREE.Points(
      geo,
      track(
        additiveMaterial({
          vertexShader: starVertex,
          fragmentShader: starFragment,
          uniforms: {
            uTime: uniforms.uTime,
            uPixelRatio: uniforms.uPixelRatio,
            uReveal: uniforms.uReveal,
            uScale: uniforms.uScale,
            uWorldSize: { value: worldSize },
          },
        }),
      ),
    )
    points.frustumCulled = false
    return points
  }
  const stars = makeStars(quality.starCount, 16, 60, 0.6, 2.2, 0, 31)
  const motes = makeStars(quality.moteCount, 2.6, 8, 0.4, 1.2, 0.03, 32)
  background.add(stars, motes)

  // ------------------------------------------------------------ state

  let focusTarget = 0
  const focusPoint = new THREE.Vector3()
  let focusRadius = 1

  function setState(selected: number | null, hovered: number | null) {
    const sel = selected != null ? nodes[selected]! : null
    const related = sel && sel.kind !== 'core' ? new Set(graph.related(sel.id).map((id) => indexById.get(id)!)) : null
    const regionCat = sel ? sel.categoryIndex : -1

    nodes.forEach((n, i) => {
      let b = n.baseBright
      let s = 1
      if (related) {
        if (i === selected) {
          b = 1.4
          s = 1.25
        } else if (related.has(i)) b = 1.25
        else if (n.kind === 'neuron' && n.categoryIndex === regionCat) b = n.baseBright * 0.8
        // (線形空間の値なので、画面上で暗く見せるにはかなり小さくする)
        else b = n.kind === 'neuron' ? 0.025 : 0.05
      } else if (sel && i === selected) {
        b = 1.6
        s = 1.25
      }
      if (i === hovered) {
        s = Math.max(s, 1.6)
        b = Math.max(b, 1.8)
      }
      n.brightTarget = b
      n.scaleTarget = s
    })

    edges.forEach((e) => {
      let m = 1
      if (related) {
        const inA = related.has(e.a)
        const inB = related.has(e.b)
        if (e.kind !== 'mesh' && inA && inB) m = 2.6
        else if (e.kind === 'mesh' && nodes[e.a]!.categoryIndex === regionCat && nodes[e.b]!.categoryIndex === regionCat) m = 0.9
        else m = 0.04
      }
      if (hovered != null && (e.a === hovered || e.b === hovered)) m = Math.max(m, e.kind === 'mesh' ? 2.5 : 3)
      e.alphaTarget = e.base * m
    })

    if (sel && sel.kind !== 'core') {
      focusTarget = 1
      focusPoint.copy(sel.base)
      focusRadius = sel.kind === 'category' ? 1.05 : 0.75
    } else {
      focusTarget = 0
    }
  }

  // ------------------------------------------------------------ per frame

  const ctrl = new THREE.Vector3()
  const bend = new THREE.Vector3()
  const corePos = new THREE.Vector3(...CORE_POS)

  function update(dt: number) {
    const t = uniforms.uTime.value
    const ft = uniforms.uFloatTime.value
    const reveal = uniforms.uReveal.value
    const kB = 1 - Math.exp(-dt * 6)
    const kS = 1 - Math.exp(-dt * 10) // 約0.3秒で拡大
    const mat = spheres.instanceMatrix.array as Float32Array
    const col = spheres.instanceColor!.array as Float32Array
    const [cx, cy, cz] = CORE_POS

    for (let i = 0; i < nodes.length; i++) {
      const n = nodes[i]!
      n.bright += (n.brightTarget - n.bright) * kB
      n.scale += (n.scaleTarget - n.scale) * kS
      const lr = clamp((reveal - n.delay) / 0.5, 0, 1)
      const r = 1 - (1 - lr) ** 3
      n.reveal = r

      const f = n.float
      const x = cx + (n.base.x - cx) * r + Math.sin(ft * f.fx + f.px) * f.amp
      const y = cy + (n.base.y - cy) * r + Math.sin(ft * f.fy + f.py) * f.amp
      const z = cz + (n.base.z - cz) * r + Math.sin(ft * f.fz + f.pz) * f.amp
      n.pos.set(x, y, z)

      const breath = Math.sin(t * n.breathSpeed + n.phase)
      const s = n.radius * n.scale * (1 + 0.07 * breath) * r
      const o = i * 16
      mat[o] = s
      mat[o + 1] = 0
      mat[o + 2] = 0
      mat[o + 3] = 0
      mat[o + 4] = 0
      mat[o + 5] = s
      mat[o + 6] = 0
      mat[o + 7] = 0
      mat[o + 8] = 0
      mat[o + 9] = 0
      mat[o + 10] = s
      mat[o + 11] = 0
      mat[o + 12] = x
      mat[o + 13] = y
      mat[o + 14] = z
      mat[o + 15] = 1

      // 呼吸するように明るさが変化。明るいほど中心が白く飛ぶ
      const glow = n.bright * (0.86 + 0.14 * breath) * n.colorBoost
      const white = clamp(0.2 + (n.bright - 1) * 0.4, 0, 0.75)
      col[i * 3] = (n.color.r + (1 - n.color.r) * white) * glow
      col[i * 3 + 1] = (n.color.g + (1 - n.color.g) * white) * glow
      col[i * 3 + 2] = (n.color.b + (1 - n.color.b) * white) * glow

      haloPos[i * 3] = x
      haloPos[i * 3 + 1] = y
      haloPos[i * 3 + 2] = z
      haloSize[i] = n.haloSize * (0.75 + 0.25 * n.scale) * (0.92 + 0.08 * breath) * r
      haloAlpha[i] = Math.min(2.2, n.bright * n.haloAlpha)
    }

    for (let k = 0; k < edges.length; k++) {
      const e = edges[k]!
      const a = nodes[e.a]!.pos
      const b = nodes[e.b]!.pos
      e.alpha += (e.alphaTarget - e.alpha) * kB
      const rv = Math.min(nodes[e.a]!.reveal, nodes[e.b]!.reveal)
      const alpha = e.alpha * rv * rv
      if (e.segments === 1) {
        const o = e.offset * 6
        linePos[o] = a.x
        linePos[o + 1] = a.y
        linePos[o + 2] = a.z
        linePos[o + 3] = b.x
        linePos[o + 4] = b.y
        linePos[o + 5] = b.z
        lineAlpha[e.offset * 2] = lineAlpha[e.offset * 2 + 1] = alpha
        continue
      }
      // 離れた領域どうしのつながりは、脳の外側へふくらむ弧にする
      ctrl.addVectors(a, b).multiplyScalar(0.5)
      const bulge = a.distanceTo(b) * 0.38
      bend.copy(ctrl).sub(corePos)
      if (bend.lengthSq() < 1e-4) bend.set(0, 1, 0)
      ctrl.addScaledVector(bend.normalize(), bulge)
      for (let s = 0; s <= e.segments; s++) {
        const t = s / e.segments
        const u = 1 - t
        const x = u * u * a.x + 2 * u * t * ctrl.x + t * t * b.x
        const y = u * u * a.y + 2 * u * t * ctrl.y + t * t * b.y
        const z = u * u * a.z + 2 * u * t * ctrl.z + t * t * b.z
        // 頂点 s は「線分 s の始点」かつ「線分 s-1 の終点」
        if (s < e.segments) {
          const o = (e.offset + s) * 6
          linePos[o] = x
          linePos[o + 1] = y
          linePos[o + 2] = z
        }
        if (s > 0) {
          const o = (e.offset + s - 1) * 6 + 3
          linePos[o] = x
          linePos[o + 1] = y
          linePos[o + 2] = z
        }
      }
      lineAlpha.fill(alpha, e.offset * 2, (e.offset + e.segments) * 2)
    }

    dustUniforms.uFocusAmt.value += (focusTarget - dustUniforms.uFocusAmt.value) * kB
    dustUniforms.uFocus.value.lerp(focusPoint, kB)
    dustUniforms.uFocusRadius.value += (focusRadius - dustUniforms.uFocusRadius.value) * kB

    spheres.instanceMatrix.needsUpdate = true
    spheres.instanceColor!.needsUpdate = true
    haloGeo.attributes.position!.needsUpdate = true
    haloGeo.attributes.aSize!.needsUpdate = true
    haloGeo.attributes.aAlpha!.needsUpdate = true
    lineGeo.attributes.position!.needsUpdate = true
    lineGeo.attributes.aAlpha!.needsUpdate = true

    background.rotation.y = t * 0.004
    motes.rotation.y = -t * 0.01
  }

  function dispose() {
    disposables.forEach((d) => d.dispose())
    spheres.dispose()
  }

  return {
    group,
    background,
    uniforms,
    nodes,
    edges,
    indexById,
    /** クリック・ホバーできるノード (中心・カテゴリー・子ノード) */
    interactive: nodes.map((n, i) => (n.kind === 'neuron' ? -1 : i)).filter((i) => i >= 0),
    corePosition: new THREE.Vector3(...CORE_POS),
    setState,
    update,
    dispose,
  }
}

export type BrainNodes = ReturnType<typeof useBrainNodes>
