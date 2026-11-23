import { QueryClient, VueQueryPlugin } from '@tanstack/vue-query';
import { defineBoot } from '#q-app';

export default defineBoot(({ app }) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { refetchOnWindowFocus: true, retry: 2 } } });
  app.use(VueQueryPlugin, { queryClient });
});
