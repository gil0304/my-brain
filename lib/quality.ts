/** 端末性能に合わせた描画設定 */
export interface QualitySettings {
  tier: 'high' | 'low'
  isTouch: boolean
  maxPixelRatio: number
  /** 脳の表面を描く粒子 */
  cortexCount: number
  /** 背景の星 */
  starCount: number
  /** 脳の周りを漂うチリ */
  moteCount: number
  /** 脳の中に散らばる小さなニューロンノード */
  neuronCount: number
  msaaSamples: number
  bloom: boolean
  reducedMotion: boolean
}

export function detectQuality(): QualitySettings {
  const isTouch = matchMedia('(pointer: coarse)').matches
  const shortSide = Math.min(window.screen.width, window.screen.height)
  const cores = navigator.hardwareConcurrency || 4
  const low = (isTouch && shortSide < 820) || cores <= 4
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches

  if (low) {
    return {
      tier: 'low',
      isTouch,
      maxPixelRatio: 1.5,
      cortexCount: 9000,
      starCount: 1100,
      moteCount: 160,
      neuronCount: 130,
      msaaSamples: 0,
      bloom: true,
      reducedMotion,
    }
  }
  return {
    tier: 'high',
    isTouch,
    maxPixelRatio: 2,
    cortexCount: 20000,
    starCount: 2600,
    moteCount: 380,
    neuronCount: 210,
    msaaSamples: 4,
    bloom: true,
    reducedMotion,
  }
}
