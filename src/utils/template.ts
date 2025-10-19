import { promises as fs } from 'node:fs';

import Handlebars from 'handlebars';

import { preprocessTemplate } from '../core/snippet-preprocessor.js';

import type {
  PreprocessOptions,
  PreprocessResult,
  RenderableSnippetContext,
} from '../types/snippet.js';

type HandlebarsRuntime = typeof Handlebars;

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

const hbs = Handlebars.create();
registerCoreHandlebarsHelpers(hbs);

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

interface TemplateContext {
  [key: string]: unknown;
}

export function interpolate(template: string, context: TemplateContext = {}): string {
  const compiled = hbs.compile(template, { noEscape: true });
  return compiled(context);
}

export async function renderTemplate(
  templatePath: string,
  context: TemplateContext = {},
): Promise<string> {
  const raw = await fs.readFile(templatePath, 'utf8');
  return interpolate(raw, context);
}

export interface RenderTemplateWithSnippetsOptions {
  enableSnippets?: boolean;
  preprocess: PreprocessOptions;
}

export interface RenderTemplateWithSnippetsResult {
  output: string;
  preprocess: PreprocessResult;
}

export async function renderTemplateWithSnippets(
  templatePath: string,
  baseContext: TemplateContext,
  options: RenderTemplateWithSnippetsOptions,
): Promise<RenderTemplateWithSnippetsResult> {
  const raw = await fs.readFile(templatePath, 'utf8');
  if (options.enableSnippets === false) {
    const output = interpolate(raw, baseContext);
    const empty: PreprocessResult = {
      template: raw,
      parsed: [],
      execution: { snippets: {}, vars: {} },
      renderContext: { snippets: {}, vars: {} },
    };
    return { output, preprocess: empty };
  }

  const preprocess = await preprocessTemplate(raw, options.preprocess);
  const mergedContext = mergeRenderContext(baseContext, preprocess.renderContext);
  const output = interpolate(preprocess.template, mergedContext);
  return { output, preprocess };
}

function mergeRenderContext(
  base: TemplateContext,
  renderContext: RenderableSnippetContext,
): TemplateContext {
  const mergedSnippets = {
    ...(typeof base.snippets === 'object' && base.snippets ? base.snippets : {}),
    ...renderContext.snippets,
  };
  const mergedVars = {
    ...(typeof base.vars === 'object' && base.vars ? base.vars : {}),
    ...renderContext.vars,
  };
  return {
    ...base,
    snippets: mergedSnippets,
    vars: mergedVars,
  };
}
