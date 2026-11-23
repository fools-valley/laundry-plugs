<script setup lang="ts">
import { useQuery } from '@tanstack/vue-query';
import { computed, ref } from 'vue';
import { api } from '../api/api-client';
import { now } from '../base/now';
import { formatPlugName } from './plug-name';

const dateKeyFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', dateStyle: 'short' });
const weekdayFormat = new Intl.DateTimeFormat('en-GB', { weekday: 'short', timeZone: 'UTC' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short', timeZone: 'UTC' });
const weekOffset = ref(0);
const selectedDate = ref('');
const today = computed(() => dateKeyFormat.format(now.value));
const ending = computed(() => {
  const day = new Date(today.value);
  day.setUTCDate(day.getUTCDate() - weekOffset.value * 7);
  return day.toISOString().slice(0, 10);
});

const { data, isPending, isError } = useQuery({
  queryKey: ['plug-usage', ending] as const,
  queryFn: async ({ queryKey, signal }) => {
    const response = await api.plugs.usage.$get({ query: { ending: queryKey[1] } }, { init: { signal } });
    if (!response.ok) throw new Error(`Usage request failed with ${response.status}`);
    return response.json();
  },
  refetchInterval: computed(() => (weekOffset.value === 0 ? 60_000 : false)),
});

const days = computed(() => data.value?.days ?? []);
const selectedDay = computed(
  () =>
    days.value.find((day) => day.date === selectedDate.value) ??
    days.value.findLast((day) => day.uses.length) ??
    days.value.at(-1)
);
const peakUses = computed(() => Math.max(1, ...days.value.map((day) => day.uses.length)));

function moveWeek(direction: number) {
  selectedDate.value = '';
  weekOffset.value += direction;
}
</script>

<template>
  <section aria-labelledby="usage-title">
    <div class="history-heading row items-end justify-between gap-md q-mb-lg">
      <div>
        <div class="section-label">002 / usage</div>
        <h2 id="usage-title" class="display">usage history</h2>
        <div class="text-muted">completed cycles by day · portugal time</div>
      </div>
      <div class="row gap-sm">
        <q-btn outline square no-caps label="previous week" @click="moveWeek(1)" />
        <q-btn outline square no-caps label="next week" :disable="weekOffset === 0" @click="moveWeek(-1)" />
      </div>
    </div>

    <p v-if="isError" role="status">could not load usage history.</p>
    <p v-else-if="isPending" role="status">loading usage history…</p>
    <template v-else-if="selectedDay">
      <div class="days" role="group" aria-label="cycles per day">
        <button
          v-for="day in days"
          :key="day.date"
          class="day"
          type="button"
          :aria-pressed="day.date === selectedDay.date"
          :aria-label="`${dayFormat.format(new Date(day.date))}, ${day.uses.length} ${day.uses.length === 1 ? 'cycle' : 'cycles'}`"
          @click="selectedDate = day.date"
        >
          <span>{{ weekdayFormat.format(new Date(day.date)).toLowerCase() }}</span>
          <span class="bar-track" aria-hidden="true">
            <span class="bar" :style="{ height: `${(day.uses.length / peakUses) * 100}%` }" />
          </span>
          <span>{{ day.uses.length }}</span>
        </button>
      </div>
      <h3 class="display">{{ dayFormat.format(new Date(selectedDay.date)).toLowerCase() }}</h3>
      <p v-if="!selectedDay.uses.length">no completed cycles recorded.</p>
      <ul v-else class="usage-log">
        <li v-for="use in selectedDay.uses" :key="`${use.identifier}-${use.startedAt}`">
          <span>{{ formatPlugName(use.identifier) }}</span>
          <span class="usage-time">
            <BaseDate
              :value="use.startedAt"
              :mode="dateKeyFormat.format(new Date(use.startedAt)) === selectedDay.date ? 'time' : 'date-time'"
              time-zone="Europe/Lisbon"
            />
            –
            <BaseDate :value="use.endedAt" mode="time" time-zone="Europe/Lisbon" />
          </span>
        </li>
      </ul>
    </template>
  </section>
</template>

<style lang="scss" scoped>
h2,
h3 {
  letter-spacing: normal;
  line-height: 1.1;
  margin: 0.5rem 0;
}

h2 {
  font-size: clamp(2.4rem, 6vw, 4rem);
}

h3 {
  font-size: 1.9rem;
  margin-top: 1.5rem;
}

.days {
  display: grid;
  grid-template-columns: repeat(7, minmax(0, 1fr));
  border: 1px solid $ink;
}

.day {
  min-width: 0;
  display: grid;
  justify-items: center;
  gap: 0.45rem;
  padding: 0.65rem 0.2rem;
  border: 0;
  background: $paper;
  color: $ink;
  font: inherit;
  cursor: pointer;

  + .day {
    border-left: 1px solid $ink;
  }

  &:hover,
  &[aria-pressed='true'] {
    background: $moss-soft;
  }

  &:focus-visible {
    outline: 2px solid $moss;
    outline-offset: -3px;
  }
}

.bar-track {
  display: flex;
  align-items: end;
  width: 40%;
  height: 2.8rem;
}

.bar {
  width: 100%;
  background: $moss;
}

.usage-log {
  list-style: none;
  padding: 0;
  margin: 0;

  li {
    display: flex;
    justify-content: space-between;
    flex-wrap: wrap;
    gap: 0.25rem 1rem;
    padding: 0.7rem 0;
    border-top: 1px solid $ink;
  }
}

.usage-time {
  white-space: nowrap;
}
</style>
