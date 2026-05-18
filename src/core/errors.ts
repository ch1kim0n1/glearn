/**
 * Custom error classes for GLearn
 */

export type ErrorSeverity = 'recoverable' | 'fatal' | 'transient';

export interface ErrorResponse {
  error: string;
  code: string;
  message: string;
  severity: ErrorSeverity;
  requestId?: string;
  timestamp: string;
}

export class GLearnError extends Error {
  constructor(
    message: string,
    public code: string = 'INTERNAL_ERROR',
    public statusCode: number = 500,
    public severity: ErrorSeverity = 'fatal'
  ) {
    super(message);
    this.name = 'GLearnError';
  }

  toJSON(): ErrorResponse {
    return {
      error: this.name,
      code: this.code,
      message: this.message,
      severity: this.severity,
      timestamp: new Date().toISOString(),
    };
  }
}

export class ValidationError extends GLearnError {
  constructor(message: string) {
    super(message, 'VALIDATION_ERROR', 400, 'recoverable');
    this.name = 'ValidationError';
  }
}

export class AuthenticationError extends GLearnError {
  constructor(message: string) {
    super(message, 'AUTHENTICATION_ERROR', 401, 'recoverable');
    this.name = 'AuthenticationError';
  }
}

export class AuthorizationError extends GLearnError {
  constructor(message: string) {
    super(message, 'AUTHORIZATION_ERROR', 403, 'fatal');
    this.name = 'AuthorizationError';
  }
}

export class NotFoundError extends GLearnError {
  constructor(message: string) {
    super(message, 'NOT_FOUND', 404, 'recoverable');
    this.name = 'NotFoundError';
  }
}

export class ConflictError extends GLearnError {
  constructor(message: string) {
    super(message, 'CONFLICT', 409, 'recoverable');
    this.name = 'ConflictError';
  }
}

export class ConfigurationError extends GLearnError {
  constructor(message: string) {
    super(message, 'CONFIGURATION_ERROR', 500, 'fatal');
    this.name = 'ConfigurationError';
  }
}

export class DatabaseError extends GLearnError {
  constructor(message: string) {
    super(message, 'DATABASE_ERROR', 500, 'fatal');
    this.name = 'DatabaseError';
  }
}

export class LLMError extends GLearnError {
  constructor(message: string) {
    super(message, 'LLM_ERROR', 502, 'transient');
    this.name = 'LLMError';
  }
}

export class PatternError extends GLearnError {
  constructor(message: string) {
    super(message, 'PATTERN_ERROR', 500, 'fatal');
    this.name = 'PatternError';
  }
}

export class ProposalError extends GLearnError {
  constructor(message: string) {
    super(message, 'PROPOSAL_ERROR', 500, 'fatal');
    this.name = 'ProposalError';
  }
}

export class CounterfactualError extends GLearnError {
  constructor(message: string) {
    super(message, 'COUNTERFACTUAL_ERROR', 500, 'fatal');
    this.name = 'CounterfactualError';
  }
}

export class BudgetExceededError extends GLearnError {
  constructor(message: string) {
    super(message, 'BUDGET_EXCEEDED', 429, 'fatal');
    this.name = 'BudgetExceededError';
  }
}

export class RateLimitError extends GLearnError {
  constructor(message: string) {
    super(message, 'RATE_LIMIT', 429, 'transient');
    this.name = 'RateLimitError';
  }
}

export class TimeoutError extends GLearnError {
  constructor(message: string) {
    super(message, 'TIMEOUT', 504, 'transient');
    this.name = 'TimeoutError';
  }
}
