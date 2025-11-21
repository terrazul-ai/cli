import { existsSync } from 'node:fs';

import Handlebars from 'handlebars';

import { resolveWithin } from './path.js';

export type HandlebarsRuntime = typeof Handlebars;

export interface TemplateContext {
  [key: string]: unknown;
  project?: {
    root?: string;
  };
}

export function registerCoreHandlebarsHelpers(instance: HandlebarsRuntime): void {
  instance.registerHelper('eq', function eqHelper(a: unknown, b: unknown) {
    return a === b;
  });

  instance.registerHelper('json', function jsonHelper(value: unknown) {
    return JSON.stringify(value, null, 2);
  });

  instance.registerHelper(
    'exists',
    function existsHelper(this: TemplateContext, relativePath: unknown) {
      if (typeof relativePath !== 'string') return false;
      const projectRoot =
        typeof this.project === 'object' && this.project && typeof this.project.root === 'string'
          ? this.project.root
          : process.cwd();

      try {
        // Use resolveWithin to enforce containment within project root
        // This prevents directory traversal attacks and absolute path probing
        const safePath = resolveWithin(projectRoot, relativePath);
        return existsSync(safePath);
      } catch {
        // Path escaped project root or was otherwise invalid - return false
        // Optionally log the attempt for security auditing
        if (process.env.TERRAZUL_VERBOSE === '1') {
          console.warn(`exists helper blocked invalid path: ${relativePath}`);
        }
        return false;
      }
    },
  );

  instance.registerHelper(
    'findById',
    function findByIdHelper(list: unknown, id: unknown, field?: unknown) {
      const entry = resolveById(list, id);
      if (!entry || typeof entry !== 'object') {
        return typeof field === 'string' ? '' : null;
      }
      if (typeof field === 'string' && field.length > 0) {
        const value = (entry as Record<string, unknown>)[field];
        return value ?? '';
      }
      return entry;
    },
  );

  instance.registerHelper('includes', function includesHelper(value: unknown, list: unknown) {
    if (typeof value !== 'string' || typeof list !== 'string') return false;
    const options = list.split(/\s+/).filter(Boolean);
    return options.includes(value);
  });

  instance.registerHelper('not', function notHelper(value: unknown) {
    return !value;
  });

  instance.registerHelper('or', function orHelper(...args: unknown[]) {
    // Handlebars passes an options object as the last argument
    const values = args.slice(0, -1);
    return values.some((v) => !!v);
  });
}

const sharedRuntime = Handlebars.create();
registerCoreHandlebarsHelpers(sharedRuntime);

export function getSharedHandlebars(): HandlebarsRuntime {
  return sharedRuntime;
}

export function interpolate(
  template: string,
  context: TemplateContext = {},
  runtime: HandlebarsRuntime = sharedRuntime,
): string {
  const compiled = runtime.compile(template, { noEscape: true });
  return compiled(context);
}

function resolveById(collection: unknown, id: unknown): unknown {
  if (!Array.isArray(collection)) return undefined;
  const targetId = id == null ? undefined : String(id);
  for (const entry of collection) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = (entry as { id?: unknown }).id;
    if (candidate == null) continue;
    if (String(candidate) === targetId) {
      return entry;
    }
  }
  return undefined;
}
