<script setup lang="ts">
/**
 * 3Dノードに重ねる HTML ラベル。
 * 位置(transform)と不透明度は毎フレーム BrainScene が直接書き換える。
 */
defineProps<{
  kind: 'core' | 'category' | 'child'
  label: string
  color: string
  /** ワードの代わりに表示する QR コードの URL */
  qr?: string | null
}>()
</script>

<template>
  <div class="brain-label" :class="`is-${kind}`" :style="{ '--c': color }" data-state="idle" data-side="right" aria-hidden="true">
    <div v-if="kind === 'core'" class="brain-label__inner">
      <span class="brain-label__ring" />
      <span class="brain-label__name">{{ label }}</span>
    </div>
    <div v-else-if="kind === 'category'" class="brain-label__inner">
      <span class="brain-label__text">{{ label }}</span>
    </div>
    <div v-else-if="qr" class="brain-label__inner brain-label__qr">
      <QrCode :value="qr" />
    </div>
    <div v-else class="brain-label__inner">
      <span class="brain-label__text">{{ label }}</span>
    </div>
  </div>
</template>

<style scoped>
.brain-label {
  position: absolute;
  top: 0;
  left: 0;
  opacity: 0;
  pointer-events: none;
  will-change: transform, opacity;
  white-space: nowrap;
}

/* ---- 中心: 名前 */
.is-core .brain-label__inner {
  position: relative;
  display: grid;
  place-items: center;
  width: var(--ring, 76px);
  height: var(--ring, 76px);
  transform: translate(-50%, -50%);
}
.is-core .brain-label__inner::before {
  content: '';
  position: absolute;
  inset: -28%;
  border-radius: 50%;
  background: radial-gradient(circle closest-side, rgba(8, 11, 20, 0.78) 0%, rgba(8, 11, 20, 0.45) 52%, rgba(8, 11, 20, 0) 80%);
}
.brain-label__ring {
  position: absolute;
  inset: 11%;
  border-radius: 50%;
  border: 1px solid rgba(214, 232, 255, 0.42);
  box-shadow:
    0 0 14px rgba(140, 210, 255, 0.45),
    inset 0 0 14px rgba(140, 210, 255, 0.25);
  animation: ring-breathe 5s ease-in-out infinite;
}
.brain-label__name {
  position: relative;
  font-family: var(--font-jp);
  font-weight: 700;
  font-size: var(--name-size, 28px);
  line-height: 1;
  color: #fff;
  letter-spacing: 0.04em;
  text-shadow:
    0 0 6px rgba(140, 210, 255, 0.9),
    0 0 22px rgba(140, 210, 255, 0.75);
}
@keyframes ring-breathe {
  0%,
  100% {
    transform: scale(1);
    opacity: 0.85;
  }
  50% {
    transform: scale(1.06);
    opacity: 1;
  }
}

/* ---- カテゴリー・ワード共通: 光の上でも読めるよう、文字の後ろに暗い下地を敷く */
.brain-label__text {
  display: block;
  line-height: 1.25;
  background: rgba(6, 9, 18, 0.68);
  -webkit-backdrop-filter: blur(3px);
  backdrop-filter: blur(3px);
  transition:
    font-size 0.3s ease,
    background 0.3s ease;
}

/*
 * 文字の大きさは、画面上の脳の大きさに合わせて BrainScene が --s を設定する
 * (lib/brainLabels.ts の LABEL_METRICS と同じ数値)
 */

/* ---- カテゴリー */
.is-category .brain-label__inner {
  transform: translate(calc(14px * var(--s, 1)), -50%);
  font-family: var(--font-display);
  font-size: calc(var(--cat-size, 15px) * var(--s, 1));
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--c);
}
.is-category .brain-label__text {
  padding: 0.27em 0.67em;
  border-radius: 0.5em;
  border: 1px solid color-mix(in srgb, var(--c) 55%, transparent);
  box-shadow: 0 0 16px color-mix(in srgb, var(--c) 28%, transparent);
}

/* ---- ワード */
.is-child .brain-label__inner {
  display: flex;
  align-items: center;
  gap: calc(4px * var(--s, 1));
  transform: translate(calc(10px * var(--s, 1)), -50%);
  font-family: var(--font-display);
  font-size: calc(var(--word-size, 15px) * var(--s, 1));
  font-weight: 500;
  letter-spacing: 0.01em;
  color: #fff;
}
.is-child .brain-label__inner::before {
  content: '';
  flex: none;
  width: calc(8px * var(--s, 1));
  height: 1.5px;
  background: var(--c);
}
.is-child .brain-label__text {
  padding: 0.2em 0.53em;
  border-radius: 0.4em;
  box-shadow: inset 0 0 0 1px rgba(255, 255, 255, 0.06);
}

/* ---- QR コードのワード (ホバー・選択で読み取れる大きさに) */
.is-child .brain-label__qr {
  display: block;
  width: calc(48px * var(--s, 1));
  border-radius: 6px;
  box-shadow:
    0 0 0 1px rgba(255, 217, 90, 0.45),
    0 0 18px rgba(255, 217, 90, 0.3);
  transition: width 0.35s ease;
}
.is-child .brain-label__qr::before {
  display: none;
}
.brain-label[data-state='hover'] .brain-label__qr,
.brain-label[data-state='selected'] .brain-label__qr {
  width: 120px;
}

/* 強調中はひとまわり大きく */
.brain-label[data-state='hover'],
.brain-label[data-state='selected'] {
  --cat-size: 16.5px;
  --word-size: 16.5px;
  z-index: 1;
}
.brain-label[data-state='hover'] .brain-label__text,
.brain-label[data-state='selected'] .brain-label__text {
  background: rgba(6, 9, 18, 0.85);
}

/* 画面の右端に近いワードはノードの左側に出す */
.is-category[data-side='left'] .brain-label__inner {
  transform: translate(calc(-100% - 14px * var(--s, 1)), -50%);
}
.is-child[data-side='left'] .brain-label__inner {
  flex-direction: row-reverse;
  transform: translate(calc(-100% - 10px * var(--s, 1)), -50%);
}
</style>
