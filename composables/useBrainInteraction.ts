/**
 * ホバー・クリック・ダブルクリックとカメラ移動。
 * ドラッグ回転・ズーム・ピンチは OrbitControls が担当し、ここでは
 * 「動かさずに離した」ポインターだけをクリック(タップ)として扱う。
 */
import gsap from 'gsap'
import * as THREE from 'three'
import type { BrainNodes } from '~/composables/useBrainNodes'
import type { BrainScene } from '~/composables/useBrainScene'

export interface BrainInteractionOptions {
  scene: BrainScene
  nodes: BrainNodes
  onSelect: (id: string | null) => void
  onHover: (id: string | null) => void
  /** false の間はクリック・ホバーを無視する (スクリーンショットモード) */
  canInteract: () => boolean
}

const FOCUS_DISTANCE = { core: 0, category: 2.7, child: 2.1, neuron: 1.6 } as const

export function useBrainInteraction({ scene, nodes, onSelect, onHover, canInteract }: BrainInteractionOptions) {
  const { camera, controls, renderer } = scene
  const dom = renderer.domElement
  let hovered: number | null = null
  let selected: number | null = null
  let cameraTween: gsap.core.Tween | null = null
  let rotateTimer: ReturnType<typeof setTimeout> | null = null

  // ---------------------------------------------------------------- picking

  const v = new THREE.Vector3()
  function pick(clientX: number, clientY: number, touch: boolean): number | null {
    const rect = dom.getBoundingClientRect()
    const px = clientX - rect.left
    const py = clientY - rect.top
    const pxPerUnit = rect.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2))
    let best: number | null = null
    let bestScore = Infinity
    for (const i of nodes.interactive) {
      const n = nodes.nodes[i]!
      if (n.reveal < 0.5) continue
      v.copy(n.pos).applyMatrix4(camera.matrixWorldInverse)
      const depth = -v.z
      if (depth < 0.1) continue
      v.copy(n.pos).project(camera)
      const sx = ((v.x + 1) / 2) * rect.width
      const sy = ((1 - v.y) / 2) * rect.height
      const radius =
        n.kind === 'core'
          ? 36
          : Math.max(((n.radius * n.scale * pxPerUnit) / depth) * 1.8, touch ? 22 : 13)
      const d = Math.hypot(sx - px, sy - py)
      if (d > radius) continue
      const score = d / radius + depth * 0.03
      if (score < bestScore) {
        bestScore = score
        best = i
      }
    }
    return best
  }

  // ---------------------------------------------------------------- camera

  function animateCamera(endTarget: THREE.Vector3, endDir: THREE.Vector3, endLen: number, duration = 1.6, ease = 'power3.inOut') {
    cameraTween?.kill()
    // 慣性(ダンピング)の残りを消してから動かす
    controls.enableDamping = false
    controls.update()
    controls.enableDamping = true

    const startTarget = controls.target.clone()
    const offset = camera.position.clone().sub(startTarget)
    const startLen = offset.length()
    const startDir = offset.normalize()
    const dirEnd = endDir.clone().normalize()
    // 直線ではなく注視点のまわりを回り込むように移動する (脳の中を突き抜けない)
    const q = new THREE.Quaternion().setFromUnitVectors(startDir, dirEnd)
    const qi = new THREE.Quaternion()
    const dir = new THREE.Vector3()
    const state = { t: 0 }
    return new Promise<void>((resolve) => {
      cameraTween = gsap.to(state, {
        t: 1,
        duration,
        ease,
        onUpdate: () => {
          controls.target.lerpVectors(startTarget, endTarget, state.t)
          qi.identity().slerp(q, state.t)
          dir.copy(startDir).applyQuaternion(qi)
          camera.position.copy(controls.target).addScaledVector(dir, THREE.MathUtils.lerp(startLen, endLen, state.t))
        },
        onComplete: () => {
          cameraTween = null
          resolve()
        },
        onInterrupt: () => resolve(),
      })
    })
  }

  const isPortrait = () => scene.size.width / scene.size.height < 0.85

  function flyTo(index: number) {
    const n = nodes.nodes[index]!
    const current = camera.position.clone().sub(controls.target).normalize()
    let dir: THREE.Vector3
    let len: number
    if (n.kind === 'core') {
      dir = current
      len = scene.fitDistance() * 0.72
    } else {
      // 脳の外側から覗き込む向き + いまの視点を少し残す
      const outward = n.base.clone().sub(scene.center).normalize()
      dir = outward.multiplyScalar(0.95).add(current.multiplyScalar(0.55))
      dir.y += 0.18
      dir.normalize()
      len = FOCUS_DISTANCE[n.kind] * (isPortrait() ? 1.45 : 1)
    }
    return animateCamera(n.base.clone(), dir, len, 1.7)
  }

  // ---------------------------------------------------------------- selection

  function setHovered(index: number | null) {
    if (index === hovered) return
    hovered = index
    nodes.setState(selected, hovered)
    dom.style.cursor = index != null ? 'pointer' : ''
    onHover(index != null ? nodes.nodes[index]!.id : null)
  }

  function select(index: number) {
    if (rotateTimer) clearTimeout(rotateTimer)
    selected = index
    controls.autoRotate = false
    nodes.setState(selected, hovered)
    onSelect(nodes.nodes[index]!.id)
    void flyTo(index)
  }

  function deselect() {
    if (selected == null) return
    selected = null
    nodes.setState(selected, hovered)
    onSelect(null)
    // しばらく触らなければ、またゆっくり回り始める
    if (rotateTimer) clearTimeout(rotateTimer)
    rotateTimer = setTimeout(() => {
      if (selected == null && canInteract()) controls.autoRotate = true
    }, 2500)
  }

  function overviewDirection() {
    // 水平方向の向きは今のまま、高さだけ全体表示の角度に戻す
    const d = camera.position.clone().sub(controls.target)
    d.y = 0
    if (d.lengthSq() < 1e-6) d.set(0, 0, 1)
    d.normalize().multiplyScalar(Math.sqrt(1 - scene.overviewDir.y ** 2))
    d.y = scene.overviewDir.y
    return d
  }

  async function resetView() {
    if (rotateTimer) clearTimeout(rotateTimer)
    selected = null
    nodes.setState(null, hovered)
    onSelect(null)
    await animateCamera(scene.center.clone(), overviewDirection(), scene.fitDistance(), 1.8)
    if (selected == null && canInteract()) controls.autoRotate = true
  }

  // ---------------------------------------------------------------- pointer

  let down: { x: number; y: number; t: number; multi: boolean } | null = null
  const activePointers = new Set<number>()
  let lastTap = { t: 0, x: 0, y: 0 }

  const onPointerDown = (e: PointerEvent) => {
    activePointers.add(e.pointerId)
    if (activePointers.size > 1) {
      if (down) down.multi = true
      return
    }
    down = { x: e.clientX, y: e.clientY, t: performance.now(), multi: false }
  }

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse' || e.buttons !== 0 || !canInteract()) return
    setHovered(pick(e.clientX, e.clientY, false))
  }

  const onPointerUp = (e: PointerEvent) => {
    activePointers.delete(e.pointerId)
    const start = down
    if (activePointers.size === 0) down = null
    if (!start || start.multi || !canInteract()) return
    const moved = Math.hypot(e.clientX - start.x, e.clientY - start.y)
    if (moved > 7 || performance.now() - start.t > 600) return

    // ダブルクリック / ダブルタップ → 全体表示に戻す
    const now = performance.now()
    if (now - lastTap.t < 330 && Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 32) {
      lastTap.t = 0
      void resetView()
      return
    }
    lastTap = { t: now, x: e.clientX, y: e.clientY }

    const hit = pick(e.clientX, e.clientY, e.pointerType !== 'mouse')
    if (hit != null) select(hit)
    else deselect()
  }

  const onPointerCancel = (e: PointerEvent) => {
    activePointers.delete(e.pointerId)
    if (activePointers.size === 0) down = null
  }
  const onLeave = () => setHovered(null)
  const onControlStart = () => {
    // ユーザーが触ったらカメラのアニメーションは中断して操作を優先
    cameraTween?.kill()
    cameraTween = null
  }

  dom.addEventListener('pointerdown', onPointerDown)
  dom.addEventListener('pointermove', onPointerMove)
  dom.addEventListener('pointerup', onPointerUp)
  dom.addEventListener('pointercancel', onPointerCancel)
  dom.addEventListener('pointerleave', onLeave)
  controls.addEventListener('start', onControlStart)

  function dispose() {
    cameraTween?.kill()
    if (rotateTimer) clearTimeout(rotateTimer)
    dom.removeEventListener('pointerdown', onPointerDown)
    dom.removeEventListener('pointermove', onPointerMove)
    dom.removeEventListener('pointerup', onPointerUp)
    dom.removeEventListener('pointercancel', onPointerCancel)
    dom.removeEventListener('pointerleave', onLeave)
    controls.removeEventListener('start', onControlStart)
  }

  return {
    get selected() {
      return selected
    },
    get hovered() {
      return hovered
    },
    select,
    deselect,
    resetView,
    setHovered,
    animateCamera,
    dispose,
  }
}

export type BrainInteraction = ReturnType<typeof useBrainInteraction>
