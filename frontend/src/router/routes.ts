import type { RouteRecordRaw } from 'vue-router';

const routes: RouteRecordRaw[] = [
  {
    path: '/',
    name: 'plug-list',
    component: () => import('../submodules/plugs/PlugList.vue'),
  },
  { path: '/:catchAll(.*)*', redirect: { name: 'plug-list' } },
];

export default routes;
