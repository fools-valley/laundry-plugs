<script setup lang="ts">
import { computed, onBeforeUnmount, ref, useTemplateRef, watch } from 'vue';
import { useQuery, useQueryClient } from '@tanstack/vue-query';
import { api } from '../api/api-client';
import PlugCard from './PlugCard.vue';
import PlugHistory from './PlugHistory.vue';
import { getPlugLabels, getPlugLocation } from './plug-labels';

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

const plugGrid = useTemplateRef<HTMLElement>('plugGrid');
const columnCount = ref(1);
const resizeObserver = new ResizeObserver(([entry]) => {
  if (entry) columnCount.value = getComputedStyle(entry.target).gridTemplateColumns.split(' ').length;
});
watch(plugGrid, (element, previousElement) => {
  if (previousElement) resizeObserver.unobserve(previousElement);
  if (element) resizeObserver.observe(element);
});
onBeforeUnmount(() => resizeObserver.disconnect());

function getCardEdges(locations: string[]) {
  const columns = columnCount.value;
  const rows = Array.from({ length: Math.ceil(locations.length / columns) }, (_, row) =>
    locations.slice(row * columns, (row + 1) * columns)
  );
  // A gap only splits rows that share no location and where one side is a whole row of a single location.
  const gapBeforeRow = rows.map((row, rowIndex) => {
    const previousRow = rows[rowIndex - 1];
    if (!previousRow || row.some((location) => previousRow.includes(location))) return false;
    return new Set(row).size === 1 || new Set(previousRow).size === 1;
  });
  return locations.map((_, index) => {
    const row = Math.floor(index / columns);
    return {
      'plug-card--edge-left': index % columns === 0,
      'plug-card--edge-top': row === 0 || gapBeforeRow[row],
      'plug-card--after-gap': gapBeforeRow[row],
    };
  });
}
const cardEdges = computed(() => getCardEdges(plugs.value?.map((plug) => getPlugLocation(plug.identifier)) ?? []));
const placeholderEdges = computed(() => getCardEdges(Array.from({ length: expectedPlugCount }, () => '')));

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
      <div
        v-if="plugStatusesQuery.isPending.value"
        ref="plugGrid"
        class="plug-grid"
        aria-label="listening for the plugs"
      >
        <PlugCard v-for="index in expectedPlugCount" :key="index" :class="placeholderEdges[index - 1]" />
      </div>
      <div v-else-if="plugs?.length === 0" class="text-muted">
        nothing here yet. once a plug sends its first reading, it appears here on its own.
      </div>
      <div v-else-if="plugs" ref="plugGrid" class="plug-grid">
        <PlugCard
          v-for="(plug, index) in plugs"
          :key="plug.identifier"
          :plug="plug"
          :label="labels.get(plug.identifier)"
          :class="cardEdges[index]"
        />
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
}
</style>
