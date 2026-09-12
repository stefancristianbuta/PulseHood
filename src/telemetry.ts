import { randomUUID } from 'node:crypto';
import { EventEmitter } from 'node:events';

export interface TelemetryEvent {
  eventId: string;
  correlationId: string;
  timestampNs: bigint;
  module: string;
  event: string;
  token?: `0x${string}`;
  txHash?: `0x${string}`;
  block?: bigint;
  latencyMs?: number;
  status: 'ok' | 'error' | 'warning';
  payload?: Record<string, unknown>;
}

export class TelemetryBus {
  private readonly emitter = new EventEmitter();

  emitEvent(input: Omit<TelemetryEvent, 'eventId' | 'timestampNs'>): TelemetryEvent {
    const event: TelemetryEvent = {
      eventId: randomUUID(),
      timestampNs: process.hrtime.bigint(),
      ...input,
    };
    this.emitter.emit('event', event);
    return event;
  }

  onEvent(listener: (event: TelemetryEvent) => void): () => void {
    this.emitter.on('event', listener);
    return () => this.emitter.off('event', listener);
  }

  static correlationId(prefix = 'OPP'): string {
    const stamp = new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 12);
    return `${prefix}-${stamp}-${randomUUID().slice(0, 6)}`;
  }
}
