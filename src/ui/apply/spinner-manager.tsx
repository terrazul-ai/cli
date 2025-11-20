import { render, type Instance } from 'ink';
import React from 'react';

import { AskAgentSpinner, type AskAgentTask } from './AskAgentSpinner.js';

export interface SpinnerManager {
  activeTasks: Map<string, AskAgentTask>;
  renderSpinner: () => void;
  cleanup: () => void;
}

/**
 * Create a spinner manager for handling Ink-based loading indicators.
 * Returns methods to update task state and render the spinner.
 */
export function createSpinnerManager(isTTY: boolean): SpinnerManager {
  const activeTasks = new Map<string, AskAgentTask>();
  let inkInstance: Instance | null = null;

  const renderSpinner = (): void => {
    if (!isTTY) return;

    const tasks = [...activeTasks.values()];
    if (tasks.length === 0) {
      if (inkInstance !== null) {
        const instance: Instance = inkInstance;
        instance.unmount();
        inkInstance = null;
      }
      return;
    }

    if (inkInstance === null) {
      inkInstance = render(<AskAgentSpinner tasks={tasks} />, {
        stdout: process.stdout,
        stdin: process.stdin,
        exitOnCtrlC: false,
      });
    } else {
      inkInstance.rerender(<AskAgentSpinner tasks={tasks} />);
    }
  };

  const cleanup = (): void => {
    if (inkInstance !== null) {
      const instance: Instance = inkInstance;
      instance.unmount();
      inkInstance = null;
    }
  };

  return { activeTasks, renderSpinner, cleanup };
}
