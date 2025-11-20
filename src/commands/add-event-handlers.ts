import { generateAskAgentSummary } from '../utils/ask-agent-summary.js';

import type { SnippetProgress } from '../core/template-renderer.js';
import type { AskAgentTask } from '../ui/apply/AskAgentSpinner.js';
import type { Logger } from '../utils/logger.js';

/**
 * Handle askAgent:start event - create new task and start summary generation.
 */
export function handleAskAgentStart(
  event: Extract<SnippetProgress['event'], { type: 'askAgent:start' }>,
  activeTasks: Map<string, AskAgentTask>,
  renderSpinner: () => void,
  isTTY: boolean,
  logger: Logger,
): void {
  const taskId = event.snippet.id;

  if (activeTasks.has(taskId)) {
    if (logger.isVerbose()) {
      logger.info(`[add] Skipping duplicate askAgent task: ${taskId}`);
    }
    return;
  }

  const task: AskAgentTask = {
    id: taskId,
    title: 'Processing...',
    status: 'running',
  };

  activeTasks.set(taskId, task);

  if (isTTY) {
    renderSpinner();

    generateAskAgentSummary(event.prompt)
      .then((summary) => {
        const existingTask = activeTasks.get(taskId);
        if (existingTask && existingTask.status === 'running') {
          existingTask.title = summary;
          renderSpinner();
        }
        return;
      })
      .catch(() => {
        // Summary generation is non-critical; silently ignore errors
      });
  } else {
    logger.info('Running askAgent snippet...');
  }
}

/**
 * Handle askAgent:end event - mark task as complete.
 */
export function handleAskAgentEnd(
  event: Extract<SnippetProgress['event'], { type: 'askAgent:end' }>,
  activeTasks: Map<string, AskAgentTask>,
  renderSpinner: () => void,
  isTTY: boolean,
  logger: Logger,
): void {
  const taskId = event.snippet.id;
  const task = activeTasks.get(taskId);

  if (task) {
    task.status = 'complete';
    if (isTTY) {
      renderSpinner();
    } else {
      logger.info('askAgent complete.');
    }
  } else if (!isTTY) {
    logger.info('askAgent complete.');
  }
}

/**
 * Handle askAgent:error event - mark task as failed.
 */
export function handleAskAgentError(
  event: Extract<SnippetProgress['event'], { type: 'askAgent:error' }>,
  activeTasks: Map<string, AskAgentTask>,
  renderSpinner: () => void,
  isTTY: boolean,
  logger: Logger,
): void {
  const taskId = event.snippet.id;

  if (taskId) {
    const task = activeTasks.get(taskId);
    if (task) {
      task.status = 'error';
      task.error = event.error.message;
      if (isTTY) {
        renderSpinner();
      } else {
        logger.warn(`askAgent failed: ${event.error.message}`);
      }
    }
  } else if (!isTTY) {
    logger.warn(`askAgent failed: ${event.error.message}`);
  }
}

/**
 * Create a snippet event handler that delegates to specific handlers based on event type.
 */
export function createSnippetEventHandler(
  activeTasks: Map<string, AskAgentTask>,
  renderSpinner: () => void,
  isTTY: boolean,
  logger: Logger,
): (progress: SnippetProgress) => void {
  return ({ event }: SnippetProgress): void => {
    switch (event.type) {
      case 'askAgent:start': {
        handleAskAgentStart(event, activeTasks, renderSpinner, isTTY, logger);
        break;
      }
      case 'askAgent:end': {
        handleAskAgentEnd(event, activeTasks, renderSpinner, isTTY, logger);
        break;
      }
      case 'askAgent:error': {
        handleAskAgentError(event, activeTasks, renderSpinner, isTTY, logger);
        break;
      }
      default: {
        break;
      }
    }
  };
}
