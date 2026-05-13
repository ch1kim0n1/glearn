import { describe, it, expect } from '@jest/globals';
import { PatternMiner } from '../src/core/pattern-miner';

describe('PatternMiner', () => {
  it('should initialize', () => {
    const miner = new PatternMiner();
    
    expect(miner).toBeDefined();
  });
});
