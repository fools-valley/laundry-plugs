import { hc, type InferResponseType } from 'hono/client';
import type { AppType } from '@laundry-plugs/api/submodules/main/app';

export const api = hc<AppType>('/api');

export type PlugStatus = InferResponseType<typeof api.plugs.$get, 200>['plugs'][number];
