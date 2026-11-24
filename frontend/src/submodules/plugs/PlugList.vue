<script setup lang="ts">
import { computed, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '../api/api-client';
import PlugCard from './PlugCard.vue';
import PlugHistory from './PlugHistory.vue';
import { getPlugLabels } from './plug-labels';

const expectedPlugCount = 6;

const plugStatusesQuery = useQuery({
  queryKey: ['plugs'],
  queryFn: async () => {
    const response = await api.plugs.$get();
    if (!response.ok) throw new Error(`Plug statuses request failed with ${response.status}`);
    return response.json();
  },
  refetchInterval: 5_000,
});
const plugs = computed(() => plugStatusesQuery.data.value?.plugs);
const identifiers = computed(() => plugs.value?.map((plug) => plug.identifier) ?? []);
const labels = computed(() => getPlugLabels(identifiers.value));

const queryClient = useQueryClient();
const statuses = computed(() => plugs.value?.map((plug) => `${plug.identifier}:${plug.status}`).join(' ') ?? '');
watch(statuses, (current, previous) => {
  if (previous) void queryClient.invalidateQueries({ queryKey: ['plug-usage'] });
});
</script>

<template>
  <div class="plug-list page-width">
    <section aria-labelledby="machines-title">
      <h2 id="machines-title" class="section-label q-mt-none q-mb-lg">001 / machines</h2>
      <div v-if="plugStatusesQuery.isError.value" class="error q-mb-lg">
        the plugs could not be reached. we will keep trying.
      </div>
      <div v-if="plugStatusesQuery.isPending.value" class="plug-grid" aria-label="listening for the plugs">
        <PlugCard v-for="index in expectedPlugCount" :key="index" />
      </div>
      <div v-else-if="plugs?.length === 0" class="text-muted">
        nothing here yet. once a plug sends its first reading, it appears here on its own.
      </div>
      <div v-else-if="plugs" class="plug-grid">
        <PlugCard v-for="plug in plugs" :key="plug.identifier" :plug="plug" :label="labels.get(plug.identifier)" />
      </div>
    </section>

    <PlugHistory :identifiers="identifiers" />
  </div>
</template>

<style lang="scss" scoped>
.plug-list > section {
  padding-block: 2rem 2.5rem;
  border-top: 1px solid $ink;
}

h2 {
  font-weight: 400;
  line-height: 1.5;
}

.error {
  color: $rust;
}

.plug-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 21rem), 1fr));
  border-top: 1px solid $ink;
  border-left: 1px solid $ink;
}
</style>
