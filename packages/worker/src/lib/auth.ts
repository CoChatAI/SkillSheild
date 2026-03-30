import type { Context } from 'hono';
import type { WorkerBindings } from '../types';

export function hasWebhookSecret(c: Context<{ Bindings: WorkerBindings }>): boolean {
  return typeof c.env.WEBHOOK_SECRET === 'string' && c.env.WEBHOOK_SECRET.length > 0;
}
