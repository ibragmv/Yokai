import { ConvexHttpClient } from 'convex/browser';

import { appEnv } from '@/lib/env';
import { api } from '../../../convex/_generated/api';

export function getConvexClient() {
  return new ConvexHttpClient(appEnv.convexUrl);
}

export { api };
