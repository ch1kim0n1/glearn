/**
 * Test helpers for GLearn
 * Provides utility functions for testing
 */

import { GLearn } from '../src/core/glearn.js';
import { testConfig } from './fixtures/index.js';

/**
 * Create a GLearn instance with test configuration
 */
export function createTestGLearn(): GLearn {
  return new GLearn(testConfig);
}

/**
 * Wait for a specified time (for async testing)
 */
export async function wait(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Mock fetch response
 */
export function mockFetch(response: any, ok = true): jest.Mock {
  return jest.fn(() =>
    Promise.resolve({
      ok,
      json: () => Promise.resolve(response),
      text: () => Promise.resolve(JSON.stringify(response)),
    })
  );
}

/**
 * Mock fetch error
 */
export function mockFetchError(message: string): jest.Mock {
  return jest.fn(() => Promise.reject(new Error(message)));
}

/**
 * Create a mock performance.now() that returns incremental values
 */
export function createMockPerformanceNow(): jest.Mock {
  let time = 0;
  return jest.fn(() => {
    time += 10;
    return time;
  });
}

/**
 * Assert that an object has required properties
 */
export function assertHasProperties(obj: any, properties: string[]): void {
  properties.forEach(prop => {
    expect(obj).toHaveProperty(prop);
  });
}

/**
 * Assert that an array has expected length
 */
export function assertArrayLength(arr: any[], expectedLength: number): void {
  expect(arr).toHaveLength(expectedLength);
}

/**
 * Create a spy on a method
 */
export function spyOnMethod(obj: any, method: string): jest.SpyInstance {
  return jest.spyOn(obj, method);
}
