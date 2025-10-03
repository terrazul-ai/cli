import React, { type ReactNode, useMemo } from 'react';
import { Box, Text } from 'ink';
import chalk, { supportsColor as chalkSupportsColor } from 'chalk';
import cliTruncate from 'cli-truncate';

export interface WizardFrameHeading {
  task: string;
  stepIndex: number;
  stepCount: number;
  title: string;
}

export type StatusKind = 'idle' | 'busy' | 'success' | 'error';

export interface StatusMessage {
  kind: StatusKind;
  text: string;
  spinner?: string;
}

export interface KeyHint {
  key: string;
  label: string;
  emphasis?: 'primary' | 'danger';
  disabled?: boolean;
  hidden?: boolean;
}

export interface WizardFrameProps {
  heading: WizardFrameHeading;
  instruction?: string;
  children: ReactNode;
  warning?: string | null;
  actionHints: KeyHint[];
  status?: StatusMessage | null;
}

export interface SelectableListItem {
  id: string;
  label: string;
  detail?: string;
  selected: boolean;
}

export interface SelectableListProps {
  items: SelectableListItem[];
  activeIndex: number;
  emptyMessage?: string;
}

export type LogLevel = 'info' | 'warn' | 'error' | 'debug';

export interface LogEntry {
  id: string;
  level: LogLevel;
  message: string;
}

export interface LogPanelProps {
  entries: LogEntry[];
  visible: boolean;
}

const LEVEL_COLOR: Record<LogLevel, string | undefined> = {
  info: 'cyan',
  warn: 'yellow',
  error: 'red',
  debug: 'gray',
};

const COLOR_SUPPORTED = supportsColor();

export function supportsColor(): boolean {
  if (process.env.NO_COLOR) return false;
  const support = chalkSupportsColor;
  return Boolean(support && (support.has256 || support.hasBasic));
}

export function WizardFrame({
  heading,
  instruction,
  children,
  warning,
  actionHints,
  status,
}: WizardFrameProps): React.ReactElement {
  const { task, stepIndex, stepCount, title } = heading;
  const headerText = `${task} • Step ${stepIndex + 1}/${stepCount} — ${title}`;

  return (
    <Box flexDirection="column" gap={1}>
      <Text color={COLOR_SUPPORTED ? 'cyan' : undefined} bold={COLOR_SUPPORTED}>
        {headerText}
      </Text>
      {instruction ? <Text>{instruction}</Text> : null}
      <Box flexDirection="column">{children}</Box>
      {warning ? <Text color="yellow">{warning}</Text> : null}
      <Box>
        <KeyHints items={actionHints} />
      </Box>
      {status && status.kind !== 'idle' ? (
        <Text
          color={status.kind === 'error' ? 'red' : status.kind === 'success' ? 'green' : 'cyan'}
        >
          {status.kind === 'busy' && status.spinner
            ? `${status.spinner} ${status.text}`
            : status.text}
        </Text>
      ) : null}
    </Box>
  );
}

export function SelectableList({
  items,
  activeIndex,
  emptyMessage = 'No entries detected',
}: SelectableListProps): React.ReactElement {
  const columns =
    typeof process !== 'undefined' && process.stdout ? (process.stdout.columns ?? 80) : 80;
  const availableWidth = Math.max(columns - 6, 20);

  if (items.length === 0) {
    return <Text dimColor>{emptyMessage}</Text>;
  }

  return (
    <Box flexDirection="column" gap={0}>
      {items.map((item, index) => {
        const isActive = index === activeIndex;
        const marker = item.selected ? '●' : '○';
        const caret = isActive ? '›' : ' ';
        const label = cliTruncate(item.label, availableWidth);
        const detail = item.detail ? cliTruncate(item.detail, availableWidth) : null;

        return (
          <Box key={item.id} flexDirection="column">
            <Text color={isActive ? 'green' : undefined}>
              {caret} {marker} {label}
            </Text>
            {detail ? <Text dimColor>{`   ${detail}`}</Text> : null}
          </Box>
        );
      })}
    </Box>
  );
}

export interface KeyHintsProps {
  items: KeyHint[];
}

export function KeyHints({ items }: KeyHintsProps): React.ReactElement {
  const visible = useMemo(() => items.filter((hint) => !hint.hidden), [items]);
  if (visible.length === 0) {
    return <Text dimColor> </Text>;
  }
  return (
    <Box flexDirection="row" flexWrap="wrap" gap={2}>
      {visible.map((hint, index) => {
        const formattedLabel = hint.disabled ? `${hint.label} (disabled)` : hint.label;
        const color =
          hint.emphasis === 'primary' ? 'green' : hint.emphasis === 'danger' ? 'red' : 'cyan';
        return (
          <Box key={`${hint.key}-${hint.label}-${index}`} flexDirection="row">
            <Text color={color} bold={hint.emphasis === 'primary'}>
              {hint.key}
            </Text>
            <Text dimColor>{` • ${formattedLabel}`}</Text>
          </Box>
        );
      })}
    </Box>
  );
}

export function LogPanel({ entries, visible }: LogPanelProps): React.ReactElement | null {
  if (!visible) return null;
  if (entries.length === 0) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text dimColor>Activity log</Text>
        <Text dimColor>No log entries yet</Text>
      </Box>
    );
  }
  return (
    <Box flexDirection="column" gap={1}>
      <Text dimColor>Activity log</Text>
      {entries.slice(-10).map((entry) => (
        <Text key={entry.id} color={LEVEL_COLOR[entry.level]}>
          {entry.message}
        </Text>
      ))}
    </Box>
  );
}
