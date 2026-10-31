<script setup lang="ts">
import { useHead } from '#imports'
import { profile } from '~/data/brain'

useHead({
  title: `MY BRAIN — ${profile.name}の頭の中`,
  meta: [{ name: 'description', content: `${profile.name}の頭の中を3D空間で可視化したインタラクティブアート。` }],
})
</script>

<template>
  <main>
    <BrainScene />
    <noscript class="noscript">MY BRAIN を見るには JavaScript を有効にしてください。</noscript>
  </main>
</template>

<style scoped>
.noscript {
  position: fixed;
  inset: 0;
  display: grid;
  place-items: center;
  font-family: var(--font-jp);
  color: var(--fg);
}
</style>
