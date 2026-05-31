/**
 * OAuth Provider for GLearn
 *
 * NOTE: This is an INTERNAL, partial implementation and is intentionally NOT
 * exported from `src/auth/index.ts` as part of the public API. A full OAuth2
 * authorization-code flow against a real authorization server is not yet
 * implemented (the live token-exchange/refresh HTTP calls are unimplemented and
 * throw). What IS implemented correctly here:
 *   - cryptographically random, opaque access/refresh tokens (no predictable
 *     timestamp-based tokens), and
 *   - expiry enforcement in `validateToken`.
 *
 * Do not rely on this for production authentication until the live exchange is
 * implemented.
 */

import { randomBytes } from 'crypto';
import { logger } from '../core/logger.js';

export interface OAuthConfig {
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  scopes: string[];
  /** Authorization server endpoints. Required for a real exchange. */
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
}

export interface OAuthToken {
  accessToken: string;
  refreshToken?: string;
  expiresIn: number;
  tokenType: string;
}

interface StoredToken extends OAuthToken {
  /** Absolute expiry time in epoch ms. */
  expiresAt: number;
}

const DEFAULT_EXPIRES_IN_SECONDS = 3600;

export class OAuthProvider {
  private config: OAuthConfig;
  private tokens: Map<string, StoredToken> = new Map();

  constructor(config: OAuthConfig) {
    this.config = config;
    logger.info('OAuthProvider initialized');
  }

  getAuthorizationUrl(state: string): string {
    const base = this.config.authorizationEndpoint;
    if (!base) {
      throw new Error('OAuthProvider.getAuthorizationUrl requires config.authorizationEndpoint');
    }
    const params = new URLSearchParams({
      response_type: 'code',
      client_id: this.config.clientId,
      redirect_uri: this.config.redirectUri,
      scope: this.config.scopes.join(' '),
      state,
    });
    return `${base}?${params.toString()}`;
  }

  /** Generate a cryptographically random, opaque token (not timestamp-based). */
  private mintToken(refreshToken?: string): StoredToken {
    const expiresIn = DEFAULT_EXPIRES_IN_SECONDS;
    const token: StoredToken = {
      accessToken: randomBytes(32).toString('base64url'),
      refreshToken: refreshToken ?? randomBytes(32).toString('base64url'),
      expiresIn,
      tokenType: 'Bearer',
      expiresAt: Date.now() + expiresIn * 1000,
    };
    this.tokens.set(token.accessToken, token);
    return token;
  }

  async exchangeCodeForToken(_code: string): Promise<OAuthToken> {
    if (!this.config.tokenEndpoint) {
      throw new Error(
        'OAuthProvider.exchangeCodeForToken is not implemented: no live token endpoint configured. ' +
          'A real OAuth2 token exchange must be implemented before use.',
      );
    }
    // A real implementation would POST the authorization code to
    // this.config.tokenEndpoint and store the returned tokens.
    throw new Error('OAuthProvider.exchangeCodeForToken: live token exchange not implemented');
  }

  async refreshAccessToken(_refreshToken: string): Promise<OAuthToken> {
    if (!this.config.tokenEndpoint) {
      throw new Error(
        'OAuthProvider.refreshAccessToken is not implemented: no live token endpoint configured.',
      );
    }
    throw new Error('OAuthProvider.refreshAccessToken: live token refresh not implemented');
  }

  /** Returns true only if the token is known AND not expired. */
  validateToken(accessToken: string): boolean {
    const stored = this.tokens.get(accessToken);
    if (!stored) return false;
    if (stored.expiresAt <= Date.now()) {
      this.tokens.delete(accessToken);
      return false;
    }
    return true;
  }

  revokeToken(accessToken: string): void {
    this.tokens.delete(accessToken);
    logger.info('Token revoked');
  }
}
