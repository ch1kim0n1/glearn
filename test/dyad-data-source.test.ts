import { DyadDataSourceAdapter } from '../src/data-sources/dyad-data-source';
import { DyadDataSource } from '../src/types/index';

const baseSource = (events: DyadDataSource['events']): DyadDataSource => ({
  source: 'dyad',
  dyad_id: 'dyad-1',
  time_range: {
    start: '2026-05-16T10:00:00.000Z',
    end: '2026-05-16T11:00:00.000Z',
  },
  events,
});

describe('DyadDataSourceAdapter', () => {
  it('normalizes bid events into DYAD learning requests', () => {
    const adapter = new DyadDataSourceAdapter();
    const [request] = adapter.normalize(baseSource([
      {
        type: 'bid',
        participant: 'a',
        bid_type: 'attention',
        bid_id: 'bid-1',
        timestamp: '2026-05-16T10:05:00.000Z',
      },
    ]));

    expect(request.source_tool).toBe('DYAD');
    expect(request.data_type).toBe('relational_event');
    expect(request.dyad_id).toBe('dyad-1');
    expect(request.payload.type).toBe('bid');
    expect(request.request_id).toContain('bid-1');
  });

  it('normalizes repair_attempt events', () => {
    const adapter = new DyadDataSourceAdapter();
    const [request] = adapter.normalize(baseSource([
      {
        type: 'repair_attempt',
        initiator: 'b',
        success: true,
        timestamp: '2026-05-16T10:20:00.000Z',
      },
    ]));

    expect(request.payload).toMatchObject({
      type: 'repair_attempt',
      initiator: 'b',
      success: true,
    });
  });

  it('returns an empty learning request list for an empty event stream', () => {
    const adapter = new DyadDataSourceAdapter();
    expect(adapter.normalize(baseSource([]))).toEqual([]);
  });
});
