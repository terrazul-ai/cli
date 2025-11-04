import { URL } from 'node:url';

import { getCliVersion } from '../../utils/version.js';
import { ErrorCode, TerrazulError } from '../errors.js';

import type { APIErrorResponse } from '../../types/api.js';

interface CLIInitiateResponse {
  state: string;
  expiresAt: string;
  browserUrl: string;
}

export interface CLICompletionResponse {
  token: string;
  tokenId?: string;
  createdAt: string;
  expiresAt: string;
  user: {
    id: number;
    username: string;
    email?: string;
  };
}

function isLoopback(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname.startsWith('127.') ||
    hostname === '::1' ||
    hostname === '[::1]'
  );
}

export interface AuthServiceOptions {
  baseUrl: string;
}

export class AuthService {
  private readonly baseUrl: string;

  constructor(opts: AuthServiceOptions) {
    const url = new URL(opts.baseUrl);
    if (url.protocol !== 'https:' && !isLoopback(url.hostname)) {
      throw new TerrazulError(
        ErrorCode.NETWORK_ERROR,
        `Authentication endpoint must use HTTPS (received ${url.protocol}//)`,
      );
    }
    this.baseUrl = opts.baseUrl.replace(/\/$/, '');
  }

  async initiateCliLogin(input: {
    callbackUrl: string;
    hostname: string;
  }): Promise<CLIInitiateResponse> {
    const endpoint = `${this.baseUrl}/auth/v1/cli/initiate`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        callbackUrl: input.callbackUrl,
        hostname: input.hostname,
        cliVersion: getCliVersion(),
      }),
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      throw new TerrazulError(
        ErrorCode.NETWORK_ERROR,
        error.error || `Failed to initiate CLI login (HTTP ${res.status})`,
      );
    }

    const data = (await res.json()) as CLIInitiateResponse;

    if (typeof data.state !== 'string' || data.state.length === 0) {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, 'Login state missing in response');
    }
    if (typeof data.expiresAt !== 'string' || data.expiresAt.length === 0) {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, 'Login expiration missing in response');
    }
    if (typeof data.browserUrl !== 'string' || data.browserUrl.length === 0) {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, 'Login URL missing in response');
    }
    return data;
  }

  async completeCliLogin(input: { state: string; token: string }): Promise<CLICompletionResponse> {
    const endpoint = `${this.baseUrl}/auth/v1/cli/complete`;
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        state: input.state,
        token: input.token,
        cliVersion: getCliVersion(),
      }),
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      throw new TerrazulError(
        ErrorCode.AUTH_REQUIRED,
        error.error || `Failed to complete CLI login (HTTP ${res.status})`,
      );
    }

    const data = (await res.json()) as CLICompletionResponse;

    if (typeof data.token !== 'string' || data.token.length === 0) {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, 'Token missing in completion response');
    }
    if (!data.user || typeof data.user !== 'object' || typeof data.user.id !== 'number') {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, 'User metadata missing in response');
    }
    return data;
  }

  async getAuthenticatedUser(token: string): Promise<{ user: { id: number; username: string; email?: string } }> {
    const endpoint = `${this.baseUrl}/auth/v1/me`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      throw new TerrazulError(
        ErrorCode.AUTH_REQUIRED,
        error.error || `Failed to get authenticated user (HTTP ${res.status})`,
      );
    }

    const data = (await res.json()) as { id: number; username: string; email?: string };
    return {
      user: {
        id: data.id,
        username: data.username,
        email: data.email,
      },
    };
  }

  async getCurrentTokenDetails(token: string): Promise<{ id: string; name: string; createdAt: string; expiresAt: string }> {
    const endpoint = `${this.baseUrl}/auth/v1/tokens`;
    const res = await fetch(endpoint, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (!res.ok) {
      const error = (await res.json().catch(() => ({}))) as { error?: string; details?: string };
      throw new TerrazulError(
        ErrorCode.AUTH_REQUIRED,
        error.error || `Failed to get token details (HTTP ${res.status})`,
      );
    }

    const response = (await res.json()) as { data: Array<{ id: string; name: string; created_at: string; expires_at: string; last_used_at: string | null }> };

    // The current token should be the most recently used one
    const currentToken = response.data.find(t => t.last_used_at !== null) || response.data[0];

    if (!currentToken) {
      throw new TerrazulError(ErrorCode.AUTH_REQUIRED, 'No token found in response');
    }

    return {
      id: currentToken.id,
      name: currentToken.name,
      createdAt: currentToken.created_at,
      expiresAt: currentToken.expires_at,
    };
  }

  async revokeToken(token: string, tokenId: string): Promise<void> {
    const endpoint = `${this.baseUrl}/auth/v1/tokens/${encodeURIComponent(tokenId)}`;
    const res = await fetch(endpoint, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
    });

    if (res.ok || res.status === 204) return;

    const payload = (await res.json().catch(() => {})) as APIErrorResponse | undefined;
    if (payload && payload.success === false) {
      throw new TerrazulError(ErrorCode.NETWORK_ERROR, payload.error.message);
    }
    throw new TerrazulError(ErrorCode.NETWORK_ERROR, `Failed to revoke token (HTTP ${res.status})`);
  }
}
