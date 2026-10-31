/**
 * SNS用 PNG の書き出し。
 * 3D の描画結果に、画面と同じワード・中央の名前を重ねる。
 */
import { profile } from '~/data/brain'
import { LABEL_METRICS as M, type PlacedLabel } from '~/lib/brainLabels'
import { drawQr } from '~/lib/qr'

const FONT_DISPLAY = '"Space Grotesk", "Zen Kaku Gothic New", system-ui, sans-serif'
const FONT_JP = '"Zen Kaku Gothic New", "Hiragino Sans", "Noto Sans JP", sans-serif'

export const SNAPSHOT_SIZES = {
  portrait: { width: 1080, height: 1350 },
  square: { width: 1080, height: 1080 },
} as const

/** 画面表示の 1px に対する書き出し画像のピクセル数 */
export const snapshotUnit = (width: number) => width / 725

/** canvas に描く前にフォントを読み込んでおく (日本語は使う文字のサブセットだけ読み込まれるので文字を渡す) */
export async function loadSnapshotFonts(text: string) {
  if (!('fonts' in document)) return
  await Promise.allSettled([
    document.fonts.load(`500 40px "Space Grotesk"`, text),
    document.fonts.load(`700 40px "Space Grotesk"`, text),
    document.fonts.load(`500 40px "Zen Kaku Gothic New"`, text),
    document.fonts.load(`700 40px "Zen Kaku Gothic New"`, text),
    document.fonts.load(`700 40px "Zen Kaku Gothic New"`, profile.name),
  ])
}

export function composeSnapshot(render: HTMLCanvasElement, labels: PlacedLabel[]) {
  const W = render.width
  const H = render.height
  const u = snapshotUnit(W)
  const canvas = document.createElement('canvas')
  canvas.width = W
  canvas.height = H
  const ctx = canvas.getContext('2d')!
  ctx.drawImage(render, 0, 0)

  // 周辺減光 (画面の .brain-vignette と同じ)
  const corner = Math.hypot(W, H) / 2
  const vg = ctx.createRadialGradient(W / 2, H / 2, 0, W / 2, H / 2, corner)
  vg.addColorStop(0.45, 'rgba(4,6,12,0)')
  vg.addColorStop(1, 'rgba(4,6,12,0.55)')
  ctx.fillStyle = vg
  ctx.fillRect(0, 0, W, H)

  // ずらしたワードは、ノードとの間を細い線でつなぐ
  for (const l of labels) {
    if (l.opacity < 0.02 || l.def.kind === 'core' || (l.dx === 0 && l.dy === 0)) continue
    const offset = (l.def.kind === 'category' ? M.categoryOffset : M.childOffset) * u
    const ax = l.side === 'right' ? l.x + offset + l.dx : l.x - offset - l.dx
    ctx.save()
    ctx.strokeStyle = hexAlpha(l.def.color, 0.7)
    ctx.lineWidth = 1.5 * u
    ctx.beginPath()
    ctx.moveTo(l.x, l.y)
    ctx.lineTo(ax, l.y + l.dy)
    ctx.stroke()
    ctx.fillStyle = l.def.color
    ctx.beginPath()
    ctx.arc(l.x, l.y, 2.5 * u, 0, Math.PI * 2)
    ctx.fill()
    ctx.restore()
  }

  ctx.textBaseline = 'middle'
  for (const l of labels) {
    if (l.opacity < 0.02 || l.def.kind === 'core') continue
    ctx.save()
    ctx.globalAlpha = Math.min(1, l.opacity)
    if (l.def.kind === 'category') drawCategory(ctx, l, u)
    else drawWord(ctx, l, u)
    ctx.restore()
  }

  const core = labels.find((l) => l.def.kind === 'core')
  if (core && core.opacity > 0.02) drawName(ctx, core.x, core.y, u)

  return canvas
}

/** 文字の後ろの暗い下地 (BrainNode.vue の .brain-label__text と同じ) */
function drawBackdrop(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, radius: number, border?: string) {
  ctx.save()
  ctx.beginPath()
  ctx.roundRect(x, y, w, h, radius)
  ctx.fillStyle = 'rgba(6,9,18,0.68)'
  ctx.fill()
  if (border) {
    ctx.strokeStyle = border
    ctx.lineWidth = Math.max(1, h / 30)
    ctx.shadowColor = border
    ctx.shadowBlur = h * 0.5
    ctx.stroke()
  }
  ctx.restore()
}

function drawCategory(ctx: CanvasRenderingContext2D, l: PlacedLabel, u: number) {
  const size = M.categorySize * u
  const tracking = size * M.categoryTracking
  const text = l.def.label.toUpperCase()
  ctx.font = `700 ${size}px ${FONT_DISPLAY}`
  const textW = [...text].reduce((w, ch) => w + ctx.measureText(ch).width + tracking, 0) - tracking
  const padX = size * M.categoryPadX
  const h = size * 1.25 + size * M.categoryPadY * 2
  const w = textW + padX * 2
  const left = l.side === 'right' ? l.x + M.categoryOffset * u + l.dx : l.x - M.categoryOffset * u - l.dx - w
  const y = l.y + l.dy
  drawBackdrop(ctx, left, y - h / 2, w, h, size * 0.5, hexAlpha(l.def.color, 0.55))
  ctx.fillStyle = l.def.color
  let x = left + padX
  for (const ch of text) {
    ctx.fillText(ch, x, y)
    x += ctx.measureText(ch).width + tracking
  }
}

function drawWord(ctx: CanvasRenderingContext2D, l: PlacedLabel, u: number) {
  const y = l.y + l.dy
  if (l.def.qr) {
    const size = M.qrExportSize * u
    const left = l.side === 'right' ? l.x + M.childOffset * u + l.dx : l.x - M.childOffset * u - l.dx - size
    ctx.shadowColor = 'rgba(255,217,90,0.45)'
    ctx.shadowBlur = 14 * u
    drawQr(ctx, l.def.qr, left, y - size / 2, size, { fg: '#080B14', bg: '#EEF3FF', radius: size * 0.12, quiet: 2 })
    return
  }
  const size = M.childSize * u
  ctx.font = `500 ${size}px ${FONT_DISPLAY}`
  const dash = M.childDash * u
  const gap = M.childGap * u
  const padX = size * M.childPadX
  const h = size * 1.25 + size * M.childPadY * 2
  const w = ctx.measureText(l.def.label).width + padX * 2
  const total = dash + gap + w
  const start = l.side === 'right' ? l.x + M.childOffset * u + l.dx : l.x - M.childOffset * u - l.dx - total
  // 右側: [線][下地]、左側: [下地][線]
  const dashX = l.side === 'right' ? start : start + w + gap
  const boxX = l.side === 'right' ? start + dash + gap : start
  ctx.fillStyle = l.def.color
  ctx.fillRect(dashX, y - 0.75 * u, dash, 1.5 * u)
  drawBackdrop(ctx, boxX, y - h / 2, w, h, size * 0.4)
  ctx.fillStyle = '#FFFFFF'
  ctx.fillText(l.def.label, boxX + padX, y)
}

function hexAlpha(hex: string, alpha: number) {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`
}

/** 中央の名前 (BrainNode.vue の .is-core と同じ見た目) */
function drawName(ctx: CanvasRenderingContext2D, x: number, y: number, u: number) {
  const r = (M.ring * u) / 2
  const bg = ctx.createRadialGradient(x, y, 0, x, y, r * 1.56)
  bg.addColorStop(0, 'rgba(8,11,20,0.78)')
  bg.addColorStop(0.52, 'rgba(8,11,20,0.45)')
  bg.addColorStop(0.8, 'rgba(8,11,20,0)')
  bg.addColorStop(1, 'rgba(8,11,20,0)')
  ctx.fillStyle = bg
  ctx.beginPath()
  ctx.arc(x, y, r * 1.56, 0, Math.PI * 2)
  ctx.fill()

  ctx.save()
  ctx.strokeStyle = 'rgba(214,232,255,0.42)'
  ctx.lineWidth = Math.max(1, u)
  ctx.shadowColor = 'rgba(140,210,255,0.9)'
  ctx.shadowBlur = 14 * u
  ctx.beginPath()
  ctx.arc(x, y, r * 0.78, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()

  ctx.save()
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.font = `700 ${M.nameSize * u}px ${FONT_JP}`
  ctx.fillStyle = '#FFFFFF'
  ctx.shadowColor = 'rgba(140,210,255,0.95)'
  ctx.shadowBlur = 22 * u
  ctx.fillText(profile.name, x, y)
  ctx.shadowBlur = 6 * u
  ctx.fillText(profile.name, x, y)
  ctx.restore()
}

export async function savePng(canvas: HTMLCanvasElement, fileName: string) {
  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('PNGの生成に失敗しました'))), 'image/png'),
  )
  // スマートフォンでは共有シートから「画像を保存」できるようにする
  const file = new File([blob], fileName, { type: 'image/png' })
  if (matchMedia('(pointer: coarse)').matches && navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file], title: 'MY BRAIN' })
      return
    } catch (e) {
      if ((e as DOMException).name === 'AbortError') return
    }
  }
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = fileName
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 5000)
}
