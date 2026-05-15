/**
 * Multi-Model Manager for GLearn
 * Manages multi-model escalation and tier selection
 */

import { logger } from './logger.js';
import { TierConfig } from './config.js';

export interface MultiModelConfig {
  enabled: boolean;
  tiers: TierConfig[];
  escalationThreshold: number;
}

export class MultiModelManager {
  private config: MultiModelConfig;

  constructor(config: MultiModelConfig) {
    this.config = config;
    logger.info('MultiModelManager initialized', { enabled: config.enabled });
  }

  selectTier(quality: number): TierConfig | null {
    if (!this.config.enabled) {
      return null;
    }

    for (const tier of this.config.tiers) {
      if (tier.quality >= quality) {
        return tier;
      }
    }

    return this.config.tiers[this.config.tiers.length - 1] || null;
  }

  shouldEscalate(currentQuality: number): boolean {
    return this.config.enabled && currentQuality < this.config.escalationThreshold;
  }

  escalate(currentTier: string): TierConfig | null {
    const currentIndex = this.config.tiers.findIndex(t => t.name === currentTier);
    if (currentIndex === -1 || currentIndex === this.config.tiers.length - 1) {
      return null;
    }
    return this.config.tiers[currentIndex + 1];
  }

  updateConfig(config: Partial<MultiModelConfig>): void {
    this.config = { ...this.config, ...config };
    logger.info('MultiModelManager config updated');
  }
}
