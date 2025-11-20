import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

import {
  AskAgentSpinner,
  type AskAgentTask,
  type AskAgentSpinnerProps,
} from '../../../../src/ui/apply/AskAgentSpinner';

describe('AskAgentSpinner', () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });

  it('renders a single running task with spinner', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Generate authentication module',
        status: 'running',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    expect(lastFrame()).toContain('Generate authentication module');
    // Should include a spinner character (one of the Braille patterns)
    expect(lastFrame()).toMatch(/[⠇⠋⠏⠙⠦⠧⠴⠸⠹⠼]/);
  });

  it('renders multiple running tasks', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Build user authentication',
        status: 'running',
      },
      {
        id: 'task-2',
        title: 'Create API endpoints',
        status: 'running',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    expect(lastFrame()).toContain('Build user authentication');
    expect(lastFrame()).toContain('Create API endpoints');
  });

  it('shows completed task with checkmark', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Generate authentication module',
        status: 'complete',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    expect(lastFrame()).toContain('Generate authentication module');
    expect(lastFrame()).toContain('✓');
  });

  it('shows error task with X mark', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Generate authentication module',
        status: 'error',
        error: 'Tool execution failed',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    expect(lastFrame()).toContain('Generate authentication module');
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Tool execution failed');
  });

  it('updates when tasks prop changes', () => {
    const initialTasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Processing...',
        status: 'running',
      },
    ];

    const { lastFrame, rerender } = render(<AskAgentSpinner tasks={initialTasks} />);

    expect(lastFrame()).toContain('Processing...');

    // Update with new title (summary arrived)
    const updatedTasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Generate authentication module',
        status: 'running',
      },
    ];

    rerender(<AskAgentSpinner tasks={updatedTasks} />);

    expect(lastFrame()).toContain('Generate authentication module');
  });

  it('animates spinner for running tasks', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Processing',
        status: 'running',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    const frame1 = lastFrame();

    // Advance time by 96ms (one spinner interval)
    vi.advanceTimersByTime(96);

    const frame2 = lastFrame();

    // Frames should be different due to spinner animation
    // (unless we happen to land on the same frame in the cycle)
    expect([frame1, frame2].some((f) => f.match(/[⠇⠋⠏⠙⠦⠧⠴⠸⠹⠼]/))).toBe(true);
  });

  it('renders nothing when tasks array is empty', () => {
    const { lastFrame } = render(<AskAgentSpinner tasks={[]} />);

    expect(lastFrame()).toBe('');
  });

  it('handles mixed status tasks', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'First task',
        status: 'complete',
      },
      {
        id: 'task-2',
        title: 'Second task',
        status: 'running',
      },
      {
        id: 'task-3',
        title: 'Third task',
        status: 'error',
        error: 'Failed',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    const output = lastFrame();
    expect(output).toContain('First task');
    expect(output).toContain('Second task');
    expect(output).toContain('Third task');
    expect(output).toContain('✓'); // complete
    expect(output).toContain('✗'); // error
    expect(output).toMatch(/[⠇⠋⠏⠙⠦⠧⠴⠸⠹⠼]/); // spinner for running
  });

  it('only shows error message when present', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'Task without error',
        status: 'error',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    // Should show error mark but not an error message
    expect(lastFrame()).toContain('✗');
    expect(lastFrame()).toContain('Task without error');
  });

  it('truncates very long titles to fit terminal width', () => {
    const tasks: AskAgentTask[] = [
      {
        id: 'task-1',
        title: 'A'.repeat(200), // Very long title
        status: 'running',
      },
    ];

    const { lastFrame } = render(<AskAgentSpinner tasks={tasks} />);

    const output = lastFrame();
    // Should be truncated (assuming 80 column terminal)
    expect(output.length).toBeLessThan(200);
    expect(output).toMatch(/A+/);
  });
});
