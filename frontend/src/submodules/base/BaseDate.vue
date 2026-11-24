<script setup lang="ts">
import { computed } from 'vue';
import { now } from './now';

const props = withDefaults(
  defineProps<{ value: string; mode?: 'relative' | 'time' | 'date-time'; timeZone?: string }>(),
  {
    mode: 'relative',
  }
);

const relativeTimeFormat = new Intl.RelativeTimeFormat('en', { numeric: 'auto' });
const timeFormat = computed(
  () => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', timeZone: props.timeZone })
);
const absoluteFormat = computed(
  () => new Intl.DateTimeFormat('en-GB', { dateStyle: 'medium', timeStyle: 'short', timeZone: props.timeZone })
);
const units = [
  { unit: 'day', seconds: 24 * 60 * 60 },
  { unit: 'hour', seconds: 60 * 60 },
  { unit: 'minute', seconds: 60 },
] as const;

const date = computed(() => new Date(props.value));

const label = computed(() => {
  if (props.mode === 'time') return timeFormat.value.format(date.value);
  if (props.mode === 'date-time') return absoluteFormat.value.format(date.value);
  const secondsFromNow = (date.value.getTime() - now.value) / 1000;
  const matchingUnit = units.find(({ seconds }) => Math.abs(secondsFromNow) >= seconds);
  if (!matchingUnit) return 'just now';
  return relativeTimeFormat.format(Math.round(secondsFromNow / matchingUnit.seconds), matchingUnit.unit);
});
</script>

<template>
  <time :datetime="value">{{ label }}<q-tooltip>{{ absoluteFormat.format(date) }}</q-tooltip></time>
</template>
