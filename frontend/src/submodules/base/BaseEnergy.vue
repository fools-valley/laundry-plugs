<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ wattHours: number }>();

const energyFormat = new Intl.NumberFormat('en', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const label = computed(() => `${energyFormat.format(props.wattHours / 1000)} kWh`);
</script>

<template>
  <span>{{ label }}</span>
</template>
