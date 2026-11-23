<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ wattHours: number }>();

const energyFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 2 });

const label = computed(() =>
  props.wattHours >= 1000 ? `${energyFormat.format(props.wattHours / 1000)} kWh` : `${Math.round(props.wattHours)} Wh`
);
</script>

<template>
  <span>{{ label }}</span>
</template>
