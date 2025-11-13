/**
 * Registry API client for package operations
 * Handles authentication, CDN redirects, and error mapping
 */

import { URL } from 'node:url';

import { ErrorCode, TerrazulError } from './errors.js';
import { buildPackageApiPath, splitPackageName } from '../utils/package.js';
import { getCliVersion } from '../utils/version.js';

import type { APIError } from '../types/api.js';

export interface PackageInfo {
  name: string;
  owner: string;
  description?: string;
  latest: string;
  versions: string[];
}

export interface VersionInfo {
  version: string;
  dependencies: Record<string, string>;
  compatibility?: Record<string, string>;
  publishedAt: string;
  yanked: boolean;
  yankedReason?: string;
}

export interface PackageVersions {
  name: string;
  owner: string;
  versions: Record<string, VersionInfo>;
}

export interface TarballInfo {
  url: string;
  integrity?: string;
}

export interface RegistryClientOptions {
  registryUrl: string;
  token?: string;
}

const FALLBACK_PUBLISHED_AT = new Date(0).toISOString();

function coerceStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const entries: [string, string][] = [];
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (typeof raw === 'string') {
      entries.push([key, raw]);
    }
  }
  if (entries.length === 0) return undefined;
  return Object.fromEntries(entries);
}

function coercePublishedAt(value: unknown): string {
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString();
  }
  if (typeof value === 'number' && Number.isFinite(value)) {
    const ms = value > 10_000_000_000 ? value : value * 1000;
    const parsed = new Date(ms);
    return Number.isNaN(parsed.getTime()) ? FALLBACK_PUBLISHED_AT : parsed.toISOString();
  }
  if (typeof value === 'string' && value.trim().length > 0) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    return value;
  }
  return FALLBACK_PUBLISHED_AT;
}

function buildMinimalVersionInfo(version: string): VersionInfo | undefined {
  const trimmed = version.trim();
  if (!trimmed) return undefined;
  return {
    version: trimmed,
    dependencies: {},
    publishedAt: FALLBACK_PUBLISHED_AT,
    yanked: false,
  };
}

function parseVersionEntry(entry: unknown, fallbackVersion?: string): VersionInfo | undefined {
  if (typeof entry === 'string') {
    return buildMinimalVersionInfo(entry);
  }

  if (!entry || typeof entry !== 'object') {
    return fallbackVersion ? buildMinimalVersionInfo(fallbackVersion) : undefined;
  }

  const raw = entry as Record<string, unknown>;
  const versionCandidate = (() => {
    const versionValue = raw.version;
    if (typeof versionValue === 'string' && versionValue.trim()) return versionValue.trim();
    if (typeof versionValue === 'number' && Number.isFinite(versionValue)) {
      return String(versionValue);
    }
    if (fallbackVersion && fallbackVersion.trim()) return fallbackVersion.trim();
    return;
  })();

  if (!versionCandidate) return undefined;

  const dependencies = coerceStringRecord(raw.dependencies) ?? {};
  const compatibility = coerceStringRecord(raw.compatibility);
  const publishedAt = coercePublishedAt(
    raw.publishedAt ?? raw.published_at ?? raw.createdAt ?? raw.created_at,
  );
  const yanked = raw.yanked === true;
  const yankedReason =
    typeof raw.yankedReason === 'string'
      ? raw.yankedReason
      : typeof raw.yanked_reason === 'string'
        ? raw.yanked_reason
        : undefined;

  return {
    version: versionCandidate,
    dependencies,
    compatibility,
    publishedAt,
    yanked,
    yankedReason,
  };
}

function normalizeVersionsCollection(raw: unknown): Record<string, VersionInfo> {
  if (!raw) return {};

  if (Array.isArray(raw)) {
    const pairs = raw
      .map((entry) => parseVersionEntry(entry))
      .filter((info): info is VersionInfo => info !== undefined)
      .map((info) => [info.version, info] as const);
    return Object.fromEntries(pairs);
  }

  if (typeof raw === 'object') {
    const result: Record<string, VersionInfo> = {};
    for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
      const info = parseVersionEntry(value, key);
      if (!info) continue;
      result[info.version] = info;
    }
    return result;
  }

  return {};
}

function isLoopbackHost(hostname: string): boolean {
  return (
    hostname === 'localhost' ||
    hostname === '::1' ||
    hostname === '[::1]' ||
    hostname.startsWith('127.')
  );
}

export class RegistryClient {
  private registryUrl: string;
  private token?: string;

  constructor(options: RegistryClientOptions) {
    // Validate registry URL (HTTPS only except loopback hosts)
    const url = new URL(options.registryUrl);
    if (url.protocol !== 'https:' && !isLoopbackHost(url.hostname)) {
      throw new TerrazulError(
        ErrorCode.NETWORK_ERROR,
        `Registry must use HTTPS (got ${url.protocol}//)`,
      );
    }
    this.registryUrl = options.registryUrl.replace(/\/$/, '');
    this.token = options.token;
  }

  async getPackageInfo(packageName: string): Promise<PackageInfo> {
    const detail = await this.fetchPackageDetail(packageName);
    const versionsRaw = detail.versions;
    const versions = (
      Array.isArray(versionsRaw)
        ? versionsRaw
            .map((entry) =>
              typeof entry === 'string'
                ? entry
                : entry && typeof entry === 'object' && 'version' in entry
                  ? String((entry as { version?: unknown }).version ?? '')
                  : '',
            )
            .filter((v) => v.length > 0)
        : Object.keys(versionsRaw ?? {})
    ).sort((a, b) => a.localeCompare(b, undefined, { numeric: true, sensitivity: 'case' }));
    const info: PackageInfo = {
      name: detail.name,
      owner: detail.owner ?? splitPackageName(packageName).owner,
      description: detail.description,
      latest: detail.latest ?? versions.at(-1) ?? '0.0.0',
      versions,
    };
    return info;
  }

  async getPackageVersions(packageName: string): Promise<PackageVersions> {
    const detail = await this.fetchPackageDetail(packageName, true);
    const versions = normalizeVersionsCollection(detail.versions);
    return {
      name: detail.name,
      owner: detail.owner ?? splitPackageName(packageName).owner,
      versions,
    };
  }

  async getTarballInfo(packageName: string, version: string): Promise<TarballInfo> {
    const path = buildPackageApiPath(packageName, 'tarball', version);
    const url = `${this.registryUrl}${path}`;
    const headers = this.createHeaders();
    const response = await fetch(url, { method: 'GET', headers, redirect: 'manual' });

    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get('location');
      if (!location) {
        throw new TerrazulError(
          ErrorCode.UNKNOWN_ERROR,
          `Registry redirect missing location for ${packageName}@${version}`,
        );
      }
      return { url: location };
    }

    const contentType = response.headers.get('content-type') ?? '';
    if (!response.ok) {
      if (contentType.includes('application/json')) {
        const text = await response.text();
        const json = text ? JSON.parse(text) : undefined;
        if (json && typeof json === 'object' && 'code' in json && 'message' in json) {
          throw this.mapApiError(json as APIError);
        }
        const message =
          json && typeof json === 'object' && 'error' in json
            ? String((json as { error: unknown }).error)
            : response.statusText;
        throw new TerrazulError(ErrorCode.UNKNOWN_ERROR, message);
      }
      throw new TerrazulError(
        ErrorCode.UNKNOWN_ERROR,
        `Registry error: ${response.status} ${response.statusText}`,
      );
    }

    if (contentType.includes('application/json')) {
      const text = await response.text();
      const json = text ? JSON.parse(text) : undefined;
      if (json && typeof json === 'object' && 'url' in json) {
        return json as TarballInfo;
      }
      throw new TerrazulError(ErrorCode.UNKNOWN_ERROR, 'Unexpected tarball response shape');
    }

    // Fallback: assume direct download endpoint
    return { url };
  }

  async downloadTarball(urlStr: string): Promise<Buffer> {
    const res = await fetch(urlStr, {
      method: 'GET',
      headers: { 'User-Agent': this.getUserAgent() },
    });
    if (!res.ok) {
      throw new TerrazulError(
        ErrorCode.NETWORK_ERROR,
        `Failed to download tarball: ${res.status} ${res.statusText}`,
      );
    }
    const ab = await res.arrayBuffer();
    return Buffer.from(ab);
  }

  async publishPackage(
    packageName: string,
    tarball: Buffer,
    metadata: Record<string, unknown>,
    readme?: string,
  ): Promise<{ message: string; version: string }> {
    if (!this.token) {
      throw new TerrazulError(ErrorCode.AUTH_REQUIRED, 'Authentication required for publishing');
    }
    const { name } = splitPackageName(packageName);
    const version = String(metadata.version ?? '0.0.0');
    const formData = new FormData();
    const sanitizedFile = `${name.replaceAll(/[^\w.-]/g, '_')}-${version}.tgz`;
    const tarballBlob = new Blob([new Uint8Array(tarball)], { type: 'application/gzip' });

    formData.append('tarball', tarballBlob, sanitizedFile);
    formData.append('metadata', JSON.stringify(metadata));

    // Add README if provided
    if (readme !== undefined) {
      formData.append('readme', readme);
    }

    return await this.request<{ message: string; version: string }>(
      'POST',
      buildPackageApiPath(packageName, 'publish'),
      formData,
    );
  }

  async yankVersion(
    packageName: string,
    version: string,
    reason?: string,
  ): Promise<{ message: string }> {
    if (!this.token) {
      throw new TerrazulError(ErrorCode.AUTH_REQUIRED, 'Authentication required for yanking');
    }
    const payload = reason ? { reason } : undefined;
    return await this.request<{ message: string }>(
      'POST',
      buildPackageApiPath(packageName, 'yank', version),
      payload,
    );
  }

  async unyankVersion(packageName: string, version: string): Promise<{ message: string }> {
    if (!this.token) {
      throw new TerrazulError(ErrorCode.AUTH_REQUIRED, 'Authentication required for unyanking');
    }
    return await this.request<{ message: string }>(
      'POST',
      buildPackageApiPath(packageName, 'unyank', version),
    );
  }

  private async fetchPackageDetail(
    packageName: string,
    preferVersionMap = false,
  ): Promise<{
    name: string;
    owner?: string;
    description?: string;
    latest?: string;
    versions?: unknown;
  }> {
    const primaryPath = preferVersionMap
      ? buildPackageApiPath(packageName, 'versions')
      : buildPackageApiPath(packageName);
    try {
      const raw = await this.request('GET', primaryPath);
      return this.normalizePackageDetail(packageName, raw);
    } catch (error) {
      if (preferVersionMap && error instanceof TerrazulError) {
        if (error.code === ErrorCode.PACKAGE_NOT_FOUND) throw error;
        const raw = await this.request('GET', buildPackageApiPath(packageName));
        return this.normalizePackageDetail(packageName, raw);
      }
      throw error;
    }
  }

  private normalizePackageDetail(
    packageName: string,
    raw: unknown,
  ): {
    name: string;
    owner?: string;
    description?: string;
    latest?: string;
    versions?: unknown;
  } {
    const base = splitPackageName(packageName);
    const fullName = `@${base.owner}/${base.name}`;

    const unwrap = (value: unknown): Record<string, unknown> | undefined => {
      if (value && typeof value === 'object' && 'package' in (value as Record<string, unknown>)) {
        const pkgValue = (value as Record<string, unknown>).package;
        if (pkgValue && typeof pkgValue === 'object') {
          return pkgValue as Record<string, unknown>;
        }
      }
      return value && typeof value === 'object' ? (value as Record<string, unknown>) : undefined;
    };

    const detail = unwrap(raw) ?? {};
    const versionsCandidate =
      detail.versions ??
      (raw && typeof raw === 'object' ? (raw as { versions?: unknown }).versions : undefined);
    const latestCandidate =
      detail.latest ??
      detail.latest_version ??
      (raw && typeof raw === 'object' ? (raw as { latest?: unknown }).latest : undefined);
    const description = typeof detail.description === 'string' ? detail.description : undefined;
    const latest = typeof latestCandidate === 'string' ? latestCandidate : undefined;

    const normalizedName =
      typeof detail.name === 'string' && detail.name.startsWith('@') ? detail.name : fullName;

    return {
      name: normalizedName,
      owner: base.owner,
      description,
      latest,
      versions: versionsCandidate,
    };
  }

  private async request<T>(
    method: string,
    path: string,
    body?: BodyInit | Record<string, unknown>,
  ): Promise<T> {
    const url = `${this.registryUrl}${path}`;
    const headers = this.createHeaders();

    let payload: BodyInit | undefined;
    if (body !== undefined) {
      // Only set Content-Type for JSON bodies; FormData sets its own boundary
      if (typeof body === 'object' && !(body instanceof FormData) && !('arrayBuffer' in body)) {
        headers['Content-Type'] = 'application/json';
        payload = JSON.stringify(body);
      } else {
        payload = body as BodyInit;
      }
    }

    const options: RequestInit = { method, headers };
    if (payload !== undefined) {
      options.body = payload;
    }

    try {
      const response = await fetch(url, options);
      const contentType = response.headers.get('content-type') || '';
      const text = await response.text();
      const json = contentType.includes('application/json') && text ? JSON.parse(text) : undefined;

      if (response.status === 401) {
        throw new TerrazulError(
          ErrorCode.AUTH_REQUIRED,
          'Authentication required. Please check your token.',
        );
      }

      if (!response.ok) {
        if (json) {
          // Check for standard API error format { code, message }
          if (typeof json === 'object' && 'code' in json && 'message' in json) {
            throw this.mapApiError(json as APIError);
          }
          // Fallback error handling for non-standard formats
          const message = String(
            typeof json.error === 'string'
              ? json.error
              : typeof json.message === 'string'
                ? json.message
                : response.statusText,
          );
          if (response.status === 404) {
            throw new TerrazulError(ErrorCode.PACKAGE_NOT_FOUND, message);
          }
          if (response.status === 403) {
            throw new TerrazulError(ErrorCode.PERMISSION_DENIED, message);
          }
          throw new TerrazulError(ErrorCode.UNKNOWN_ERROR, message);
        }
        throw new TerrazulError(
          ErrorCode.UNKNOWN_ERROR,
          `Registry error: ${response.status} ${response.statusText}`,
        );
      }

      // Success: return bare response
      if (json !== undefined) {
        return json as T;
      }

      throw new TerrazulError(ErrorCode.UNKNOWN_ERROR, 'Unexpected registry response shape');
    } catch (error: unknown) {
      if (error instanceof TerrazulError) throw error;
      if (error instanceof TypeError && String(error.message).includes('fetch')) {
        throw new TerrazulError(
          ErrorCode.NETWORK_ERROR,
          `Network error: Cannot connect to registry at ${this.registryUrl}`,
        );
      }
      throw new TerrazulError(ErrorCode.UNKNOWN_ERROR, `Registry request failed: ${String(error)}`);
    }
  }

  private mapApiError(error: APIError): TerrazulError {
    const errorCode = error.code || 'UNKNOWN_ERROR';
    const message = error.message || 'Unknown error occurred';
    const codeMap: Record<string, ErrorCode> = {
      PACKAGE_NOT_FOUND: ErrorCode.PACKAGE_NOT_FOUND,
      VERSION_NOT_FOUND: ErrorCode.VERSION_NOT_FOUND,
      AUTH_REQUIRED: ErrorCode.AUTH_REQUIRED,
      PERMISSION_DENIED: ErrorCode.PERMISSION_DENIED,
      VERSION_CONFLICT: ErrorCode.VERSION_CONFLICT,
      VERSION_YANKED: ErrorCode.VERSION_YANKED,
      INVALID_PACKAGE: ErrorCode.INVALID_PACKAGE,
      TOKEN_EXPIRED: ErrorCode.TOKEN_EXPIRED,
    };
    return new TerrazulError(codeMap[errorCode] || ErrorCode.UNKNOWN_ERROR, message);
  }

  private getUserAgent(): string {
    return `terrazul-cli/${getCliVersion()}`;
  }

  private createHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'User-Agent': this.getUserAgent(),
    };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    return headers;
  }
}
