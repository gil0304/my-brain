<script setup lang="ts">
/**
 * 3D の脳内ネットワーク本体。
 * three.js のシーン・ノード・操作 (composables) を組み立て、
 * ノードに重ねるワード(HTML ラベル)を毎フレーム追従させる。
 *
 * キーボード: S = PNG保存 (1080×1350) / Shift+S = 正方形 (1080×1080) / Esc = 選択解除
 */
import gsap from 'gsap'
import * as THREE from 'three'
import { nextTick, onBeforeUnmount, onMounted, ref, watch, type ComponentPublicInstance } from 'vue'
import { useBrainInteraction, type BrainInteraction } from '~/composables/useBrainInteraction'
import { createSharedUniforms, useBrainNodes, type BrainNodes } from '~/composables/useBrainNodes'
import { useBrainScene, type BrainScene } from '~/composables/useBrainScene'
import { profile } from '~/data/brain'
import { brainGraph, CORE_ID } from '~/lib/brainGraph'
import { layoutLabels, type LabelDef, type LabelState, type PlacedLabel } from '~/lib/brainLabels'
import { detectQuality } from '~/lib/quality'
import { composeSnapshot, loadSnapshotFonts, savePng, SNAPSHOT_SIZES, snapshotUnit } from '~/lib/snapshot'

const stage = ref<HTMLElement>()
const selectedId = ref<string | null>(null)
const hoveredId = ref<string | null>(null)

// ---------------------------------------------------------------- labels

const labels: LabelDef[] = brainGraph.nodes.map((n) => ({
  id: n.id,
  kind: n.kind,
  label: n.label,
  color: n.color,
  qr: n.qr,
  depth: n.depth,
}))
const labelEls = new Map<string, HTMLElement>()
const labelSides = new Map<string, string>()
const labelStates = new Map<string, LabelState>()

function setLabelEl(id: string, el: Element | ComponentPublicInstance | null) {
  const node = el && '$el' in el ? (el.$el as HTMLElement) : (el as HTMLElement | null)
  if (node) labelEls.set(id, node)
  else labelEls.delete(id)
}

function refreshLabelStates() {
  const sel = selectedId.value
  const related = sel && sel !== CORE_ID ? new Set(brainGraph.related(sel)) : null
  for (const l of labels) {
    let s: LabelState = 'idle'
    if (related) s = l.id === sel ? 'selected' : related.has(l.id) ? 'related' : 'dim'
    else if (l.id === sel) s = 'selected'
    if (hoveredId.value === l.id && s !== 'selected') s = 'hover'
    labelStates.set(l.id, s)
    const el = labelEls.get(l.id)
    if (el) el.dataset.state = s
  }
}
watch([selectedId, hoveredId], refreshLabelStates)

// ---------------------------------------------------------------- engine

let scene: BrainScene | null = null
let nodes: BrainNodes | null = null
let interaction: BrainInteraction | null = null

/**
 * 画像書き出しで試すアングル (斜め前〜真横・少し上から。脳の形がよく見える範囲)。
 * この中から、ワードが一番きれいに収まるものを選ぶ。
 */
const EXPORT_ANGLES = [60, 68].flatMap((polar) =>
  [40, 52, 62, 74, 86, 98].map((azimuth) => ({
    polar,
    azimuth,
    dir: new THREE.Vector3().setFromSphericalCoords(1, THREE.MathUtils.degToRad(polar), THREE.MathUtils.degToRad(azimuth)),
  })),
)

/** 画面に表示中のラベルの状態 (重なり回避で位置・濃さが急に変わらないよう、なめらかに追従させる) */
const shown = new Map<string, { dy: number; opacity: number; side: string }>()
const labelLayer = ref<HTMLElement>()
let labelScale = 0

/** 画面に描かれる脳の大きさに合わせた文字の倍率 (小さい画面で文字だらけにならないように) */
function scaleFor(width: number, height: number) {
  const brainPx = width / height < 0.85 ? width * 1.15 : Math.min(width * 0.8, height)
  return Math.min(1.15, Math.max(0.84, brainPx / 820))
}

function updateLabels(dt: number) {
  if (!scene || !nodes) return
  const scale = scaleFor(scene.size.width, scene.size.height)
  if (Math.abs(scale - labelScale) > 0.005) {
    labelScale = scale
    labelLayer.value?.style.setProperty('--s', scale.toFixed(3))
  }
  const { labels: placed } = layoutLabels({
    defs: labels,
    states: labelStates,
    nodes,
    camera: scene.camera,
    target: scene.controls.target,
    width: scene.size.width,
    height: scene.size.height,
    unit: scale,
  })
  const k = Math.min(1, dt * 9)
  for (const p of placed) {
    const el = labelEls.get(p.def.id)
    if (!el) continue
    let s = shown.get(p.def.id)
    if (!s) shown.set(p.def.id, (s = { dy: p.dy, opacity: p.opacity, side: '' }))
    s.dy += (p.dy - s.dy) * k
    s.opacity += (p.opacity - s.opacity) * k
    el.style.transform = `translate3d(${p.x.toFixed(1)}px, ${(p.y + s.dy).toFixed(1)}px, 0)`
    el.style.opacity = s.opacity.toFixed(3)
    if (s.side !== p.side) {
      s.side = p.side
      el.dataset.side = p.side
    }
  }
}

function onFrame(dt: number) {
  nodes?.update(dt)
  updateLabels(dt)
}

function intro() {
  if (!scene || !nodes || !interaction) return
  const fit = scene.fitDistance()
  // 少し回り込みながら引いた位置から寄っていく
  const startDir = scene.overviewDir.clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), -0.9)
  startDir.y += 0.25
  scene.camera.position.copy(scene.center).addScaledVector(startDir.normalize(), fit * 1.55)
  scene.controls.update()
  scene.controls.autoRotate = false
  gsap.to(nodes.uniforms.uReveal, { value: 1.15, duration: 4.6, delay: 0.25, ease: 'power1.inOut' })
  void interaction.animateCamera(scene.center.clone(), scene.overviewDir, fit, 5.2, 'power2.out').then(() => {
    if (interaction?.selected == null && scene) scene.controls.autoRotate = true
  })
}

// ---------------------------------------------------------------- PNG

let saving = false
async function saveSnapshot(format: keyof typeof SNAPSHOT_SIZES) {
  if (!scene || !nodes || saving) return
  saving = true
  try {
    await loadSnapshotFonts(labels.map((l) => l.label).join(''))
    const { width, height } = SNAPSHOT_SIZES[format]
    const { camera, controls } = scene
    const prevPos = camera.position.clone()
    const prevTarget = controls.target.clone()

    // 全部が見える状態で撮る: 出現アニメーションを終わらせ、選択・ホバーの強調を外す
    gsap.killTweensOf(nodes.uniforms.uReveal)
    nodes.uniforms.uReveal.value = 1.15
    nodes.setState(null, null)
    nodes.update(1)
    nodes.update(1)

    const aspect = width / height
    const dist = scene.fitDistance(aspect, aspect < 0.85 ? 1.2 : 1.12)
    const layout = () =>
      layoutLabels({
        defs: labels,
        states: new Map(),
        nodes: nodes!,
        camera,
        target: controls.target,
        width,
        height,
        unit: snapshotUnit(width),
        forExport: true,
      })

    // 書き出しサイズのカメラで、ワードを一番ずらさずに済むアングルを選ぶ (基本の角度に近いほど優先)
    camera.aspect = aspect
    camera.fov = scene.fovFor(aspect)
    camera.updateProjectionMatrix()
    controls.target.copy(scene.center)
    let best = EXPORT_ANGLES[0]!
    let bestScore = Infinity
    for (const angle of EXPORT_ANGLES) {
      camera.position.copy(scene.center).addScaledVector(angle.dir, dist)
      camera.lookAt(controls.target)
      camera.updateMatrixWorld()
      const score = layout().score + (Math.abs(angle.azimuth - 62) + Math.abs(angle.polar - 66)) * 4
      if (score < bestScore) {
        bestScore = score
        best = angle
      }
    }
    camera.position.copy(scene.center).addScaledVector(best.dir, dist)
    camera.lookAt(controls.target)

    let placed: PlacedLabel[] = []
    const image = scene.capture(width, height, () => {
      placed = layout().labels
    })

    camera.position.copy(prevPos)
    controls.target.copy(prevTarget)
    camera.lookAt(prevTarget)
    nodes.setState(interaction?.selected ?? null, interaction?.hovered ?? null)

    const canvas = composeSnapshot(image, placed)
    await savePng(canvas, `my-brain-${profile.nameEn.toLowerCase()}-${width}x${height}.png`)
  } catch (e) {
    console.error(e)
  } finally {
    saving = false
  }
}

function onKey(e: KeyboardEvent) {
  if (e.metaKey || e.ctrlKey || e.altKey) return
  if (e.key === 'Escape') interaction?.deselect()
  else if (e.key === 's' || e.key === 'S') void saveSnapshot(e.shiftKey ? 'square' : 'portrait')
}

onMounted(async () => {
  // .client.vue はマウント後に描画されるので、テンプレート参照は nextTick 後に使う
  await nextTick()
  if (!stage.value) return
  const quality = detectQuality()
  const uniforms = createSharedUniforms()
  nodes = useBrainNodes(brainGraph, quality, uniforms)
  scene = useBrainScene({ container: stage.value, quality, uniforms, onFrame })
  scene.scene.add(nodes.background, nodes.group)
  interaction = useBrainInteraction({
    scene,
    nodes,
    canInteract: () => true,
    onSelect: (id) => (selectedId.value = id),
    onHover: (id) => (hoveredId.value = id),
  })
  refreshLabelStates()

  intro()
  scene.start()
  window.addEventListener('keydown', onKey)
})

onBeforeUnmount(() => {
  window.removeEventListener('keydown', onKey)
  if (nodes) gsap.killTweensOf(nodes.uniforms.uReveal)
  interaction?.dispose()
  nodes?.dispose()
  scene?.dispose()
  interaction = null
  nodes = null
  scene = null
})
</script>

<template>
  <div ref="stage" class="brain-stage">
    <div ref="labelLayer" class="brain-labels">
      <BrainNode
        v-for="l in labels"
        :key="l.id"
        :ref="(el) => setLabelEl(l.id, el)"
        :kind="l.kind"
        :label="l.label"
        :color="l.color"
        :qr="l.qr"
      />
    </div>
    <div class="brain-vignette" />
  </div>
</template>

<style scoped>
.brain-stage {
  position: fixed;
  inset: 0;
  overflow: hidden;
  background: var(--bg);
}
.brain-stage :deep(.brain-canvas) {
  position: absolute;
  inset: 0;
  display: block;
  width: 100%;
  height: 100%;
  touch-action: none;
  cursor: grab;
  outline: none;
}
.brain-stage :deep(.brain-canvas:active) {
  cursor: grabbing;
}
.brain-labels {
  position: absolute;
  inset: 0;
  pointer-events: none;
  overflow: hidden;
}
.brain-vignette {
  position: absolute;
  inset: 0;
  pointer-events: none;
  background: radial-gradient(ellipse farthest-corner at center, rgba(4, 6, 12, 0) 45%, rgba(4, 6, 12, 0.55) 100%);
}
</style>
