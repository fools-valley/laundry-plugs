import { defineRelations } from 'drizzle-orm';
import * as schema from './schema/index';

export const relations = defineRelations(schema, (r) => ({
  accessTokenInAuth: { plugs: r.many.plugInPlugs(), readings: r.many.readingInPlugs() },
  plugInPlugs: {
    createdByAccessToken: r.one.accessTokenInAuth({
      from: r.plugInPlugs.createdByAccessTokenId,
      to: r.accessTokenInAuth.id,
      optional: false,
    }),
    readings: r.many.readingInPlugs(),
    latestReadings: r.many.readingInPlugs({ from: r.plugInPlugs.id, to: r.readingInPlugs.plugId }),
  },
  readingInPlugs: {
    plug: r.one.plugInPlugs({ from: r.readingInPlugs.plugId, to: r.plugInPlugs.id, optional: false }),
    accessToken: r.one.accessTokenInAuth({
      from: r.readingInPlugs.accessTokenId,
      to: r.accessTokenInAuth.id,
      optional: false,
    }),
  },
}));
