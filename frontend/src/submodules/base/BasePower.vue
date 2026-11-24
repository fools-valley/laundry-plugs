<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ watts: number }>();

const powerFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

const label = computed(() => `${powerFormat.format(props.watts)} W`);
</script>

<template>
  <span>{{ label }}</span>
</template>
