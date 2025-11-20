import { Box, Text } from 'ink';
import { render } from 'ink-testing-library';
import React from 'react';
import { describe, it, expect } from 'vitest';

import {
  WizardFrame,
  type KeyHint,
  SelectableList,
  type SelectableListItem,
  LogPanel,
  KeyHints,
} from '../../src/ui/extract/components';

const stripAnsi = (value?: string): string =>
  value ? value.replaceAll(/\u001B\[[\d;?]*[ -/]*[@-~]/g, '') : '';

describe('extract UI components', () => {
  it('renders wizard frame with heading, instruction, warning, action hints, and status', () => {
    const hints: KeyHint[] = [
      { key: 'Enter', label: 'Continue', emphasis: 'primary', disabled: true },
      { key: 'V', label: 'Show logs' },
    ];
    const { lastFrame } = render(
      <WizardFrame
        heading={{ task: 'Extract', stepIndex: 2, stepCount: 6, title: 'Confirm Package Metadata' }}
        instruction="Review and adjust package metadata."
        warning="Version must be valid semver."
        actionHints={hints}
        status={{ kind: 'busy', text: 'Analyzing project…', spinner: '⠋' }}
      >
        <Box>
          <Text>Body content</Text>
        </Box>
      </WizardFrame>,
    );

    const frame = stripAnsi(lastFrame());
    expect(frame).toContain('Extract • Step 3/6 — Confirm Package Metadata');
    expect(frame).toContain('Review and adjust package metadata.');
    expect(frame).toContain('Version must be valid semver.');
    expect(frame).toContain('Enter • Continue (disabled)');
    expect(frame).toContain('V • Show logs');
    expect(frame).toContain('⠋ Analyzing project…');
  });

  it('renders selectable list with caret, filled markers, and detail rows', () => {
    const items: SelectableListItem[] = [
      { id: 'one', label: 'First item', detail: 'detail path', selected: true },
      { id: 'two', label: 'Second item', selected: false },
    ];
    const { lastFrame } = render(
      <SelectableList items={items} activeIndex={0} emptyMessage="None" />,
    );

    const frame = stripAnsi(lastFrame());
    expect(frame).toContain('› ● First item');
    expect(frame).toContain('detail path');
    expect(frame).toContain('○ Second item');
  });

  it('renders key hints with emphasis and disabled labelling', () => {
    const hints: KeyHint[] = [
      { key: 'Enter', label: 'Extract', emphasis: 'primary', disabled: false },
      { key: 'Shift+Tab', label: 'Back' },
      { key: 'C', label: 'Copy summary', disabled: true },
    ];
    const { lastFrame } = render(<KeyHints items={hints} />);

    const frame = stripAnsi(lastFrame());
    expect(frame).toContain('Enter • Extract');
    expect(frame).toContain('Shift+Tab • Back');
    expect(frame).toContain('C • Copy summary (disabled)');
  });

  it('hides log panel when not visible', () => {
    const { lastFrame } = render(<LogPanel entries={[]} visible={false} />);
    expect(stripAnsi(lastFrame())).toBe('');
  });
});
