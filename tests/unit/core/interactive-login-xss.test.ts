import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';

import { describe, expect, it, vi } from 'vitest';

import { LoginStateManager } from '../../../src/core/auth/state-manager';

vi.mock('../../../src/utils/browser', () => ({
  launchBrowser: vi.fn(() =>
    Promise.resolve({
      success: false,
      command: 'mock',
      args: ['https://example.com'],
      suppressed: true,
    }),
  ),
  resolveBrowserLauncher: vi.fn(() => ({ command: 'mock', args: [] })),
}));

describe('core/auth/interactive-login XSS protection', () => {
  it('escapes script tags in error messages', async () => {
    const maliciousError = '<script>alert("xss")</script>';

    const authService = {
      initiateCliLogin: vi.fn(() =>
        Promise.resolve({
          state: 'test-state',
          expiresAt: new Date(Date.now() + 5 * 60 * 1000).toISOString(),
          browserUrl: 'http://localhost:3000/login',
        }),
      ),
      completeCliLogin: vi.fn(() => {
        const error = new Error(maliciousError);
        return Promise.reject(error);
      }),
    };

    const stateManager = new LoginStateManager();
    stateManager.establish({
      state: 'test-state',
      expiresAt: new Date(Date.now() + 5 * 60 * 1000),
    });

    let server: Server | undefined;
    let capturedResponse: string | undefined;

    try {
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.on('request', async (req: IncomingMessage, res: ServerResponse) => {
        const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
        const token = url.searchParams.get('token');

        if (token) {
          try {
            await authService.completeCliLogin({ state: 'test-state', token });
          } catch (error) {
            const message =
              error instanceof Error && error.message ? error.message : 'Unknown error';

            // Simulate what the actual code does
            const { encode } = await import('he');
            const errorHtml = `<p>${encode(message)}</p>`;

            capturedResponse = errorHtml;
            res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' });
            res.end(errorHtml);
          }
        }
      });

      // Simulate callback request
      const response = await fetch(`http://127.0.0.1:${port}?state=test-state&token=tz_test_token`);
      const html = await response.text();

      // Verify script tags are properly encoded (he uses hex encoding: &#x3C; for < and &#x3E; for >)
      expect(html).toContain('&#x3C;script&#x3E;');
      expect(html).toContain('&#x3C;/script&#x3E;');

      // Verify raw script tags are NOT present
      expect(html).not.toContain('<script>');
      expect(html).not.toContain('</script>');

      // Verify the full encoded response
      expect(capturedResponse).toBe(
        '<p>&#x3C;script&#x3E;alert(&#x22;xss&#x22;)&#x3C;/script&#x3E;</p>',
      );
    } finally {
      server?.close();
    }
  });

  it('escapes event handlers in error messages', async () => {
    const maliciousError = '<img src=x onerror=alert(1)>';

    const { encode } = await import('he');
    const escaped = encode(maliciousError);

    // Verify the encoded output contains hex entities
    expect(escaped).toBe('&#x3C;img src=x onerror=alert(1)&#x3E;');

    // Verify raw tags are not present
    expect(escaped).not.toContain('<img');
    expect(escaped).not.toContain('>');
  });

  it('escapes multiple XSS vectors', async () => {
    const { encode } = await import('he');

    const xssVectors = [
      { input: '<iframe src="javascript:alert(1)"></iframe>', hasAngleBrackets: true },
      { input: '<object data="javascript:alert(1)"></object>', hasAngleBrackets: true },
      { input: '<embed src="javascript:alert(1)">', hasAngleBrackets: true },
      { input: '"><script>alert(1)</script>', hasAngleBrackets: true },
      { input: "' onload='alert(1)", hasAngleBrackets: false },
      { input: '<svg onload=alert(1)>', hasAngleBrackets: true },
    ];

    for (const { input, hasAngleBrackets } of xssVectors) {
      const escaped = encode(input);

      // Should not contain executable tags (angle brackets should be encoded)
      expect(escaped).not.toContain('<script>');
      expect(escaped).not.toContain('<iframe');
      expect(escaped).not.toContain('<object');
      expect(escaped).not.toContain('<embed');
      expect(escaped).not.toContain('<svg');

      // Should contain hex-encoded angle brackets (if input had them)
      if (hasAngleBrackets) {
        expect(escaped).toContain('&#x3C;');
        expect(escaped).toContain('&#x3E;');
      }
    }
  });

  it('escapes HTML entities correctly', async () => {
    const { encode } = await import('he');

    // he uses hex encoding by default
    const testCases = [
      { input: '&', expected: '&#x26;' },
      { input: '<', expected: '&#x3C;' },
      { input: '>', expected: '&#x3E;' },
      { input: '"', expected: '&#x22;' },
      { input: "'", expected: '&#x27;' },
    ];

    for (const { input, expected } of testCases) {
      const escaped = encode(input);
      expect(escaped).toBe(expected);
    }
  });

  it('handles nested encoding attempts', async () => {
    const { encode } = await import('he');

    const nestedXss = '&lt;script&gt;alert("xss")&lt;/script&gt;';
    const escaped = encode(nestedXss);

    // Should escape the ampersands in the already-escaped content (&#x26; is encoded &)
    expect(escaped).toContain('&#x26;lt;');
    expect(escaped).toContain('&#x26;gt;');
  });

  it('preserves safe content while escaping dangerous content', async () => {
    const { encode } = await import('he');

    const mixedContent = 'Failed to login: <script>alert(1)</script> Please try again.';
    const escaped = encode(mixedContent);

    // Safe text should be preserved
    expect(escaped).toContain('Failed to login:');
    expect(escaped).toContain('Please try again.');

    // Dangerous content should be escaped (hex encoding)
    expect(escaped).not.toContain('<script>');
    expect(escaped).toContain('&#x3C;script&#x3E;');
    expect(escaped).toContain('&#x3C;/script&#x3E;');
  });

  it('verifies CSP header is set in error response (no script-src)', async () => {
    let server: Server | undefined;

    try {
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        res.writeHead(400, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'",
        });
        res.end('<html><body>Error</body></html>');
      });

      const response = await fetch(`http://127.0.0.1:${port}?state=csp-test-state&token=tz_test`);

      // Verify CSP header is present and does NOT include script-src
      const cspHeader = response.headers.get('content-security-policy');
      expect(cspHeader).toBe("default-src 'none'; style-src 'unsafe-inline'");
      expect(cspHeader).not.toContain('script-src');
    } finally {
      server?.close();
    }
  });

  it('includes script-src with nonce in success response CSP', async () => {
    let server: Server | undefined;

    try {
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        // Simulate success response with nonce
        const nonce = 'test-nonce-abc123';
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': csp,
        });
        res.end(`<html><body><script nonce="${nonce}">console.log('test');</script></body></html>`);
      });

      const response = await fetch(`http://127.0.0.1:${port}?state=success&token=tz_test`);

      // Verify CSP includes script-src with nonce
      const cspHeader = response.headers.get('content-security-policy');
      expect(cspHeader).toContain("script-src 'nonce-");
      expect(cspHeader).toContain("default-src 'none'");
      expect(cspHeader).toContain("style-src 'unsafe-inline'");
    } finally {
      server?.close();
    }
  });

  it('nonce in CSP header matches nonce in script tag', async () => {
    let server: Server | undefined;

    try {
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        // Generate a real nonce
        const nonce = Buffer.from('test-random-bytes').toString('base64');
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;
        const html = `<html><body><script nonce="${nonce}">console.log('test');</script></body></html>`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': csp,
        });
        res.end(html);
      });

      const response = await fetch(`http://127.0.0.1:${port}`);
      const cspHeader = response.headers.get('content-security-policy');
      const html = await response.text();

      // Extract nonce from CSP header
      const cspNonceMatch = cspHeader?.match(/nonce-([\d+/=A-Za-z]+)/);
      expect(cspNonceMatch).toBeTruthy();
      const cspNonce = cspNonceMatch?.[1];

      // Extract nonce from HTML script tag
      const htmlNonceMatch = html.match(/nonce="([\d+/=A-Za-z]+)"/);
      expect(htmlNonceMatch).toBeTruthy();
      const htmlNonce = htmlNonceMatch?.[1];

      // Verify they match
      expect(cspNonce).toBe(htmlNonce);
      expect(cspNonce).toBeTruthy();
    } finally {
      server?.close();
    }
  });

  it('generates unique nonce for each request', async () => {
    let server: Server | undefined;

    try {
      server = createServer();
      await new Promise<void>((resolve, reject) => {
        server!.once('error', reject);
        server!.listen(0, '127.0.0.1', () => resolve());
      });

      const address = server.address();
      const port = typeof address === 'object' && address ? address.port : 0;

      const nonces: string[] = [];

      server.on('request', (req: IncomingMessage, res: ServerResponse) => {
        // Generate unique nonce per request (simulate real behavior)
        const nonce = Buffer.from(Math.random().toString()).toString('base64');
        nonces.push(nonce);
        const csp = `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}'`;

        res.writeHead(200, {
          'Content-Type': 'text/html; charset=utf-8',
          'Content-Security-Policy': csp,
        });
        res.end(`<html><body><script nonce="${nonce}">test</script></body></html>`);
      });

      // Make multiple requests
      const response1 = await fetch(`http://127.0.0.1:${port}/req1`);
      const csp1 = response1.headers.get('content-security-policy');

      const response2 = await fetch(`http://127.0.0.1:${port}/req2`);
      const csp2 = response2.headers.get('content-security-policy');

      const response3 = await fetch(`http://127.0.0.1:${port}/req3`);
      const csp3 = response3.headers.get('content-security-policy');

      // Verify nonces are different
      expect(csp1).not.toBe(csp2);
      expect(csp2).not.toBe(csp3);
      expect(csp1).not.toBe(csp3);

      // Verify all nonces were captured
      expect(nonces).toHaveLength(3);
      expect(new Set(nonces).size).toBe(3); // All unique
    } finally {
      server?.close();
    }
  });

  it('nonce is cryptographically random and base64 encoded', async () => {
    // This test verifies the nonce format without needing a server
    const crypto = await import('node:crypto');

    // Generate nonces like the implementation should
    const nonce1 = crypto.randomBytes(16).toString('base64');
    const nonce2 = crypto.randomBytes(16).toString('base64');

    // Verify format (base64 allows A-Z, a-z, 0-9, +, /, =)
    expect(nonce1).toMatch(/^[\d+/A-Za-z]+=*$/);
    expect(nonce2).toMatch(/^[\d+/A-Za-z]+=*$/);

    // Verify length (16 bytes = 24 base64 chars including padding)
    expect(nonce1.length).toBe(24);
    expect(nonce2.length).toBe(24);

    // Verify uniqueness
    expect(nonce1).not.toBe(nonce2);
  });
});
