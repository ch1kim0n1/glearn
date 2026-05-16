/**
 * Custom error classes for GLearn
 */

export class GLearnError extends Error {
  constructor(message: string, public code?: string) {
    super(message);
    this.name = 'GLearnError';
  }
}

export class DatabaseError extends GLearnError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR');
    this.name = 'DatabaseError';
  }
}

export class ValidationError extends GLearnError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR');
    this.name = 'ValidationError';
  }
}

export class ConfigurationError extends GLearnError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR');
    this.name = 'ConfigurationError';
  }
}

export class LLMError extends GLearnError {
  constructor(message: string) {
    super(message, 'LLM_ERROR');
    this.name = 'LLMError';
  }
}

export class PatternError extends GLearnError {
  constructor(message: string) {
    super(message, 'PATTERN_ERROR');
    this.name = 'PatternError';
  }
}

export class ProposalError extends GLearnError {
  constructor(message: string) {
    super(message, 'PROPOSAL_ERROR');
    this.name = 'ProposalError';
  }
}

export class CounterfactualError extends GLearnError {
  constructor(message: string) {
    super(message, 'COUNTERFACTUAL_ERROR');
    this.name = 'CounterfactualError';
  }
}

export class BudgetExceededError extends GLearnError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED');
    this.name = 'BudgetExceededError';
  }
}
