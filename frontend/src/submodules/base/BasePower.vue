<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ watts: number; wattsOnly?: boolean }>();

const powerFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });

const label = computed(() =>
  props.wattsOnly
    ? `${powerFormat.format(props.watts)} W`
    : props.watts >= 1000
      ? `${powerFormat.format(props.watts / 1000)} kW`
      : `${Math.round(props.watts)} W`
);
</script>

<template>
  <span>{{ label }}</span>
</template>
