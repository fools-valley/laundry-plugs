<script setup lang="ts">
import type { PlugStatus } from '../api/api-client';

defineProps<{ plug?: PlugStatus; label?: string | undefined }>();

const statusLabels = {
  idle: 'available',
  running: 'in use',
  finished: 'available',
  offline: 'offline',
} satisfies Record<PlugStatus['status'], string>;
</script>

<template>
  <article v-if="!plug" class="plug-card column gap-md" aria-busy="true">
    <div class="column items-start gap-sm">
      <h3 class="display"><span class="skeleton">old house washer</span></h3>
      <span class="status skeleton">✦ available</span>
    </div>
    <p class="headline"><span class="skeleton">waiting for you</span></p>
    <p class="telemetry"><span class="skeleton">updated just now · 0 W</span></p>
  </article>
  <article v-else class="plug-card column gap-md" :class="`plug-card--${plug.status}`">
    <div class="column items-start gap-sm">
      <h3 class="display">{{ label ?? plug.identifier.replaceAll('-', ' ') }}</h3>
      <span class="status">✦ {{ statusLabels[plug.status] }}</span>
    </div>

    <p class="headline">
      <template v-if="plug.status === 'running' && plug.cycleStartedAt">
        started <BaseDate :value="plug.cycleStartedAt" />
      </template>
      <template v-else-if="plug.status === 'finished' && plug.lastUsedAt">
        finished <BaseDate :value="plug.lastUsedAt" />
      </template>
      <template v-else-if="plug.status === 'offline'">unplugged</template>
      <template v-else>waiting for you</template>
    </p>
    <p v-if="plug.lastReadingAt" class="telemetry text-muted">
      updated <BaseDate :value="plug.lastReadingAt" />
      <template v-if="plug.lastPowerWatts !== null"> · <BasePower :watts="plug.lastPowerWatts" /> </template>
    </p>
  </article>
</template>

<style lang="scss" scoped>
.plug-card {
  padding: 1rem 1.25rem;
  border-right: 1px solid $ink;
  border-bottom: 1px solid $ink;
  background: $paper;

  &--edge-left {
    border-left: 1px solid $ink;
  }

  &--edge-top {
    border-top: 1px solid $ink;
  }

  &--after-gap {
    margin-top: 1rem;
  }

  h3 {
    font-size: 1.8rem;
    line-height: 1.15;
    margin: 0;
    letter-spacing: normal;
  }
}

.status {
  font-size: 0.875rem;
  text-transform: uppercase;
  letter-spacing: 0.15em;
  padding: 0.3rem 0.75rem;
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
