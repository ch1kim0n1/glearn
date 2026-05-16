import {
  DyadDataSource,
  DyadDataSourceSchema,
  LearningRequest,
  RelationalEvent,
} from '../types/index.js';

export class DyadDataSourceAdapter {
  normalize(source: DyadDataSource): LearningRequest[] {
    const parsed = DyadDataSourceSchema.parse(source);

    return parsed.events.map((event, index) => ({
      request_id: this.requestId(parsed.dyad_id, event, index),
      source_tool: 'DYAD',
      data_type: 'relational_event',
      dyad_id: parsed.dyad_id,
      timestamp: event.timestamp,
      payload: event,
      metadata: {
        source: parsed.source,
        time_range: parsed.time_range,
        event_index: index,
      },
    }));
  }

  private requestId(dyadId: string, event: RelationalEvent, index: number): string {
    const stablePart = event.type === 'response'
      ? event.to_bid_id
      : event.type === 'bid'
        ? event.bid_id || `${event.participant}:${event.bid_type}`
        : event.type === 'repair_attempt'
          ? `${event.initiator}:${event.success}`
          : `${event.participant}:${event.from}:${event.to}`;

    return `${dyadId}:${event.timestamp}:${event.type}:${stablePart}:${index}`;
  }
}
