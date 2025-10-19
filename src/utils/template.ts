import { promises as fs } from 'node:fs';

import {
  getSharedHandlebars,
  interpolate as runtimeInterpolate,
  type TemplateContext,
} from './handlebars-runtime.js';
import { preprocessTemplate } from '../core/snippet-preprocessor.js';

import type {
  PreprocessOptions,
  PreprocessResult,
  RenderableSnippetContext,
} from '../types/snippet.js';

const hbs = getSharedHandlebars();

export function interpolate(template: string, context: TemplateContext = {}): string {
  return runtimeInterpolate(template, context, hbs);
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

export { registerCoreHandlebarsHelpers, type TemplateContext } from './handlebars-runtime.js';
