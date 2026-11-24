<script setup lang="ts">
import { computed } from 'vue';

const props = defineProps<{ watts: number }>();

const smallPowerFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 1 });
const largePowerFormat = new Intl.NumberFormat('en', { maximumFractionDigits: 0 });

const label = computed(() => `${(props.watts >= 1000 ? largePowerFormat : smallPowerFormat).format(props.watts)} W`);
</script>

<template>
  <span>{{ label }}</span>
</template>
