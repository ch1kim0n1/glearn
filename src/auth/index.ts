/**
 * Auth module exports for GLearn
 *
 * NOTE: `OAuthProvider` is intentionally NOT re-exported here. Its live OAuth2
 * token exchange/refresh is not yet implemented, so it is not part of the public
 * API surface to avoid shipping a fake auth provider. Only the public types are
 * exported. See `src/auth/oauth-provider.ts`.
 */

export type { OAuthConfig, OAuthToken } from './oauth-provider.js';
