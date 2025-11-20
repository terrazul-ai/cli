import cliTruncate from 'cli-truncate';
import { Box, Text } from 'ink';
import React, { useState, useEffect, useRef } from 'react';

/**
 * Braille patterns used for spinner animation
 */
const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

/**
 * Interval between spinner frame changes (96ms)
 */
const SPINNER_INTERVAL = 96;

/**
 * Status of an askAgent task
 */
export type AskAgentTaskStatus = 'running' | 'complete' | 'error';

/**
 * Represents a single askAgent task being tracked
 */
export interface AskAgentTask {
  /** Unique identifier for the task */
  id: string;
  /** Title/summary of what the task is doing */
  title: string;
  /** Current status of the task */
  status: AskAgentTaskStatus;
  /** Error message if status is 'error' */
  error?: string;
}

/**
 * Props for the AskAgentSpinner component
 */
export interface AskAgentSpinnerProps {
  /** Array of tasks to display */
  tasks: AskAgentTask[];
}

/**
 * Custom hook to manage spinner animation
 * Returns the current spinner frame character
 */
function useSpinner(active: boolean): string {
  const frameRef = useRef(0);
  const [frame, setFrame] = useState(SPINNER_FRAMES[0]);

  useEffect(() => {
    if (!active) {
      frameRef.current = 0;
      setFrame(SPINNER_FRAMES[0]);
      return;
    }
    const id = setInterval(() => {
      frameRef.current = (frameRef.current + 1) % SPINNER_FRAMES.length;
      setFrame(SPINNER_FRAMES[frameRef.current]);
    }, SPINNER_INTERVAL);
    return () => clearInterval(id);
  }, [active]);

  return frame;
}

/**
 * AskAgentSpinner component displays progress for one or more askAgent operations
 *
 * Shows:
 * - Animated spinner for running tasks
 * - Checkmark (✓) for completed tasks
 * - X mark (✗) for failed tasks with optional error message
 * - Dynamic title updates as summaries are generated
 *
 * @example
 * ```tsx
 * const tasks: AskAgentTask[] = [
 *   { id: '1', title: 'Processing...', status: 'running' },
 * ];
 * render(<AskAgentSpinner tasks={tasks} />);
 * ```
 */
export function AskAgentSpinner({ tasks }: AskAgentSpinnerProps): React.ReactElement | null {
  const hasRunningTasks = tasks.some((task) => task.status === 'running');
  const spinnerFrame = useSpinner(hasRunningTasks);

  // Calculate available width for truncation
  const columns =
    typeof process !== 'undefined' && process.stdout ? (process.stdout.columns ?? 80) : 80;
  // Reserve space for: spinner/icon (2) + space (1) + padding (4) = 7 chars
  const availableWidth = Math.max(columns - 7, 20);

  if (tasks.length === 0) {
    return null;
  }

  return (
    <Box flexDirection="column" gap={0}>
      {tasks.map((task) => {
        const truncatedTitle = cliTruncate(task.title, availableWidth);

        // Determine icon/spinner based on status
        let icon: string;
        let color: 'cyan' | 'green' | 'red' = 'cyan';

        switch (task.status) {
          case 'running': {
            icon = spinnerFrame;
            color = 'cyan';
            break;
          }
          case 'complete': {
            icon = '✓';
            color = 'green';
            break;
          }
          case 'error': {
            icon = '✗';
            color = 'red';
            break;
          }
        }

        return (
          <Box key={task.id} flexDirection="column">
            <Text color={color}>
              {icon} {truncatedTitle}
            </Text>
            {task.status === 'error' && task.error ? (
              <Text color="red" dimColor>
                {'  '} {task.error}
              </Text>
            ) : null}
          </Box>
        );
      })}
    </Box>
  );
}
