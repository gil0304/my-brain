import { encode } from 'uqr'

export interface QrMatrix {
  size: number
  data: boolean[][]
}

const cache = new Map<string, QrMatrix>()

/** QR コードのモジュール配列 (余白なし。余白は描画側でつける) */
export function qrMatrix(text: string): QrMatrix {
  let m = cache.get(text)
  if (!m) {
    const r = encode(text, { ecc: 'M', border: 0 })
    m = { size: r.size, data: r.data }
    cache.set(text, m)
  }
  return m
}

/** SVG の path (1モジュール = 1単位) */
export function qrPath(m: QrMatrix) {
  let d = ''
  m.data.forEach((row, y) => {
    let x = 0
    while (x < m.size) {
      if (!row[x]) {
        x++
        continue
      }
      let w = 1
      while (x + w < m.size && row[x + w]) w++
      d += `M${x} ${y}h${w}v1h${-w}z`
      x += w
    }
  })
  return d
}

/** canvas に QR を描く。quiet zone 込みで size × size に収める */
export function drawQr(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, size: number, opts: { fg: string; bg: string; radius: number; quiet?: number }) {
  const m = qrMatrix(text)
  const quiet = opts.quiet ?? 2
  const cell = size / (m.size + quiet * 2)
  ctx.save()
  ctx.fillStyle = opts.bg
  ctx.beginPath()
  ctx.roundRect(x, y, size, size, opts.radius)
  ctx.fill()
  // 光のにじみは背景だけ。モジュールにかかると読み取りにくくなる
  ctx.shadowBlur = 0
  ctx.shadowColor = 'transparent'
  ctx.fillStyle = opts.fg
  const ox = x + quiet * cell
  const oy = y + quiet * cell
  m.data.forEach((row, r) =>
    row.forEach((on, c) => {
      // 隙間が出ないよう少しだけ重ねて塗る
      if (on) ctx.fillRect(ox + c * cell, oy + r * cell, cell + 0.5, cell + 0.5)
    }),
  )
  ctx.restore()
}
