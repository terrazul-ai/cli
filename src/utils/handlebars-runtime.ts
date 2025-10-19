import Handlebars from 'handlebars';

export type HandlebarsRuntime = typeof Handlebars;

export interface TemplateContext {
  [key: string]: unknown;
}

export function registerCoreHandlebarsHelpers(instance: HandlebarsRuntime): void {
  instance.registerHelper('eq', function eqHelper(a: unknown, b: unknown) {
    return a === b;
  });

  instance.registerHelper('json', function jsonHelper(value: unknown) {
    return JSON.stringify(value, null, 2);
  });

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
