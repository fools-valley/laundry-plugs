<script setup lang="ts">
import { ref } from 'vue';
import type { PlugStatus } from '../api/api-client';

defineProps<{ plug?: PlugStatus; label?: string | undefined }>();

const waitingDialogOpen = ref(false);

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
  <article v-else class="plug-card column no-wrap gap-md" :class="`plug-card--${plug.status}`">
    <div class="column no-wrap items-start gap-sm">
      <h3 class="display">{{ label ?? plug.identifier.replaceAll('-', ' ') }}</h3>
      <div class="status-row row items-center">
        <span class="status">✦ {{ statusLabels[plug.status] }}</span>
        <span v-if="plug.waitingNames.length === 1" class="waiting row no-wrap">
          <span class="waiting-name">
            {{ plug.waitingNames[0] ?? 'someone' }}<q-tooltip>{{ plug.waitingNames[0] ?? 'someone' }}</q-tooltip>
          </span>
          <span class="waiting-suffix">&nbsp;is waiting</span>
        </span>
        <button
          v-else-if="plug.waitingNames.length > 1"
          type="button"
          class="waiting waiting-button"
          @click="waitingDialogOpen = true"
        >
          {{ plug.waitingNames.length }} people are waiting
        </button>
      </div>
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
    <q-dialog v-model="waitingDialogOpen" transition-duration="0">
      <div class="waiting-dialog column gap-md">
        <h4 class="section-label q-my-none">waiting for {{ label ?? plug.identifier.replaceAll('-', ' ') }}</h4>
        <ul class="column gap-xs">
          <li v-for="(name, index) in plug.waitingNames" :key="index">✦ {{ name ?? 'someone' }}</li>
        </ul>
        <button v-close-popup type="button" class="waiting-button self-end">close</button>
      </div>
    </q-dialog>
    <p v-if="plug.lastReadingAt" class="telemetry text-muted">
      updated <BaseDate :value="plug.lastReadingAt" />
      <template v-if="plug.lastPowerWatts !== null"> · <BasePower :watts="plug.lastPowerWatts" /> </template>
      ·
      <a :href="`https://t.me/FoolsLaundryBot?start=${plug.identifier}`" target="_blank" rel="noopener"
        ><em>notify</em></a
      >
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
.status-row {
  max-width: 100%;
  gap: 8px 16px;

  .status {
    flex: none;
  }
}

.waiting {
  min-width: 0;
  max-width: 100%;
  font-size: 13px;
  white-space: nowrap;
}

.waiting-name,
button.waiting {
  min-width: 0;
  max-width: 100%;
  overflow: hidden;
  text-overflow: ellipsis;
}

.waiting-suffix {
  flex: none;
}

.status-row .waiting {
  padding: 0.15rem 0.75rem;
  border: 1px solid $ink;
  border-radius: 999px;
  background: mix($ink, $paper, 4%);
}

.waiting-button {
  font: inherit;
  line-height: inherit;
  color: $ink;
  background: none;
  border: none;
  padding: 0;
  text-decoration: underline;
  cursor: pointer;

  &:hover {
    text-decoration: none;
    background: $ink;
    color: $paper;
  }
}

.waiting-dialog {
  min-width: min(22rem, 90vw);
  padding: 1.25rem;
  background: $paper;
  border: 1px solid $ink;
  box-shadow: none;

  h4 {
    line-height: 1.5;
  }

  ul {
    list-style: none;
    margin: 0;
    padding: 0;
  }
}

.telemetry {
  margin: auto 0 0;
  font-size: 0.75rem;
}
</style>
