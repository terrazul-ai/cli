import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { createServer } from 'node:http';
import os from 'node:os';
import path from 'node:path';

export interface SeaFixtureServer {
  baseUrl: string;
  close: () => Promise<void>;
  rootDir: string;
}

export const FIXTURE_BINARY_PATH = path.join(process.cwd(), 'tests/fixtures/bin/tz-linux-x64.zst');
const FIXTURE_MANIFEST_PATH = path.join(process.cwd(), 'tests/fixtures/sea-manifest.json');

export async function makeTempDir(prefix: string): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

export async function startSeaFixtureServer(): Promise<SeaFixtureServer> {
  const rootDir = await makeTempDir('sea-server-');
  await fs.copyFile(FIXTURE_BINARY_PATH, path.join(rootDir, 'tz-linux-x64.zst'));

  return new Promise<SeaFixtureServer>((resolve) => {
    const httpServer = createServer(async (req, res) => {
      const url = new URL(req.url ?? '/', 'http://127.0.0.1');
      const filePath = path.join(rootDir, url.pathname.replace(/^\//, ''));
      try {
        const data = await fs.readFile(filePath);
        res.statusCode = 200;
        res.setHeader('Content-Length', data.length);
        res.end(data);
      } catch {
        res.statusCode = 404;
        res.end('not found');
      }
    });

    httpServer.listen(0, '127.0.0.1', () => {
      const address = httpServer.address();
      if (address && typeof address === 'object') {
        resolve({
          baseUrl: `http://127.0.0.1:${address.port}`,
          rootDir,
          close: () =>
            new Promise<void>((resolve) => {
              httpServer.close(() => resolve());
            }),
        });
      }
    });
  });
}

function computeSha(buffer: Buffer): string {
  return createHash('sha256').update(buffer).digest('hex');
}

export async function writeFixtureManifest(options: {
  destination: string;
  baseUrl: string;
  cliVersion: string;
}): Promise<void> {
  const raw = await fs.readFile(FIXTURE_MANIFEST_PATH, 'utf8');
  const manifest = JSON.parse(raw) as {
    schemaVersion: number;
    cliVersion: string;
    cdn: { baseUrl: string };
    targets: Record<string, { url: string; size: number; sha256: string }>;
  };

  const artifact = await fs.readFile(FIXTURE_BINARY_PATH);

  manifest.cliVersion = options.cliVersion;
  manifest.cdn.baseUrl = options.baseUrl;
  manifest.targets['linux-x64'] = {
    url: `${options.baseUrl}/tz-linux-x64.zst`,
    size: artifact.length,
    sha256: computeSha(artifact),
  };

  await fs.writeFile(options.destination, JSON.stringify(manifest, null, 2), 'utf8');
}
