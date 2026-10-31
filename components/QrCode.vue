<script setup lang="ts">
import { computed } from 'vue'
import { qrMatrix, qrPath } from '~/lib/qr'

const props = withDefaults(
  defineProps<{
    value: string
    /** quiet zone (モジュール数) */
    quiet?: number
    fg?: string
    bg?: string
  }>(),
  { quiet: 2, fg: '#080B14', bg: '#EEF3FF' },
)

const matrix = computed(() => qrMatrix(props.value))
const path = computed(() => qrPath(matrix.value))
const box = computed(() => matrix.value.size + props.quiet * 2)
</script>

<template>
  <svg class="qr" :viewBox="`0 0 ${box} ${box}`" role="img" :aria-label="`QRコード: ${value}`" shape-rendering="crispEdges">
    <rect :width="box" :height="box" :rx="box * 0.08" :fill="bg" />
    <path :d="path" :fill="fg" :transform="`translate(${quiet} ${quiet})`" />
  </svg>
</template>

<style scoped>
.qr {
  display: block;
  width: 100%;
  height: auto;
}
</style>
