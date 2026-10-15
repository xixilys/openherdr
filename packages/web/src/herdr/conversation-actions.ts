import { z } from 'zod';
import { driverTargetSchema, type ConversationTarget } from '@openchamber/ui/lib/opencode/herdr-driver';
import { clearPendingDelivery, loadPendingDelivery, TransportError, type HerdrTransport, type PendingDelivery } from './transport';

export type ConversationMutationRequest = Extract<Parameters<HerdrTransport['trackedRequest']>[2], { target: { machine: string; paneId: string } }> & { target: ConversationTarget };

/** Every conversation write shares the same durable delivery owner as host writes. */
export async function trackConversationMutation<T>({ transport, record, path, request, schema, onPendingDelivery }: {
  transport: HerdrTransport;
  record: PendingDelivery;
  path: string;
  request: ConversationMutationRequest;
  schema: z.ZodType<T>;
  onPendingDelivery?: (record: PendingDelivery | null) => void;
}): Promise<{ kind: 'pending' } | { kind: 'complete'; value: T }> {
  const owner = z.object({ target: driverTargetSchema }).refine(({ target }) => target.machine === request.target.machine && target.paneId === request.target.paneId && target.identity === request.target.identity);
  const responseSchema = schema.refine((value) => {
    if (!owner.safeParse(value).success) return false;
    if ('action' in request) {
      const action = z.object({ sessionId: z.literal(request.sessionId), action: z.literal(request.action) });
      if (!action.safeParse(value).success) return false;
      if (request.action === 'prompt') return z.object({ result: z.object({ sessionID: z.literal(request.sessionId) }) }).safeParse(value).success;
    } else if ('sessionId' in request) {
      return z.object({ session: z.object({ id: z.literal(request.sessionId) }) }).safeParse(value).success;
    }
    return true;
  });
  try {
    const delivered = await transport.trackedRequest(record, path, request, responseSchema);
    if (delivered.kind === 'pending') { onPendingDelivery?.(delivered.record); return { kind: 'pending' }; }
    await clearPendingDelivery(record.server, record.requestId);
    onPendingDelivery?.(await loadPendingDelivery(record.server));
    return delivered;
  } catch (error) {
    if (error instanceof TransportError && !error.uncertain && error.code !== 'DELIVERY_STORAGE') {
      await clearPendingDelivery(record.server, record.requestId);
      onPendingDelivery?.(await loadPendingDelivery(record.server));
    } else if (error instanceof TransportError && error.uncertain) {
      onPendingDelivery?.(await loadPendingDelivery(record.server));
    }
    throw error;
  }
}
