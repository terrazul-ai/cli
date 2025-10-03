#!/usr/bin/env node

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = Number(process.env.PORT || 8787);
const STORAGE_DIR = path.join(__dirname, 'storage');
const REGISTRY_FILE = path.join(__dirname, 'packages.json');

if (!fs.existsSync(STORAGE_DIR)) {
  fs.mkdirSync(STORAGE_DIR, { recursive: true });
}

function loadRegistry() {
  if (!fs.existsSync(REGISTRY_FILE)) return {};
  try {
    return JSON.parse(fs.readFileSync(REGISTRY_FILE, 'utf8'));
  } catch {
    return {};
  }
}

function saveRegistry(data) {
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify(data, null, 2));
}

const packages = loadRegistry();

function seedPackage(owner, name, data) {
  const key = keyFor(owner, name);
  if (!packages[key]) {
    packages[key] = data;
  }
}

seedPackage('terrazul', 'starter', {
  owner: 'terrazul',
  name: 'starter',
  fullName: '@terrazul/starter',
  description: 'Starter package for Terrazul CLI testing',
  latest: '1.1.0',
  versions: {
    '1.0.0': {
      version: '1.0.0',
      dependencies: {},
      compatibility: { 'claude-code': '>=0.2.0' },
      publishedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      yanked: false,
    },
    '1.1.0': {
      version: '1.1.0',
      dependencies: { '@terrazul/base': '^2.0.0' },
      compatibility: { 'claude-code': '>=0.2.0' },
      publishedAt: new Date('2024-01-15T00:00:00Z').toISOString(),
      yanked: false,
    },
  },
});

seedPackage('terrazul', 'base', {
  owner: 'terrazul',
  name: 'base',
  fullName: '@terrazul/base',
  description: 'Base package for Terrazul',
  latest: '2.0.0',
  versions: {
    '2.0.0': {
      version: '2.0.0',
      dependencies: {},
      publishedAt: new Date('2024-01-01T00:00:00Z').toISOString(),
      yanked: false,
    },
    '2.1.0': {
      version: '2.1.0',
      dependencies: {},
      publishedAt: new Date('2024-01-10T00:00:00Z').toISOString(),
      yanked: true,
      yankedReason: 'Critical bug in command parsing',
    },
  },
});

function keyFor(owner, name) {
  return `${owner}/${name}`;
}

function ensurePackage(owner, name) {
  const key = keyFor(owner, name);
  if (!packages[key]) {
    packages[key] = {
      owner,
      name,
      fullName: `@${owner}/${name}`,
      description: undefined,
      latest: '0.0.0',
      versions: {},
    };
  }
  return packages[key];
}

function respond(res, status, body) {
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Authorization, Content-Type',
  });
  res.end(JSON.stringify(body));
}

function requireAuth(req) {
  const auth = req.headers.authorization || '';
  return /^Bearer\s+tz_[a-zA-Z0-9]+/.test(auth);
}

function parseSegments(ownerSeg, nameSeg) {
  const owner = decodeURIComponent(ownerSeg).replace(/^@/, '');
  const slug = decodeURIComponent(nameSeg);
  const prefix = `${owner}-`;
  const pkgName = slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
  const key = keyFor(owner, pkgName);
  const fullName = `@${owner}/${pkgName}`;
  return { owner, pkgName, key, fullName, slug };
}

function collectBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseMultipart(buffer, boundary) {
  const parts = [];
  const marker = Buffer.from(`--${boundary}`);
  let index = 0;
  while (true) {
    const start = buffer.indexOf(marker, index);
    if (start === -1) break;
    let partStart = start + marker.length;
    if (buffer[partStart] === 45 && buffer[partStart + 1] === 45) break;
    if (buffer[partStart] === 13 && buffer[partStart + 1] === 10) partStart += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), partStart);
    if (headerEnd === -1) break;
    const headerText = buffer.slice(partStart, headerEnd).toString('utf8');
    const nameMatch = /name="([^"]+)"/.exec(headerText);
    if (!nameMatch) break;
    const filenameMatch = /filename="([^"]*)"/.exec(headerText);
    const contentTypeMatch = /content-type:\s*([^;\r\n]+)/i.exec(headerText);
    const next = buffer.indexOf(marker, headerEnd + 4);
    const end = next === -1 ? buffer.length : next;
    let dataEnd = end;
    while (dataEnd > headerEnd + 4 && buffer[dataEnd - 1] === 10 && buffer[dataEnd - 2] === 13) {
      dataEnd -= 2;
    }
    const data = buffer.slice(headerEnd + 4, dataEnd);
    parts.push({
      name: nameMatch[1],
      filename: filenameMatch ? filenameMatch[1] : undefined,
      contentType: contentTypeMatch ? contentTypeMatch[1] : undefined,
      data,
    });
    index = end;
  }
  return parts;
}

async function handlePublish(req, res, pkg, owner, pkgName) {
  if (!requireAuth(req)) {
    respond(res, 401, { error: 'Authentication required' });
    return;
  }
  const contentType = req.headers['content-type'] || '';
  if (!contentType.includes('multipart/form-data')) {
    respond(res, 415, { error: 'Expected multipart/form-data body' });
    return;
  }
  const boundaryMatch = /boundary=([^;]+)/.exec(contentType);
  if (!boundaryMatch) {
    respond(res, 400, { error: 'Missing multipart boundary' });
    return;
  }
  const body = await collectBody(req);
  const parts = parseMultipart(body, boundaryMatch[1]);
  const versionPart = parts.find((p) => p.name === 'version');
  const tarballPart = parts.find((p) => p.name === 'tarball');
  const metadataPart = parts.find((p) => p.name === 'metadata');
  if (!versionPart || !tarballPart) {
    respond(res, 400, { error: 'Missing version or tarball' });
    return;
  }
  const version = versionPart.data.toString('utf8').trim();
  const metadata = metadataPart ? JSON.parse(metadataPart.data.toString('utf8')) : undefined;
  const integrity = `sha256-${crypto.createHash('sha256').update(tarballPart.data).digest('base64url')}`;
  pkg.versions[version] = {
    version,
    dependencies: metadata?.dependencies || {},
    compatibility: metadata?.compatibility || {},
    publishedAt: new Date().toISOString(),
    yanked: false,
    integrity,
  };
  pkg.latest = version;
  const slug = `${owner}-${pkgName}`;
  const filename = `${slug.replaceAll(/[^\w.-]/g, '_')}-${version}.tgz`;
  fs.writeFileSync(path.join(STORAGE_DIR, filename), tarballPart.data);
  respond(res, 200, {
    message: `Package @${owner}/${pkgName}@${version} published`,
    version,
    name: `@${owner}/${pkgName}`,
  });
  saveRegistry(packages);
}

function serveTarball(res, buffer) {
  res.writeHead(200, {
    'Content-Type': 'application/gzip',
    'Content-Length': buffer.length,
    'Access-Control-Allow-Origin': '*',
  });
  res.end(buffer);
}

const server = http.createServer(async (req, res) => {
  const method = req.method || 'GET';
  const url = new URL(req.url || '/', `http://localhost:${PORT}`);
  const pathname = url.pathname;

  if (method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Authorization, Content-Type',
    });
    res.end();
    return;
  }

  if (method === 'GET' && pathname === '/packages/v1') {
    const list = Object.values(packages).map((pkg) => ({
      id: keyFor(pkg.owner, pkg.name),
      owner_handle: pkg.owner,
      name: `${pkg.owner}-${pkg.name}`,
      full_name: pkg.fullName,
      latest: pkg.latest,
      description: pkg.description,
    }));
    respond(res, 200, { packages: list });
    return;
  }

  if (method === 'GET' && pathname === '/health') {
    respond(res, 200, { status: 'ok', time: new Date().toISOString() });
    return;
  }

  let match = pathname.match(/^\/packages\/v1\/([^/]+)\/([^/]+)$/);
  if (method === 'GET' && match) {
    const { owner, pkgName, key } = parseSegments(match[1], match[2]);
    const pkg = packages[key];
    if (!pkg) {
      respond(res, 404, { error: 'package not found' });
      return;
    }
    respond(res, 200, {
      name: pkg.fullName,
      owner,
      description: pkg.description,
      latest: pkg.latest,
      versions: pkg.versions,
    });
    return;
  }

  match = pathname.match(/^\/packages\/v1\/([^/]+)\/([^/]+)\/versions$/);
  if (method === 'GET' && match) {
    const { owner, pkgName, key } = parseSegments(match[1], match[2]);
    const pkg = packages[key];
    if (!pkg) {
      respond(res, 404, { error: 'package not found' });
      return;
    }
    respond(res, 200, {
      name: pkg.fullName,
      owner,
      versions: pkg.versions,
    });
    return;
  }

  match = pathname.match(/^\/packages\/v1\/([^/]+)\/([^/]+)\/tarball\/([^/]+)$/);
  if (method === 'GET' && match) {
    const { owner, pkgName, key } = parseSegments(match[1], match[2]);
    const version = decodeURIComponent(match[3]);
    const pkg = packages[key];
    const versionInfo = pkg?.versions?.[version];
    if (!pkg || !versionInfo) {
      respond(res, 404, { error: 'version not found' });
      return;
    }
    const slug = `${owner}-${pkgName}`;
    respond(res, 200, {
      url: `http://localhost:${PORT}/tarballs/${encodeURIComponent(owner)}/${encodeURIComponent(slug)}/${version}.tgz`,
      integrity: versionInfo.integrity || 'sha256-fake-integrity',
    });
    return;
  }

  match = pathname.match(/^\/packages\/v1\/([^/]+)\/([^/]+)\/publish$/);
  if (method === 'POST' && match) {
    const { owner, pkgName, key } = parseSegments(match[1], match[2]);
    const pkg = ensurePackage(owner, pkgName);
    await handlePublish(req, res, pkg, owner, pkgName);
    return;
  }

  if (method === 'POST' && pathname === '/packages/v1') {
    if (!requireAuth(req)) {
      respond(res, 401, { error: 'Authentication required' });
      return;
    }
    const body = await collectBody(req);
    const json = JSON.parse(body.toString('utf8') || '{}');
    const name = json.name || '';
    if (!name.includes('/')) {
      respond(res, 400, { error: 'name must be @owner/name' });
      return;
    }
    const [ownerSeg, pkgSeg] = name.split('/');
    const { owner, pkgName, key, fullName } = parseSegments(ownerSeg, pkgSeg);
    if (!packages[key]) {
      packages[key] = {
        owner,
        name: pkgName,
        fullName,
        description: json.description,
        latest: '0.0.0',
        versions: {},
      };
      saveRegistry(packages);
    }
    respond(res, 201, {
      package: { owner_handle: owner, name: `${owner}-${pkgName}`, full_name: fullName },
    });
    return;
  }

  match = pathname.match(/^\/tarballs\/([^/]+)\/([^/]+)\/([^/]+)\.tgz$/);
  if (method === 'GET' && match) {
    const owner = decodeURIComponent(match[1]);
    const slug = decodeURIComponent(match[2]);
    const prefix = `${owner}-`;
    const pkgName = slug.startsWith(prefix) ? slug.slice(prefix.length) : slug;
    const version = decodeURIComponent(match[3]);
    const slug = `${owner}-${pkgName}`;
    const filename = `${slug.replaceAll(/[^\w.-]/g, '_')}-${version}.tgz`;
    const publishedPath = path.join(STORAGE_DIR, filename);
    if (fs.existsSync(publishedPath)) {
      serveTarball(res, fs.readFileSync(publishedPath));
      return;
    }
    const fixtureDir = path.join(__dirname, '..', 'fixtures', 'packages', `${owner}_${pkgName}`);
    const fixturePath = path.join(fixtureDir, `${version}.tgz`);
    if (fs.existsSync(fixturePath)) {
      serveTarball(res, fs.readFileSync(fixturePath));
      return;
    }
    respond(res, 404, { error: 'tarball not found' });
    return;
  }

  respond(res, 404, { error: 'Not found' });
});

server.listen(PORT, () => {
  console.log(`🚀 Fake registry server running on http://localhost:${PORT}`);
});

process.on('SIGINT', () => {
  saveRegistry(packages);
  server.close(() => process.exit(0));
});
