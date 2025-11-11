import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  type ExecuteOptions,
  type ExtractOptions,
  type ExtractPlan,
  type ExtractResult,
  type LoggerLike,
} from '../../core/extract/orchestrator.js';
import {
  type KeyHint,
  type LogEntry,
  LogPanel,
  SelectableList,
  type SelectableListItem,
  type StatusMessage,
  WizardFrame,
} from './components.js';
import { OPTION_TOGGLE_CONFIG, STEP_CONFIG, type OptionToggleId } from './extract-wizard-config.js';
import { useExtractWizardState } from './extract-wizard-state.js';
import {
  buildActionHints,
  buildWizardViewModel,
  computeIncludedArtifacts,
  type OptionListItem,
  type WizardViewModel,
} from './extract-wizard-viewmodel.js';

const TASK_NAME = 'Extract';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 96;

export interface ExtractWizardProps {
  baseOptions: ExtractOptions;
  analyze: (options: ExtractOptions) => Promise<ExtractPlan>;
  execute: (plan: ExtractPlan, execOptions: ExecuteOptions) => Promise<ExtractResult>;
  logger: LoggerLike;
  initialPlan?: ExtractPlan;
  onComplete?: (result: ExtractResult, execOptions: ExecuteOptions) => void;
  onCancel?: () => void;
}

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

export function ExtractWizard({
  baseOptions,
  analyze,
  execute,
  logger,
  initialPlan,
  onComplete,
  onCancel,
}: ExtractWizardProps): React.ReactElement {
  const { exit } = useApp();
  const { state, actions } = useExtractWizardState({ baseOptions, initialPlan });

  const spinnerFrame = useSpinner(state.status === 'analyzing' || state.status === 'executing');

  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsVisible, setLogsVisible] = useState(false);

  const analysisTokenRef = useRef(0);
  const initializedRef = useRef(false);
  const ctrlCRef = useRef<{
    timestamp: number;
    prevMessage: string | null;
    timeout?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastExecOptionsRef = useRef<ExecuteOptions | null>(null);
  const tabPendingRef = useRef(false);

  const primaryDisabledRef = useRef(false);
  const attemptForwardRef = useRef<() => void>(() => {});
  const handleExecuteRef = useRef<() => Promise<void> | void>();

  const pushLog = useCallback(
    (level: LogEntry['level'], message: string) => {
      const entry: LogEntry = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        level,
        message,
      };
      setLogs((prev) => [...prev.slice(-49), entry]);
      if (level === 'info') logger.info(message);
      else if (level === 'warn') logger.warn(message);
      else if (level === 'error') logger.error(message);
      else logger.debug(message);
    },
    [logger],
  );

  const runAnalysis = useCallback(
    async (nextOptions: ExtractOptions, preferExistingSelections: boolean, reason?: string) => {
      const token = ++analysisTokenRef.current;
      actions.setStatus('analyzing', reason ?? 'Analyzing project…');
      actions.setError(null);
      pushLog('info', reason ?? 'Analyzing extract plan');
      try {
        const nextPlan = await analyze(nextOptions);
        if (analysisTokenRef.current !== token) return;
        actions.applyPlan(nextPlan, preferExistingSelections);
        actions.setStatus('idle', null);
      } catch (error) {
        if (analysisTokenRef.current !== token) return;
        const message = error instanceof Error ? error.message : String(error);
        actions.setStatus('error', null);
        actions.setError(message);
        pushLog('error', message);
        if (logger.isVerbose && logger.isVerbose()) {
          if (error instanceof Error) logger.error(error.stack ?? message);
        }
      }
    },
    [actions, analyze, logger, pushLog],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (!initialPlan) {
      void runAnalysis({ ...state.options }, false, 'Analyzing project…');
    }
  }, [initialPlan, runAnalysis, state.options]);

  useEffect(
    () => () => {
      if (ctrlCRef.current?.timeout) clearTimeout(ctrlCRef.current.timeout);
    },
    [],
  );

  useEffect(() => {
    if (state.status === 'completed' && state.result) {
      pushLog('info', 'Extraction complete');
      const execOptions = lastExecOptionsRef.current;
      if (execOptions) onComplete?.(state.result, execOptions);
      setTimeout(() => exit(), 30);
    }
  }, [state.status, state.result, pushLog, onComplete, exit]);

  const view: WizardViewModel = useMemo(() => buildWizardViewModel(state), [state]);

  const statusMessage: StatusMessage | null = useMemo(() => {
    if (state.status === 'analyzing' || state.status === 'executing') {
      return {
        kind: 'busy',
        text:
          state.statusNote ?? (state.status === 'analyzing' ? 'Analyzing project…' : 'Extracting…'),
        spinner: spinnerFrame,
      };
    }
    return null;
  }, [spinnerFrame, state.status, state.statusNote]);

  const actionHints: KeyHint[] = useMemo(
    () => buildActionHints({ state, view, logsVisible }),
    [state, view, logsVisible],
  );

  const plan = state.plan;
  const stepConfig = STEP_CONFIG[state.step];
  const stepIndex = view.stepIndex;
  const stepCount = view.stepCount;
  const reviewSummary = view.reviewSummary;
  const metadataError = view.metadataError;
  const actionWarning = view.actionWarning;

  primaryDisabledRef.current = view.primaryDisabled;

  const handleExecute = useCallback(async () => {
    if (!state.plan) return;
    if (view.visibleArtifactCount === 0) return;
    if (view.metadataError) {
      actions.setStep('metadata');
      actions.setMetadataFocus(0);
      return;
    }
    actions.setStatus('executing', 'Extracting…');
    actions.setError(null);
    pushLog('info', 'Starting extraction');
    const execOptions: ExecuteOptions = {
      ...state.options,
      includedArtifacts: computeIncludedArtifacts(state.plan, state.selections, state.options),
      includedMcpServers: Array.from(state.selections.mcpServers),
      includedSubagentFiles: Array.from(state.selections.subagents),
    };
    lastExecOptionsRef.current = execOptions;
    try {
      const execResult = await execute(state.plan, execOptions);
      actions.setResult(execResult);
      actions.setStatus('completed', null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      actions.setStatus('error', null);
      actions.setError(message);
      pushLog('error', message);
      if (logger.isVerbose && logger.isVerbose()) {
        if (error instanceof Error) logger.error(error.stack ?? message);
      }
    }
  }, [
    actions,
    execute,
    logger,
    pushLog,
    state.options,
    state.plan,
    state.selections,
    view.metadataError,
    view.visibleArtifactCount,
  ]);

  handleExecuteRef.current = handleExecute;

  const attemptForward = useCallback(() => {
    if (state.status === 'executing' || state.status === 'analyzing') return;
    if (state.step === 'metadata') {
      if (state.metadataFocus === 0) {
        actions.setMetadataFocus(1);
        return;
      }
      if (view.metadataError) return;
    }
    if (state.step === 'artifacts' && view.visibleArtifactCount === 0) return;
    if (state.step === 'preview') {
      if (view.primaryDisabled) return;
      void handleExecuteRef.current?.();
      return;
    }
    actions.nextStep();
  }, [
    actions,
    state.metadataFocus,
    state.status,
    state.step,
    view.metadataError,
    view.primaryDisabled,
    view.visibleArtifactCount,
  ]);

  attemptForwardRef.current = attemptForward;

  const attemptBackward = useCallback(() => {
    if (state.step === 'metadata' && state.metadataFocus === 1) {
      actions.setMetadataFocus(0);
      return;
    }
    actions.prevStep();
  }, [actions, state.metadataFocus, state.step]);

  const artifactItems = view.artifactItems;
  const subagentItems = view.subagentItems;
  const mcpItems = view.mcpItems;
  const optionItems: OptionListItem[] = view.optionItems;

  const {
    artifacts: artifactCursor,
    subagents: subagentCursor,
    mcp: mcpCursor,
    options: optionsCursor,
  } = state.cursors;

  const toggleArtifact = useCallback((id: string) => actions.toggleArtifact(id), [actions]);
  const selectAllArtifacts = useCallback(() => actions.selectAllArtifacts(), [actions]);
  const clearArtifacts = useCallback(() => actions.clearArtifacts(), [actions]);

  const toggleSubagent = useCallback((id: string) => actions.toggleSubagent(id), [actions]);
  const selectAllSubagents = useCallback(() => actions.selectAllSubagents(), [actions]);
  const clearSubagents = useCallback(() => actions.clearSubagents(), [actions]);

  const toggleMcp = useCallback((id: string) => actions.toggleMcpServer(id), [actions]);
  const selectAllMcp = useCallback(() => actions.selectAllMcpServers(), [actions]);
  const clearMcp = useCallback(() => actions.clearMcpServers(), [actions]);

  const handleOptionToggle = useCallback(
    (id: OptionToggleId) => {
      const config = OPTION_TOGGLE_CONFIG.find((entry) => entry.id === id);
      const toggledValue = !Boolean(state.options[id as keyof ExtractOptions]);
      const changes = { [id]: toggledValue } as Partial<ExtractOptions>;
      const nextOptions = { ...state.options, ...changes };
      actions.updateOptions(changes);
      if (config?.requiresReanalysis) {
        void runAnalysis(nextOptions, true, 'Re-analyzing project…');
      }
    },
    [actions, runAnalysis, state.options],
  );

  useInput((input, key) => {
    const lower = input.toLowerCase();

    if (key.ctrl && lower === 'c') {
      const now = Date.now();
      if (ctrlCRef.current && now - ctrlCRef.current.timestamp < 1500) {
        if (ctrlCRef.current.timeout) clearTimeout(ctrlCRef.current.timeout);
        ctrlCRef.current = null;
        onCancel?.();
        exit();
        return;
      }
      if (ctrlCRef.current?.timeout) clearTimeout(ctrlCRef.current.timeout);
      const timeout = setTimeout(() => {
        if (ctrlCRef.current && Date.now() - ctrlCRef.current.timestamp >= 1500) {
          actions.setStatusNote(ctrlCRef.current.prevMessage ?? null);
          ctrlCRef.current = null;
        }
      }, 1500);
      ctrlCRef.current = {
        timestamp: now,
        prevMessage: state.statusNote,
        timeout,
      };
      actions.setStatusNote('Press Ctrl+C again to exit');
      pushLog('warn', 'Press Ctrl+C again to exit');
      return;
    }

    if (state.status === 'executing' || state.status === 'analyzing') {
      if (key.escape) {
        onCancel?.();
        exit();
      }
      return;
    }

    if (key.return) {
      const disabled = primaryDisabledRef.current;
      if (state.step === 'preview') {
        if (!disabled) void handleExecuteRef.current?.();
        return;
      }
      if (!disabled) attemptForwardRef.current?.();
      return;
    }

    if (key.tab) {
      const isShiftTab = key.shift ?? false;
      const isMetadataAdvance =
        !isShiftTab && state.step === 'metadata' && state.metadataFocus === 0;
      if (isMetadataAdvance) {
        actions.setMetadataFocus(1);
        return;
      }
      if (tabPendingRef.current) return;
      tabPendingRef.current = true;
      setTimeout(() => {
        tabPendingRef.current = false;
        if (isShiftTab) attemptBackward();
        else attemptForwardRef.current?.();
      }, 0);
      return;
    }

    if (lower === 'v') {
      setLogsVisible((prev) => !prev);
      return;
    }

    switch (state.step) {
      case 'artifacts': {
        if (key.upArrow) {
          actions.setCursor('artifacts', artifactCursor - 1);
          return;
        }
        if (key.downArrow) {
          actions.setCursor('artifacts', artifactCursor + 1);
          return;
        }
        if (input === ' ') {
          const active = artifactItems[artifactCursor];
          if (active) toggleArtifact(active.id);
          return;
        }
        if (lower === 'a') {
          selectAllArtifacts();
          return;
        }
        if (lower === 'n') {
          clearArtifacts();
          return;
        }
        break;
      }
      case 'subagents': {
        if (key.upArrow) {
          actions.setCursor('subagents', subagentCursor - 1);
          return;
        }
        if (key.downArrow) {
          actions.setCursor('subagents', subagentCursor + 1);
          return;
        }
        if (input === ' ') {
          const active = subagentItems[subagentCursor];
          if (active) toggleSubagent(active.id);
          return;
        }
        if (lower === 'a') {
          selectAllSubagents();
          return;
        }
        if (lower === 'n') {
          clearSubagents();
          return;
        }
        break;
      }
      case 'mcp': {
        if (key.upArrow) {
          actions.setCursor('mcp', mcpCursor - 1);
          return;
        }
        if (key.downArrow) {
          actions.setCursor('mcp', mcpCursor + 1);
          return;
        }
        if (input === ' ') {
          const active = mcpItems[mcpCursor];
          if (active) toggleMcp(active.id);
          return;
        }
        if (lower === 'a') {
          selectAllMcp();
          return;
        }
        if (lower === 'n') {
          clearMcp();
          return;
        }
        break;
      }
      case 'metadata': {
        if (key.upArrow || key.downArrow) {
          actions.setMetadataFocus(state.metadataFocus === 0 ? 1 : 0);
        }
        break;
      }
      case 'options': {
        if (key.upArrow) {
          actions.setCursor('options', optionsCursor - 1);
          return;
        }
        if (key.downArrow) {
          actions.setCursor('options', optionsCursor + 1);
          return;
        }
        if (input === ' ') {
          const active = optionItems[optionsCursor];
          if (active) handleOptionToggle(active.id);
          return;
        }
        break;
      }
      default:
        break;
    }
  });

  if (state.status === 'completed' && state.result) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="green" bold>
          Extraction complete
        </Text>
        <Text>Outputs written: {state.result.summary.outputs.length}</Text>
        <Text dimColor>Press any key to exit.</Text>
      </Box>
    );
  }

  if (state.status === 'error' && state.errorMessage) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red" bold>
          Extraction failed
        </Text>
        <Text>{state.errorMessage}</Text>
        <Text dimColor>Press Esc to exit.</Text>
      </Box>
    );
  }

  if (!plan) {
    return (
      <WizardFrame
        heading={{ task: TASK_NAME, stepIndex: 0, stepCount: 1, title: 'Preparing plan' }}
        instruction="Scanning project for extractable artifacts."
        actionHints={[{ key: 'Esc', label: 'Cancel' }]}
        status={statusMessage}
      >
        <Text>Gathering project context…</Text>
      </WizardFrame>
    );
  }

  const renderBody = (): React.ReactElement => {
    switch (state.step) {
      case 'artifacts':
        return (
          <Box flexDirection="column" gap={1}>
            <SelectableList
              items={artifactItems}
              activeIndex={artifactCursor}
              emptyMessage="No artifacts detected"
            />
            <Text dimColor>
              {view.visibleArtifactCount}/{view.artifactTotalCount} selected
            </Text>
          </Box>
        );
      case 'subagents':
        return (
          <Box flexDirection="column" gap={1}>
            <SelectableList
              items={subagentItems}
              activeIndex={subagentCursor}
              emptyMessage="No Claude agent files detected"
            />
            <Text dimColor>
              {view.selectedSubagentCount}/{view.subagentTotalCount} selected
            </Text>
          </Box>
        );
      case 'mcp':
        return (
          <Box flexDirection="column" gap={1}>
            <SelectableList
              items={mcpItems}
              activeIndex={mcpCursor}
              emptyMessage="No MCP servers detected"
            />
            <Text dimColor>
              {view.selectedMcpCount}/{view.mcpTotalCount} selected
            </Text>
          </Box>
        );
      case 'output':
        return (
          <Box flexDirection="column" gap={1}>
            <Text>Package directory:</Text>
            <TextInput
              value={state.options.out}
              onChange={(value) => actions.updateOptions({ out: value })}
              highlightPastedText
            />
            <Text dimColor>
              Ensure the directory is empty or enable force overwrite in options.
            </Text>
          </Box>
        );
      case 'metadata':
        return (
          <Box flexDirection="column" gap={1}>
            <Box flexDirection="column">
              <Text>Package name:</Text>
              <TextInput
                value={state.options.name}
                focus={state.metadataFocus === 0}
                onChange={(value) => actions.updateOptions({ name: value })}
              />
              <Text dimColor>Must be a valid scoped package name (@owner/package-name).</Text>
            </Box>
            <Box flexDirection="column">
              <Text>Version (semver):</Text>
              <TextInput
                value={state.options.version}
                focus={state.metadataFocus === 1}
                onChange={(value) => actions.updateOptions({ version: value })}
              />
              <Text dimColor>Use semantic versioning, e.g., 0.0.0.</Text>
              {metadataError ? <Text color="red">⚠ {metadataError}</Text> : null}
            </Box>
          </Box>
        );
      case 'options':
        return (
          <SelectableList
            items={optionItems as SelectableListItem[]}
            activeIndex={optionsCursor}
            emptyMessage="No options available"
          />
        );
      case 'preview':
      default:
        if (!reviewSummary) {
          return <Text dimColor>No selections available.</Text>;
        }
        return (
          <Box flexDirection="column" gap={1}>
            {reviewSummary.sections.map((section) => (
              <Box key={section.id} flexDirection="column">
                <Text bold>
                  {section.title} • {section.selectedCount}/
                  {section.totalCount || section.selectedCount} selected
                </Text>
                {section.items.length > 0 ? (
                  section.items.map((item) => (
                    <Text key={item.id}>
                      ✓ {item.primary}
                      {item.secondary ? ` (${item.secondary})` : ''}
                    </Text>
                  ))
                ) : (
                  <Text dimColor>{section.emptyLabel}</Text>
                )}
              </Box>
            ))}
            <Box flexDirection="column">
              <Text bold>Destination</Text>
              <Text>{reviewSummary.destination.path}</Text>
              <Text>
                {reviewSummary.destination.packageName}@{reviewSummary.destination.version}
                {reviewSummary.destination.dryRun ? ' • dry run' : ''}
              </Text>
              {reviewSummary.destination.force ? (
                <Text dimColor>Force overwrite enabled</Text>
              ) : null}
            </Box>
            {reviewSummary.codexConfigIncluded ? (
              <Box flexDirection="column">
                <Text>○ Include ~/.codex/config.toml</Text>
                <Text dimColor> Adds user-specific Codex configuration to the bundle.</Text>
              </Box>
            ) : null}
          </Box>
        );
    }
  };

  return (
    <Box flexDirection="column" gap={1}>
      <WizardFrame
        heading={{ task: TASK_NAME, stepIndex, stepCount, title: stepConfig.title }}
        instruction={stepConfig.instruction}
        warning={actionWarning}
        actionHints={actionHints}
        status={statusMessage}
      >
        {renderBody()}
      </WizardFrame>
      <LogPanel entries={logs} visible={logsVisible} />
    </Box>
  );
}
