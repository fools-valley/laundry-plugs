<script setup lang="ts">
import { computed } from 'vue';
import type { PlugStatus } from '../api/api-client';
import { formatPlugName } from './plug-name';

const props = defineProps<{ plug?: PlugStatus }>();

const statusLabels = {
  idle: 'available',
  running: 'in use',
  finished: 'available',
  offline: 'unavailable',
} satisfies Record<PlugStatus['status'], string>;

const name = computed(() => (props.plug ? formatPlugName(props.plug.identifier) : ''));
</script>

<template>
  <article v-if="!plug" class="plug-card column gap-md" aria-busy="true">
    <div class="column items-start gap-sm">
      <h3 class="display"><span class="skeleton">old house washer</span></h3>
      <span class="status skeleton">✦ available</span>
    </div>
    <p class="headline"><span class="skeleton">ready when you are.</span></p>
    <p class="telemetry"><span class="skeleton">updated just now · 0 W</span></p>
  </article>
  <article v-else class="plug-card column gap-md" :class="`plug-card--${plug.status}`">
    <div class="column items-start gap-sm">
      <h3 class="display">{{ name }}</h3>
      <span class="status">✦ {{ statusLabels[plug.status] }}</span>
    </div>

    <p class="headline">
      <template v-if="plug.status === 'running' && plug.currentCycle">
        started <BaseDate :value="plug.currentCycle.startedAt" />.
      </template>
      <template v-else-if="plug.status === 'finished' && plug.lastFinishedCycle">
        last used <BaseDate :value="plug.lastFinishedCycle.endedAt" />.
      </template>
      <template v-else-if="plug.status === 'offline'">does it exist?</template>
      <template v-else>ready when you are.</template>
    </p>
    <p v-if="plug.lastReadingAt" class="telemetry text-muted">
      updated <BaseDate :value="plug.lastReadingAt" />
      <template v-if="plug.lastPowerWatts !== null"> · <BasePower :watts="plug.lastPowerWatts" watts-only /> </template>
    </p>
  </article>
</template>

<style lang="scss" scoped>
.plug-card {
  padding: 1rem 1.25rem;
  border-right: 1px solid $ink;
  border-bottom: 1px solid $ink;
  background: $paper;

  h3 {
    font-size: 1.8rem;
    line-height: 1.15;
    margin: 0;
    letter-spacing: normal;
  }
}

.status {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 0.2rem 0.6rem;
  border: 1px solid currentColor;
}

.plug-card--idle .status,
.plug-card--finished .status {
  color: $paper;
  background: $moss;
  border-color: $moss;
}

.plug-card--running {
  background: $cream;

  .status {
    color: $paper;
    background: $rust;
    border-color: $rust;
  }
}

.plug-card--offline {
  .status,
  h3 {
    color: $muted;
  }
}

.headline {
  font-size: 13px;
  line-height: 1.7;
  margin: 0;
}
.telemetry {
  margin: auto 0 0;
  font-size: 0.75rem;
}
</style>
