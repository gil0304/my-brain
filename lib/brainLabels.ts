/**
 * ワード(ラベル)の画面上の配置。
 * 画面表示 (HTML ラベル) と PNG 書き出し (canvas) の両方で同じ計算を使う。
 * - 画面: 重なって置けないワードは薄くする (脳が回るとまた現れる)
 * - 書き出し: すべてのワードを必ず濃く描く。重なるワードは空いている場所へ移し、ノードと線でつなぐ
 */
import * as THREE from 'three'
import type { BrainNodes } from '~/composables/useBrainNodes'
import { smoothstep } from '~/lib/noise'

export type LabelKind = 'core' | 'category' | 'child'
export type LabelState = 'idle' | 'hover' | 'selected' | 'related' | 'dim'

export interface LabelDef {
  id: string
  kind: LabelKind
  label: string
  color: string
  /** ワードの代わりに QR コードを表示する */
  qr?: string | null
  /** 階層 (カテゴリー=1, ワード=2, 入れ子のワード=3…)。浅いほど重なったときに優先される */
  depth: number
}

export interface PlacedLabel {
  def: LabelDef
  /** ノードの画面上の位置 */
  x: number
  y: number
  /** 重なりを避けるためのずらし量 (dx はノードから離す方向への追加の距離) */
  dx: number
  dy: number
  opacity: number
  side: 'right' | 'left'
  /** ホバー・選択中 (重なったときに最優先で場所を取る) */
  active: boolean
}

/** 1 unit = 基準サイズでの 1px。画面では脳の大きさ、書き出しでは画像サイズに合わせて拡大・縮小する */
export const LABEL_METRICS = {
  categorySize: 15,
  categoryTracking: 0.06,
  /** 下地の左右の余白 (em) */
  categoryPadX: 0.67,
  categoryPadY: 0.27,
  categoryOffset: 14,
  categoryLine: 31,
  childSize: 15,
  childPadX: 0.53,
  childPadY: 0.2,
  childOffset: 10,
  /** ノードと文字をつなぐ短い線 + すき間 */
  childDash: 8,
  childGap: 4,
  childLine: 27,
  ring: 76,
  nameSize: 28,
  qrSize: 48,
  /** 書き出し画像の QR はスマホで読み取れる大きさにする */
  qrExportSize: 104,
}

const tmp = new THREE.Vector3()
const ndc = new THREE.Vector3()

const isWide = (ch: string) => /[\u3000-\u9fff\uff00-\uffef]/.test(ch)

/** ラベルの大きさのざっくりした見積もり (重なり判定用)。日本語は1文字=1em で数える */
function measure(def: LabelDef, unit: number, forExport: boolean) {
  const m = LABEL_METRICS
  if (def.qr) {
    const size = forExport ? m.qrExportSize : m.qrSize
    return { w: size * unit, line: (size + 4) * unit, offset: m.childOffset * unit }
  }
  if (def.kind === 'category') {
    const text = [...def.label].reduce((sum, ch) => sum + m.categorySize * ((isWide(ch) ? 1 : 0.64) + m.categoryTracking), 0)
    const w = text + m.categorySize * m.categoryPadX * 2 + 2
    return { w: w * unit, line: m.categoryLine * unit, offset: m.categoryOffset * unit }
  }
  const text = [...def.label].reduce((sum, ch) => sum + m.childSize * (isWide(ch) ? 1 : 0.58), 0)
  const w = text + m.childSize * m.childPadX * 2 + m.childDash + m.childGap
  return { w: w * unit, line: m.childLine * unit, offset: m.childOffset * unit }
}

export function layoutLabels(opts: {
  defs: LabelDef[]
  states: Map<string, LabelState>
  nodes: BrainNodes
  camera: THREE.PerspectiveCamera
  target: THREE.Vector3
  width: number
  height: number
  unit?: number
  /** PNG 書き出し用 (全ワードを濃く、必ず配置する) */
  forExport?: boolean
}): { labels: PlacedLabel[]; score: number } {
  const { defs, states, nodes, camera, target, width, height } = opts
  const unit = opts.unit ?? 1
  const forExport = !!opts.forExport
  const centerDepth = camera.position.distanceTo(target)
  const placed: PlacedLabel[] = []

  for (const def of defs) {
    const index = nodes.indexById.get(def.id)
    if (index == null) continue
    const n = nodes.nodes[index]!
    tmp.copy(n.pos).applyMatrix4(camera.matrixWorldInverse)
    const depth = -tmp.z
    ndc.copy(n.pos).project(camera)
    if (depth < 0.1 || ndc.z > 1) {
      placed.push({ def, x: -9999, y: -9999, dx: 0, dy: 0, opacity: 0, side: 'right', active: false })
      continue
    }
    const x = ((ndc.x + 1) / 2) * width
    const y = ((1 - ndc.y) / 2) * height
    const state = states.get(def.id) ?? 'idle'
    const active = state === 'hover' || state === 'selected' || state === 'related'
    // 中心より奥にあるワードは少しだけ薄くする (読める濃さは残す)
    const behind = 1 - 0.4 * smoothstep(-0.2, 1.4, depth - centerDepth)

    let opacity: number
    if (forExport) opacity = 1
    else if (def.kind === 'core') opacity = smoothstep(0.35, 0.9, n.reveal)
    else if (def.kind === 'category') opacity = n.reveal * (state === 'dim' ? 0.2 : active ? 1 : behind)
    else opacity = n.reveal * (state === 'dim' ? 0.14 : active ? 1 : 0.96 * behind)

    placed.push({ def, x, y, dx: 0, dy: 0, opacity, side: 'right', active })
  }

  const score = resolveOverlaps(placed, width, height, unit, forExport)
  return { labels: placed, score }
}

interface Box {
  left: number
  right: number
  top: number
  bottom: number
}
const overlaps = (a: Box, b: Box) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

/**
 * ワード同士が重ならないように置き場所を決める。
 * 優先度の高いもの (強調中 → 浅い階層 → 手前) から順に、ノードの近くの候補位置を試す。
 * 返り値は「ノードからどれだけずらしたか」の合計 (書き出しの角度選びに使う)。
 */
function resolveOverlaps(placed: PlacedLabel[], width: number, height: number, unit: number, forExport: boolean) {
  const m = LABEL_METRICS
  const taken: Box[] = []
  const margin = (forExport ? 20 : 8) * unit
  let score = 0

  // 中央の名前のリングには重ねない
  const core = placed.find((p) => p.def.kind === 'core')
  if (core && core.opacity > 0.05) {
    const r = m.ring * (forExport ? 0.55 : 0.42) * unit
    taken.push({ left: core.x - r, right: core.x + r, top: core.y - r, bottom: core.y + r })
  }

  const rank = (p: PlacedLabel) => (p.active ? 100 : 0) + (10 - p.def.depth) * 2 + p.opacity
  const order = placed.filter((p) => p.def.kind !== 'core' && p.opacity > 0.03).sort((a, b) => rank(b) - rank(a))

  // 書き出しでは上下だけでなく、ノードから離す方向にも大きく探す
  const dySteps = forExport ? [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8, 2.4, -2.4, 3.2, -3.2, 4, -4, 5, -5] : [0, 0.6, -0.6, 1.2, -1.2, 1.8, -1.8]
  const dxSteps = forExport ? [0, 1.5, 3, 5] : [0]

  for (const p of order) {
    const isCategory = p.def.kind === 'category'
    const { w, offset, line } = measure(p.def, unit, forExport)
    const fitsRight = p.x + offset + w <= width - margin
    const fitsLeft = p.x - offset - w >= margin
    const sides: PlacedLabel['side'][] = fitsRight ? (fitsLeft ? ['right', 'left'] : ['right']) : fitsLeft ? ['left'] : ['right']

    // 候補: ずらす距離が小さい順 (反対側に出すのは少しだけ減点)
    const candidates: { side: PlacedLabel['side']; dx: number; dy: number; box: Box; cost: number }[] = []
    sides.forEach((side, si) => {
      for (const kx of dxSteps) {
        for (const ky of dySteps) {
          const dx = kx * line
          const dy = ky * line
          const left = side === 'right' ? p.x + offset + dx : p.x - offset - dx - w
          const box = { left, right: left + w, top: p.y + dy - line / 2, bottom: p.y + dy + line / 2 }
          if (forExport && (box.left < margin || box.right > width - margin || box.top < margin || box.bottom > height - margin)) continue
          candidates.push({ side, dx, dy, box, cost: Math.abs(dy) + dx * 1.2 + si * line * 0.4 })
        }
      }
    })
    if (forExport) candidates.sort((a, b) => a.cost - b.cost)

    let chosen = candidates.find((c) => !taken.some((t) => overlaps(t, c.box))) ?? null
    if (!chosen && forExport && candidates.length) {
      // どこにも空きがなければ、重なりがいちばん少ない場所に置く (書き出しでは消さない)
      const overlapArea = (b: Box) =>
        taken.reduce((sum, t) => sum + Math.max(0, Math.min(b.right, t.right) - Math.max(b.left, t.left)) * Math.max(0, Math.min(b.bottom, t.bottom) - Math.max(b.top, t.top)), 0)
      chosen = candidates.reduce((best, c) => (overlapArea(c.box) < overlapArea(best.box) ? c : best))
      score += 2000
    }

    if (chosen) {
      p.side = chosen.side
      p.dx = chosen.dx
      p.dy = chosen.dy
      taken.push(chosen.box)
      score += chosen.cost
    } else {
      p.side = sides[0]!
      p.opacity *= isCategory ? 0.5 : 0.15
      score += 2000
    }
  }
  return score
}
