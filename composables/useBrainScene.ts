/**
 * Renderer / Scene / Camera / Controls / Postprocessing (Bloom) と描画ループ。
 * - タブが非表示になったら描画を止める
 * - フレームレートが落ちる端末では解像度 → Bloom の順に自動で品質を下げる
 * - SNS用画像は表示とは別の解像度で1フレームだけ描画して取り出す
 */
import * as THREE from 'three'
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import type { SharedUniforms } from '~/composables/useBrainNodes'
import { BRAIN_CENTER, BRAIN_RADIUS } from '~/lib/brainShape'
import type { QualitySettings } from '~/lib/quality'

export const BACKGROUND = '#080B14'

/** 全体表示のときのカメラの向き (少し上・斜め前から。脳の側面がいちばん脳らしく見える) */
const OVERVIEW_DIR = new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(70), THREE.MathUtils.degToRad(58))

export interface BrainSceneOptions {
  container: HTMLElement
  quality: QualitySettings
  uniforms: SharedUniforms
  onFrame: (dt: number) => void
}

export function useBrainScene({ container, quality, uniforms, onFrame }: BrainSceneOptions) {
  const renderer = new THREE.WebGLRenderer({
    antialias: false,
    alpha: false,
    stencil: false,
    powerPreference: 'high-performance',
  })
  renderer.setClearColor(BACKGROUND, 1)
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.domElement.classList.add('brain-canvas')
  container.prepend(renderer.domElement)

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND)

  const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 200)
  const center = new THREE.Vector3(...BRAIN_CENTER)
  camera.position.copy(center).addScaledVector(OVERVIEW_DIR, 8)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.target.copy(center)
  controls.enableDamping = true
  controls.dampingFactor = 0.06
  controls.rotateSpeed = 0.55
  controls.zoomSpeed = 0.8
  controls.enablePan = false
  controls.minDistance = 0.6
  controls.maxDistance = 16
  controls.autoRotate = true
  controls.autoRotateSpeed = quality.reducedMotion ? 0.15 : 0.6
  controls.touches = { ONE: THREE.TOUCH.ROTATE, TWO: THREE.TOUCH.DOLLY_ROTATE }

  // ---- postprocessing
  const target = new THREE.WebGLRenderTarget(1, 1, { type: THREE.HalfFloatType, samples: quality.msaaSamples })
  const composer = new EffectComposer(renderer, target)
  composer.addPass(new RenderPass(scene, camera))
  const bloom = new UnrealBloomPass(new THREE.Vector2(1, 1), 0.6, 0.5, 0.1)
  bloom.enabled = quality.bloom
  composer.addPass(bloom)
  composer.addPass(new OutputPass())

  let width = 1
  let height = 1
  let pixelRatio = Math.min(window.devicePixelRatio || 1, quality.maxPixelRatio)

  const fovFor = (aspect: number) => (aspect < 0.85 ? 50 : 38)

  function applySize(w: number, h: number, pr: number) {
    renderer.setPixelRatio(pr)
    renderer.setSize(w, h, false)
    composer.setPixelRatio(pr)
    composer.setSize(w, h)
    camera.aspect = w / h
    camera.fov = fovFor(camera.aspect)
    camera.updateProjectionMatrix()
    uniforms.uScale.value = (h * pr) / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    uniforms.uPixelRatio.value = pr
  }

  /** 指定アスペクト比で脳全体が収まるカメラ距離 */
  function fitDistance(aspect = camera.aspect, margin = 1.1) {
    const vfov = THREE.MathUtils.degToRad(fovFor(aspect))
    const hfov = 2 * Math.atan(Math.tan(vfov / 2) * aspect)
    // 縦長画面では左右を少しはみ出させて、脳を大きく見せる
    const radius = aspect < 0.85 ? BRAIN_RADIUS * 0.86 : BRAIN_RADIUS
    return (radius / Math.sin(Math.min(vfov, hfov) / 2)) * margin
  }

  function resize() {
    const w = Math.max(1, container.clientWidth)
    const h = Math.max(1, container.clientHeight)
    if (w === width && h === height) return
    width = w
    height = h
    applySize(w, h, pixelRatio)
  }
  const ro = new ResizeObserver(() => {
    resize()
    composer.render(0)
  })
  ro.observe(container)
  resize()

  // ---- loop
  let last = performance.now()
  let elapsed = 0
  let running = false
  const floatSpeed = quality.reducedMotion ? 0.3 : 1

  // 自動品質調整
  let perfFrames = 0
  let perfTime = 0
  let perfLevel = 0

  function adaptQuality(dt: number) {
    if (elapsed < 4 || perfLevel >= 3) return
    perfFrames++
    perfTime += dt
    if (perfFrames < 90) return
    const fps = perfFrames / perfTime
    perfFrames = 0
    perfTime = 0
    if (fps >= 45) return
    perfLevel++
    if (perfLevel === 1 && pixelRatio > 1.25) pixelRatio = Math.max(1.25, pixelRatio * 0.75)
    else if (perfLevel <= 2 && pixelRatio > 1) pixelRatio = 1
    else bloom.enabled = false
    applySize(width, height, pixelRatio)
  }

  function frame(now: number) {
    const dt = Math.min(0.05, (now - last) / 1000)
    last = now
    elapsed += dt
    uniforms.uTime.value += dt
    uniforms.uFloatTime.value += dt * floatSpeed
    controls.update(dt)
    onFrame(dt)
    composer.render(dt)
    adaptQuality(dt)
  }

  function start() {
    if (running) return
    running = true
    last = performance.now()
    renderer.setAnimationLoop(frame)
  }
  function stop() {
    running = false
    renderer.setAnimationLoop(null)
  }
  const onVisibility = () => (document.hidden ? stop() : start())
  document.addEventListener('visibilitychange', onVisibility)

  /**
   * 表示とは別の解像度で1フレーム描画し、その画像を返す。
   * onRendered は書き出しサイズのカメラのまま呼ばれる (ラベル位置の計算用)。
   * (preserveDrawingBuffer なしでも、描画直後の同期処理内なら canvas から読み出せる)
   */
  function capture(w: number, h: number, onRendered?: () => void): HTMLCanvasElement {
    applySize(w, h, 1)
    camera.updateMatrixWorld()
    composer.render(0)
    const out = document.createElement('canvas')
    out.width = w
    out.height = h
    out.getContext('2d')!.drawImage(renderer.domElement, 0, 0, w, h)
    onRendered?.()
    applySize(width, height, pixelRatio)
    composer.render(0)
    return out
  }

  function dispose() {
    stop()
    ro.disconnect()
    document.removeEventListener('visibilitychange', onVisibility)
    controls.dispose()
    composer.dispose()
    target.dispose()
    renderer.dispose()
    renderer.domElement.remove()
  }

  return {
    renderer,
    scene,
    camera,
    controls,
    center,
    overviewDir: OVERVIEW_DIR,
    fovFor,
    get size() {
      return { width, height }
    },
    fitDistance,
    start,
    stop,
    capture,
    dispose,
  }
}

export type BrainScene = ReturnType<typeof useBrainScene>
