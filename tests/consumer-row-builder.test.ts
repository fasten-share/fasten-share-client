import { describe, expect, it } from 'vitest';
import { buildConsumerRows } from '@/app/components/consumer-row-builder';
import type { Candidate } from '@/lib/server/types';

function candidate(overrides: Partial<Candidate> = {}): Candidate {
  return {
    peerId: 'peer-1',
    models: ['model'],
    protocol: 'openai',
    rttToServer: 10,
    onlineMs: 1_000,
    userId: '7',
    ...overrides,
  };
}

describe('consumer row credit thresholds', () => {
  it('maps backend threshold state onto each node', () => {
    const rows = buildConsumerRows(
      [candidate({
        creditThresholds: { model: 10_000 },
        creditThresholdMet: { model: false },
      })],
      'all',
      '',
      new Map(),
      new Map(),
      [],
    );

    expect(rows[0].nodes[0]).toMatchObject({
      creditThreshold: 10_000,
      creditThresholdMet: false,
    });
  });

  it('keeps configuration available for older discovery responses', () => {
    const rows = buildConsumerRows(
      [candidate()],
      'all',
      '',
      new Map(),
      new Map(),
      [],
    );

    expect(rows[0].nodes[0]).toMatchObject({
      creditThreshold: 0,
      creditThresholdMet: true,
    });
  });
});
