import { describe, it, expect, vi, afterEach } from 'vitest';

import { AuthService } from '../../../src/core/auth/service.js';
import { TerrazulError } from '../../../src/core/errors.js';

describe('core/auth-service', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  describe('initiateCliLogin', () => {
    it('returns bare API response', async () => {
      const service = new AuthService({ baseUrl: 'https://api.example.com' });

      const mockResponse = {
        state: 'test-state-123',
        expiresAt: '2025-12-31T23:59:59Z',
        browserUrl: 'https://app.example.com/auth/cli?state=test-state-123',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      );

      const result = await service.initiateCliLogin({
        callbackUrl: 'http://localhost:9876/callback',
        hostname: 'test-machine',
      });

      expect(result.state).toBe('test-state-123');
      expect(result.expiresAt).toBe('2025-12-31T23:59:59Z');
      expect(result.browserUrl).toBe('https://app.example.com/auth/cli?state=test-state-123');
    });

    it('throws when state is missing in bare response', async () => {
      const service = new AuthService({ baseUrl: 'https://api.example.com' });

      const mockResponse = {
        // Missing state field
        expiresAt: '2025-12-31T23:59:59Z',
        browserUrl: 'https://app.example.com/auth/cli',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      );

      await expect(
        service.initiateCliLogin({
          callbackUrl: 'http://localhost:9876/callback',
          hostname: 'test-machine',
        }),
      ).rejects.toThrow('Login state missing in response');
    });
  });

  describe('completeCliLogin', () => {
    it('returns bare API response', async () => {
      const service = new AuthService({ baseUrl: 'https://api.example.com' });

      const mockResponse = {
        token: 'tz_token_abc123',
        tokenId: 'tok_xyz789',
        createdAt: '2025-11-09T00:00:00Z',
        expiresAt: '2026-11-09T00:00:00Z',
        user: {
          id: 42,
          username: 'testuser',
          email: 'test@example.com',
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      );

      const result = await service.completeCliLogin({
        state: 'test-state-123',
        token: 'temp-token',
      });

      expect(result.token).toBe('tz_token_abc123');
      expect(result.tokenId).toBe('tok_xyz789');
      expect(result.user.id).toBe(42);
      expect(result.user.username).toBe('testuser');
    });

    it('throws when token is missing in bare response', async () => {
      const service = new AuthService({ baseUrl: 'https://api.example.com' });

      const mockResponse = {
        // Missing token field
        createdAt: '2025-11-09T00:00:00Z',
        expiresAt: '2026-11-09T00:00:00Z',
        user: {
          id: 42,
          username: 'testuser',
        },
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            }),
          ),
        ),
      );

      await expect(
        service.completeCliLogin({
          state: 'test-state-123',
          token: 'temp-token',
        }),
      ).rejects.toThrow('Token missing in completion response');
    });
  });

  describe('HTTPS enforcement', () => {
    it('allows https URLs', () => {
      expect(() => new AuthService({ baseUrl: 'https://api.example.com' })).not.toThrow();
    });

    it('allows http loopback hosts', () => {
      expect(() => new AuthService({ baseUrl: 'http://127.0.0.1:8787' })).not.toThrow();
      expect(() => new AuthService({ baseUrl: 'http://localhost:8787' })).not.toThrow();
      expect(() => new AuthService({ baseUrl: 'http://[::1]:8787' })).not.toThrow();
    });

    it('rejects http non-loopback hosts', () => {
      expect(() => new AuthService({ baseUrl: 'http://example.com' })).toThrow(TerrazulError);
      expect(() => new AuthService({ baseUrl: 'http://example.com' })).toThrow(/must use HTTPS/);
    });
  });
});
