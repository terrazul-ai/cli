import path from 'node:path';

import { Box, Text, useApp, useInput } from 'ink';
import TextInput from 'ink-text-input';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import semver from 'semver';

import {
  type ExecuteOptions,
  type ExtractOptions,
  type ExtractPlan,
  type ExtractResult,
  getPlanSubagentIds,
  getSubagentIdFromSourcePath,
  getSubagentIdFromTemplatePath,
  type LoggerLike,
} from '../../core/extract/orchestrator.js';
import { parseSafePackageName } from '../../utils/path.js';
import {
  type KeyHint,
  type LogEntry,
  LogPanel,
  SelectableList,
  type SelectableListItem,
  type StatusMessage,
  WizardFrame,
} from './components.js';
import { buildReviewSummary, getArtifactLabel, type ReviewSummary } from './summary.js';

const TASK_NAME = 'Extract';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];
const SPINNER_INTERVAL = 96;

const CLAUDE_SUBAGENT_ARTIFACT_ID = 'claude.subagents';

type StepId = 'artifacts' | 'subagents' | 'mcp' | 'output' | 'metadata' | 'options' | 'preview';

type OptionToggleId = 'includeClaudeLocal' | 'includeClaudeUser' | 'dryRun' | 'force';

interface OptionToggleConfig {
  id: OptionToggleId;
  label: string;
  detail: string;
  requiresReanalysis?: boolean;
}

const OPTION_TOGGLE_CONFIG: OptionToggleConfig[] = [
  {
    id: 'includeClaudeLocal',
    label: 'Include .claude/settings.local.json',
    detail: 'Adds user-specific Claude configuration to the bundle.',
    requiresReanalysis: true,
  },
  {
    id: 'includeClaudeUser',
    label: 'Include Claude user settings',
    detail: 'Copies user-scoped Claude settings alongside package assets.',
    requiresReanalysis: true,
  },
  {
    id: 'dryRun',
    label: 'Dry run',
    detail: 'Preview actions without writing to disk.',
  },
  {
    id: 'force',
    label: 'Force overwrite',
    detail: 'Overwrite non-empty directories in the destination.',
  },
];

type Status = 'idle' | 'analyzing' | 'executing' | 'completed' | 'error';

interface StepConfig {
  title: string;
  instruction: string;
  primaryLabel: string;
}

const STEP_CONFIG: Record<StepId, StepConfig> = {
  artifacts: {
    title: 'Select Artifacts',
    instruction: 'Choose which detected artifacts to include. Use ↑/↓ to move, Space to toggle.',
    primaryLabel: 'Continue',
  },
  subagents: {
    title: 'Select Claude Agent Files',
    instruction: 'Toggle Claude agent files from .claude/agents to include in the package.',
    primaryLabel: 'Continue',
  },
  mcp: {
    title: 'Select MCP Servers',
    instruction: 'Choose MCP servers to bundle with this extract.',
    primaryLabel: 'Continue',
  },
  output: {
    title: 'Choose Output Directory',
    instruction: 'Confirm or update the destination directory for the extracted package.',
    primaryLabel: 'Continue',
  },
  metadata: {
    title: 'Confirm Package Metadata',
    instruction: 'Review and update the package name and version before continuing.',
    primaryLabel: 'Continue',
  },
  options: {
    title: 'Toggle Options',
    instruction: 'Enable optional behaviors for this run. Use ↑/↓ to move, Space to toggle.',
    primaryLabel: 'Continue',
  },
  preview: {
    title: 'Review & Extract',
    instruction: 'Double-check selections before extracting the package.',
    primaryLabel: 'Extract package',
  },
};

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

function computeStepOrder(plan: ExtractPlan | null): StepId[] {
  const order: StepId[] = ['artifacts'];
  if (plan && getPlanSubagentIds(plan).length > 0) order.push('subagents');
  if (plan && plan.mcpServers.length > 0) order.push('mcp');
  order.push('output', 'metadata', 'options', 'preview');
  return order;
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
  const [plan, setPlan] = useState<ExtractPlan | null>(null);
  const [options, setOptions] = useState<ExtractOptions>({ ...baseOptions });
  const [currentStep, setCurrentStep] = useState<StepId>('artifacts');
  const [status, setStatus] = useState<Status>(initialPlan ? 'idle' : 'analyzing');
  const [statusNote, setStatusNote] = useState<string | null>(
    initialPlan ? null : 'Analyzing project…',
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [result, setResult] = useState<ExtractResult | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsVisible, setLogsVisible] = useState(false);

  const [artifactCursor, setArtifactCursor] = useState(0);
  const [selectedArtifacts, setSelectedArtifacts] = useState<Set<string>>(new Set());
  const [subagentCursor, setSubagentCursor] = useState(0);
  const [selectedSubagents, setSelectedSubagents] = useState<Set<string>>(new Set());
  const [mcpCursor, setMcpCursor] = useState(0);
  const [selectedMcp, setSelectedMcp] = useState<Set<string>>(new Set());
  const [optionsCursor, setOptionsCursor] = useState(0);

  const [metadataFocus, setMetadataFocus] = useState<0 | 1>(0);
  const [metadataError, setMetadataError] = useState<string | null>(null);

  const spinnerFrame = useSpinner(status === 'analyzing' || status === 'executing');

  const analysisTokenRef = useRef(0);
  const initializedRef = useRef(false);
  const lastArtifactIdsRef = useRef<Set<string>>(new Set());
  const lastSubagentIdsRef = useRef<Set<string>>(new Set());
  const lastMcpIdsRef = useRef<Set<string>>(new Set());
  const ctrlCRef = useRef<{
    timestamp: number;
    prevMessage: string | null;
    timeout?: ReturnType<typeof setTimeout>;
  } | null>(null);
  const lastExecOptionsRef = useRef<ExecuteOptions | null>(null);

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

  const stepOrder = useMemo(() => computeStepOrder(plan), [plan]);

  const validateMetadata = useCallback((): string | null => {
    try {
      parseSafePackageName(options.name.trim());
    } catch (error) {
      return error instanceof Error ? error.message : String(error);
    }
    if (!semver.valid(options.version.trim())) {
      return 'Version must be valid semver (e.g., 0.0.0)';
    }
    return null;
  }, [options.name, options.version]);

  useEffect(() => {
    setMetadataError(validateMetadata());
  }, [validateMetadata]);

  const previousStepRef = useRef<StepId>(currentStep);
  useEffect(() => {
    if (previousStepRef.current !== currentStep) {
      previousStepRef.current = currentStep;
    }
  }, [currentStep]);

  useEffect(() => {
    if (stepOrder.length === 0) return;
    if (!stepOrder.includes(currentStep)) {
      setCurrentStep(stepOrder[0]);
    }
  }, [stepOrder, currentStep]);

  const applyPlan = useCallback((nextPlan: ExtractPlan, preferExistingSelections: boolean) => {
    setPlan(nextPlan);
    setSelectedArtifacts((prev) => {
      const available = Object.keys(nextPlan.detected);
      if (available.length === 0) return new Set();
      if (preferExistingSelections && prev.size > 0) {
        const prevDetected = lastArtifactIdsRef.current;
        const next = new Set<string>();
        for (const id of available) {
          if (prev.has(id) || !prevDetected.has(id)) next.add(id);
        }
        if (next.size > 0) return next;
      }
      return new Set(available);
    });
    const visibleArtifacts = Object.keys(nextPlan.detected).filter(
      (id) => id !== CLAUDE_SUBAGENT_ARTIFACT_ID,
    );
    setArtifactCursor((prev) => {
      const maxIndex = Math.max(visibleArtifacts.length - 1, 0);
      return Math.min(prev, maxIndex);
    });
    const availableSubagents = getPlanSubagentIds(nextPlan);
    setSelectedSubagents((prev) => {
      if (availableSubagents.length === 0) return new Set();
      if (preferExistingSelections && prev.size > 0) {
        const prevDetected = lastSubagentIdsRef.current;
        const next = new Set<string>();
        for (const id of availableSubagents) {
          if (prev.has(id) || !prevDetected.has(id)) next.add(id);
        }
        if (next.size > 0) return next;
      }
      return new Set(availableSubagents);
    });
    setSubagentCursor((prev) => {
      const maxIndex = Math.max(availableSubagents.length - 1, 0);
      return Math.min(prev, maxIndex);
    });
    setSelectedMcp((prev) => {
      const available = nextPlan.mcpServers.map((s: { id: string }) => s.id);
      if (available.length === 0) return new Set();
      if (preferExistingSelections && prev.size > 0) {
        const prevMcp = lastMcpIdsRef.current;
        const next = new Set<string>();
        for (const id of available) {
          if (prev.has(id) || !prevMcp.has(id)) next.add(id);
        }
        if (next.size > 0) return next;
      }
      return new Set(available);
    });
    setMcpCursor((prev) => {
      const maxIndex = Math.max(nextPlan.mcpServers.length - 1, 0);
      return Math.min(prev, maxIndex);
    });
    lastArtifactIdsRef.current = new Set(Object.keys(nextPlan.detected));
    lastSubagentIdsRef.current = new Set(availableSubagents);
    lastMcpIdsRef.current = new Set(nextPlan.mcpServers.map((s) => s.id));
  }, []);

  const runAnalysis = useCallback(
    async (nextOptions: ExtractOptions, preferExistingSelections: boolean, reason?: string) => {
      const token = ++analysisTokenRef.current;
      setStatus('analyzing');
      setStatusNote(reason ?? 'Analyzing project…');
      setErrorMessage(null);
      pushLog('info', reason ?? 'Analyzing extract plan');
      try {
        const nextPlan = await analyze(nextOptions);
        if (analysisTokenRef.current !== token) return;
        applyPlan(nextPlan, preferExistingSelections);
        setStatus('idle');
        setStatusNote(null);
      } catch (error) {
        if (analysisTokenRef.current !== token) return;
        const message = error instanceof Error ? error.message : String(error);
        setStatus('error');
        setErrorMessage(message);
        pushLog('error', message);
        if (logger.isVerbose && logger.isVerbose()) {
          if (error instanceof Error) logger.error(error.stack ?? message);
        }
      }
    },
    [analyze, applyPlan, pushLog, logger],
  );

  useEffect(() => {
    if (initializedRef.current) return;
    initializedRef.current = true;
    if (initialPlan) {
      applyPlan(initialPlan, false);
      setStatus('idle');
      setStatusNote(null);
      return;
    }
    void runAnalysis({ ...baseOptions }, false, 'Analyzing project…');
  }, [initialPlan, baseOptions, applyPlan, runAnalysis]);

  useEffect(() => {
    if (status === 'completed' && result) {
      pushLog('info', 'Extraction complete');
      const execOptions = lastExecOptionsRef.current;
      if (execOptions) onComplete?.(result, execOptions);
      setTimeout(() => exit(), 30);
    }
  }, [status, result, pushLog, onComplete, exit]);

  useEffect(() => {
    if (!plan) return;
    setSelectedArtifacts((prev) => {
      const has = prev.has(CLAUDE_SUBAGENT_ARTIFACT_ID);
      if (selectedSubagents.size > 0) {
        if (has) return prev;
        const next = new Set(prev);
        next.add(CLAUDE_SUBAGENT_ARTIFACT_ID);
        return next;
      }
      if (!has) return prev;
      const next = new Set(prev);
      next.delete(CLAUDE_SUBAGENT_ARTIFACT_ID);
      return next;
    });
  }, [plan, selectedSubagents]);

  const artifactItems: SelectableListItem[] = useMemo(() => {
    if (!plan) return [];
    return Object.keys(plan.detected)
      .filter((id) => id !== CLAUDE_SUBAGENT_ARTIFACT_ID)
      .map((id) => ({
        id,
        label: getArtifactLabel(id),
        detail: Array.isArray(plan.detected[id])
          ? plan.detected[id].join(', ')
          : (plan.detected[id] ?? undefined),
        selected: selectedArtifacts.has(id),
      }));
  }, [plan, selectedArtifacts]);

  const subagentItems: SelectableListItem[] = useMemo(() => {
    if (!plan) return [];
    const detailMap = new Map<string, string>();
    const detected = plan.detected[CLAUDE_SUBAGENT_ARTIFACT_ID];
    if (Array.isArray(detected)) {
      for (const abs of detected) {
        const id = getSubagentIdFromSourcePath(abs);
        const rel = path.relative(plan.projectRoot, abs).split(path.sep).join('/');
        detailMap.set(id, rel);
      }
    }
    const outputs = plan.outputs.filter(
      (output) => output.artifactId === CLAUDE_SUBAGENT_ARTIFACT_ID,
    );
    if (outputs.length > 0) {
      const items: SelectableListItem[] = [];
      for (const output of outputs) {
        const id = getSubagentIdFromTemplatePath(output.relativePath);
        if (!id) continue;
        items.push({
          id,
          label: id,
          detail: detailMap.get(id),
          selected: selectedSubagents.has(id),
        });
      }
      return items;
    }
    return Array.from(detailMap.entries()).map(([id, rel]) => ({
      id,
      label: id,
      detail: rel,
      selected: selectedSubagents.has(id),
    }));
  }, [plan, selectedSubagents]);

  const mcpItems: SelectableListItem[] = useMemo(() => {
    if (!plan) return [];
    return plan.mcpServers.map(
      (server: {
        id: string;
        source: string;
        name: string;
        definition: { command: string; args: string[] };
      }) => ({
        id: server.id,
        label: `${server.source.toUpperCase()} • ${server.name}`,
        detail: `${server.definition.command} ${server.definition.args.join(' ')}`.trim(),
        selected: selectedMcp.has(server.id),
      }),
    );
  }, [plan, selectedMcp]);

  const optionItems: (SelectableListItem & { id: OptionToggleId })[] = useMemo(() => {
    return OPTION_TOGGLE_CONFIG.map((config) => ({
      id: config.id,
      label: config.label,
      detail: config.detail,
      selected:
        config.id === 'includeClaudeLocal'
          ? Boolean(options.includeClaudeLocal)
          : config.id === 'includeClaudeUser'
            ? Boolean(options.includeClaudeUser)
            : config.id === 'dryRun'
              ? Boolean(options.dryRun)
              : Boolean(options.force),
    }));
  }, [options.dryRun, options.force, options.includeClaudeLocal, options.includeClaudeUser]);

  const goNextStep = useCallback(() => {
    const idx = stepOrder.indexOf(currentStep);
    if (idx === -1) {
      setCurrentStep(stepOrder[0]);
      return;
    }
    const nextIdx = Math.min(idx + 1, stepOrder.length - 1);
    setCurrentStep(stepOrder[nextIdx]);
  }, [currentStep, stepOrder]);

  useEffect(() => {
    setOptionsCursor((prev) => Math.min(prev, Math.max(optionItems.length - 1, 0)));
  }, [optionItems.length]);

  const goPrevStep = useCallback(() => {
    const idx = stepOrder.indexOf(currentStep);
    if (idx === -1) {
      setCurrentStep(stepOrder[0]);
      return;
    }
    const prevIdx = Math.max(idx - 1, 0);
    setCurrentStep(stepOrder[prevIdx]);
  }, [currentStep, stepOrder]);

  const attemptForward = useCallback(() => {
    if (status === 'executing' || status === 'analyzing') return;
    if (currentStep === 'metadata') {
      if (metadataFocus === 0) {
        setMetadataFocus(1);
        return;
      }
      if (metadataError) return;
    }
    if (currentStep === 'artifacts' && selectedArtifacts.size === 0) return;
    if (currentStep === 'preview') {
      if (selectedArtifacts.size === 0 || metadataError) return;
      void (async () => {
        await handleExecute();
      })();
      return;
    }
    lastTabStepRef.current = currentStep;
    goNextStep();
  }, [currentStep, goNextStep, metadataFocus, metadataError, selectedArtifacts.size, status]);

  const attemptBackward = useCallback(() => {
    if (currentStep === 'metadata' && metadataFocus === 1) {
      setMetadataFocus(0);
      return;
    }
    lastTabStepRef.current = currentStep;
    goPrevStep();
  }, [currentStep, goPrevStep, metadataFocus]);

  const handleExecute = useCallback(async () => {
    if (!plan) return;
    if (selectedArtifacts.size === 0) return;
    if (metadataError) {
      setCurrentStep('metadata');
      return;
    }
    setStatus('executing');
    setStatusNote('Extracting…');
    setErrorMessage(null);
    pushLog('info', 'Starting extraction');
    const execOptions: ExecuteOptions = {
      ...options,
      includedArtifacts: Array.from(selectedArtifacts),
      includedMcpServers: Array.from(selectedMcp),
      includedSubagentFiles: Array.from(selectedSubagents),
    };
    lastExecOptionsRef.current = execOptions;
    try {
      const execResult = await execute(plan, execOptions);
      setResult(execResult);
      setStatus('completed');
      setStatusNote(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setStatus('error');
      setErrorMessage(message);
      pushLog('error', message);
      if (logger.isVerbose && logger.isVerbose()) {
        if (error instanceof Error) logger.error(error.stack ?? message);
      }
    }
  }, [
    plan,
    selectedArtifacts,
    selectedMcp,
    selectedSubagents,
    options,
    metadataError,
    execute,
    pushLog,
    logger,
  ]);

  const toggleArtifact = useCallback((id: string) => {
    setSelectedArtifacts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleMcp = useCallback((id: string) => {
    setSelectedMcp((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const toggleOption = useCallback(
    (id: OptionToggleId) => {
      switch (id) {
        case 'includeClaudeLocal': {
          setOptions((prev) => {
            const next = { ...prev, includeClaudeLocal: !prev.includeClaudeLocal };
            void runAnalysis(next, true, 'Re-analyzing project…');
            return next;
          });
          break;
        }
        case 'includeClaudeUser': {
          setOptions((prev) => {
            const next = { ...prev, includeClaudeUser: !prev.includeClaudeUser };
            void runAnalysis(next, true, 'Re-analyzing project…');
            return next;
          });
          break;
        }
        case 'dryRun': {
          setOptions((prev) => ({ ...prev, dryRun: !prev.dryRun }));
          break;
        }
        case 'force': {
          setOptions((prev) => ({ ...prev, force: !prev.force }));
          break;
        }
        default:
          break;
      }
    },
    [runAnalysis],
  );

  const selectAllArtifacts = useCallback(() => {
    if (!plan) return;
    setSelectedArtifacts(new Set(Object.keys(plan.detected)));
    const available = getPlanSubagentIds(plan);
    if (available.length > 0) {
      setSelectedSubagents(new Set(available));
    }
  }, [plan]);

  const clearArtifacts = useCallback(() => {
    setSelectedArtifacts(new Set());
    setSelectedSubagents(new Set());
  }, []);

  const toggleSubagent = useCallback((id: string) => {
    setSelectedSubagents((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const selectAllSubagents = useCallback(() => {
    if (!plan) return;
    setSelectedSubagents(new Set(getPlanSubagentIds(plan)));
  }, [plan]);

  const clearSubagents = useCallback(() => {
    setSelectedSubagents(new Set());
  }, []);

  const selectAllMcp = useCallback(() => {
    if (!plan) return;
    setSelectedMcp(new Set(plan.mcpServers.map((s: { id: string }) => s.id)));
  }, [plan]);

  const clearMcp = useCallback(() => {
    setSelectedMcp(new Set());
  }, []);

  const lastTabStepRef = useRef<StepId | null>(null);
  const tabPendingRef = useRef(false);

  const reviewSummary: ReviewSummary | null = useMemo(() => {
    if (!plan) return null;
    return buildReviewSummary({
      plan,
      selectedArtifacts,
      selectedMcp,
      options,
    });
  }, [plan, selectedArtifacts, selectedMcp, options]);

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
          setStatusNote(ctrlCRef.current.prevMessage ?? null);
          ctrlCRef.current = null;
        }
      }, 1500);
      ctrlCRef.current = {
        timestamp: now,
        prevMessage: statusNote,
        timeout,
      };
      setStatusNote('Press Ctrl+C again to exit');
      pushLog('warn', 'Press Ctrl+C again to exit');
      return;
    }

    if (status === 'executing' || status === 'analyzing') {
      if (key.escape) {
        onCancel?.();
        exit();
      }
      return;
    }

    if (key.return) {
      const disabled = primaryDisabledRef.current;
      if (currentStep === 'preview') {
        if (!disabled) void handleExecuteRef.current?.();
        return;
      }
      if (!disabled) attemptForwardRef.current?.();
      return;
    }

    if (key.tab) {
      const isShiftTab = key.shift ?? false;
      const isMetadataFocusAdvance =
        !isShiftTab && currentStep === 'metadata' && metadataFocus === 0;
      if (isMetadataFocusAdvance) {
        setMetadataFocus(1);
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

    switch (currentStep) {
      case 'artifacts': {
        if (key.upArrow) {
          setArtifactCursor((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (key.downArrow) {
          setArtifactCursor((prev) => Math.min(prev + 1, Math.max(artifactItems.length - 1, 0)));
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
          setSubagentCursor((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (key.downArrow) {
          setSubagentCursor((prev) => Math.min(prev + 1, Math.max(subagentItems.length - 1, 0)));
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
          setMcpCursor((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (key.downArrow) {
          setMcpCursor((prev) => Math.min(prev + 1, Math.max(mcpItems.length - 1, 0)));
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
          setMetadataFocus((prev) => (prev === 0 ? 1 : 0));
        }
        break;
      }
      case 'options': {
        if (key.upArrow) {
          setOptionsCursor((prev) => Math.max(prev - 1, 0));
          return;
        }
        if (key.downArrow) {
          setOptionsCursor((prev) => Math.min(prev + 1, Math.max(optionItems.length - 1, 0)));
          return;
        }
        if (input === ' ') {
          const active = optionItems[optionsCursor];
          if (active) toggleOption(active.id);
          return;
        }
        break;
      }
      case 'preview': {
        if (key.return) {
          return;
        }
        break;
      }
      default:
        break;
    }
  });

  useEffect(
    () => () => {
      if (ctrlCRef.current?.timeout) clearTimeout(ctrlCRef.current.timeout);
    },
    [],
  );

  const primaryDisabled = useMemo(() => {
    if (status === 'executing' || status === 'analyzing') return true;
    if (currentStep === 'artifacts') return selectedArtifacts.size === 0;
    if (currentStep === 'metadata') return Boolean(metadataError);
    if (currentStep === 'preview') return selectedArtifacts.size === 0 || Boolean(metadataError);
    return false;
  }, [currentStep, metadataError, selectedArtifacts.size, status]);

  const primaryDisabledRef = useRef(primaryDisabled);
  useEffect(() => {
    primaryDisabledRef.current = primaryDisabled;
  }, [primaryDisabled]);

  const attemptForwardRef = useRef(attemptForward);
  useEffect(() => {
    attemptForwardRef.current = attemptForward;
  }, [attemptForward]);

  const handleExecuteRef = useRef(handleExecute);
  useEffect(() => {
    handleExecuteRef.current = handleExecute;
  }, [handleExecute]);

  const actionWarning = useMemo(() => {
    if (currentStep === 'artifacts' && selectedArtifacts.size === 0)
      return 'Select at least one artifact to continue';
    if (currentStep === 'metadata' && metadataError) return metadataError;
    if (currentStep === 'preview' && selectedArtifacts.size === 0)
      return 'Select at least one artifact before extracting';
    return null;
  }, [currentStep, metadataError, selectedArtifacts.size]);

  const stepIndex = Math.max(stepOrder.indexOf(currentStep), 0);
  const stepCount = stepOrder.length || 1;
  const stepConfig = STEP_CONFIG[currentStep];

  const statusMessage: StatusMessage | null =
    status === 'analyzing' || status === 'executing'
      ? {
          kind: 'busy',
          text: statusNote ?? (status === 'analyzing' ? 'Analyzing project…' : 'Extracting…'),
          spinner: spinnerFrame,
        }
      : null;

  const actionHints: KeyHint[] = useMemo(() => {
    const hints: KeyHint[] = [];
    const primaryLabel = stepConfig.primaryLabel;
    hints.push({
      key: 'Enter',
      label: primaryLabel,
      emphasis: 'primary',
      disabled: primaryDisabled,
    });
    if (stepIndex > 0) {
      hints.push({ key: 'Shift+Tab', label: 'Back' });
    }
    if (currentStep === 'artifacts' || currentStep === 'mcp' || currentStep === 'options') {
      const total =
        currentStep === 'artifacts'
          ? artifactItems.length
          : currentStep === 'mcp'
            ? mcpItems.length
            : optionItems.length;
      const selected =
        currentStep === 'artifacts'
          ? selectedArtifacts.size
          : currentStep === 'mcp'
            ? selectedMcp.size
            : optionItems.filter((item) => item.selected).length;
      hints.push({ key: 'Space', label: 'Toggle', disabled: total === 0 });
      if (currentStep !== 'options') {
        hints.push({ key: 'A', label: 'Select all', disabled: total === 0 });
        hints.push({ key: 'N', label: 'Select none', disabled: selected === 0 });
      }
    }
    if (currentStep === 'metadata') {
      hints.push({ key: 'Tab', label: 'Next field' });
    }
    if (currentStep === 'preview') {
      hints.push({ key: 'C', label: 'Copy summary', hidden: !reviewSummary });
    }
    hints.push({ key: 'V', label: logsVisible ? 'Hide logs' : 'Show logs' });
    hints.push({ key: '?', label: 'Help' });
    return hints;
  }, [
    artifactItems.length,
    currentStep,
    logsVisible,
    metadataError,
    primaryDisabled,
    selectedArtifacts.size,
    selectedSubagents.size,
    selectedMcp.size,
    optionItems,
    optionItems.length,
    stepConfig.primaryLabel,
    stepIndex,
    mcpItems.length,
    subagentItems.length,
    reviewSummary,
  ]);

  if (status === 'completed' && result) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="green" bold>
          Extraction complete
        </Text>
        <Text>Outputs written: {result.summary.outputs.length}</Text>
        <Text dimColor>Press any key to exit.</Text>
      </Box>
    );
  }

  if (status === 'error' && errorMessage) {
    return (
      <Box flexDirection="column" gap={1}>
        <Text color="red" bold>
          Extraction failed
        </Text>
        <Text>{errorMessage}</Text>
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
    switch (currentStep) {
      case 'artifacts':
        return (
          <Box flexDirection="column" gap={1}>
            <SelectableList
              items={artifactItems}
              activeIndex={artifactCursor}
              emptyMessage="No artifacts detected"
            />
            <Text dimColor>
              {selectedArtifacts.size -
                (selectedArtifacts.has(CLAUDE_SUBAGENT_ARTIFACT_ID) ? 1 : 0)}
              /{artifactItems.length} selected
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
              {selectedSubagents.size}/{subagentItems.length} selected
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
              {selectedMcp.size}/{plan.mcpServers.length} selected
            </Text>
          </Box>
        );
      case 'output':
        return (
          <Box flexDirection="column" gap={1}>
            <Text>Package directory:</Text>
            <TextInput
              value={options.out}
              onChange={(value) => setOptions((prev: ExtractOptions) => ({ ...prev, out: value }))}
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
                value={options.name}
                focus={metadataFocus === 0}
                onChange={(value) =>
                  setOptions((prev: ExtractOptions) => ({ ...prev, name: value }))
                }
              />
              <Text dimColor>Must be a valid scoped or unscoped package name.</Text>
            </Box>
            <Box flexDirection="column">
              <Text>Version (semver):</Text>
              <TextInput
                value={options.version}
                focus={metadataFocus === 1}
                onChange={(value) =>
                  setOptions((prev: ExtractOptions) => ({ ...prev, version: value }))
                }
              />
              <Text dimColor>Use semantic versioning, e.g., 0.0.0.</Text>
              {metadataError ? <Text color="red">⚠ {metadataError}</Text> : null}
            </Box>
          </Box>
        );
      case 'options': {
        return (
          <SelectableList
            items={optionItems}
            activeIndex={optionsCursor}
            emptyMessage="No options available"
          />
        );
      }
      case 'preview':
      default: {
        if (!reviewSummary) {
          return <Text dimColor>No selections available.</Text>;
        }
        return (
          <Box flexDirection="column" gap={1}>
            {reviewSummary.sections.map(
              (section: {
                id: string;
                title: string;
                selectedCount: number;
                totalCount: number;
                items: Array<{ id: string; primary: string; secondary?: string }>;
                emptyLabel?: string;
              }) => (
                <Box key={section.id} flexDirection="column">
                  <Text bold>
                    {section.title} • {section.selectedCount}/
                    {section.totalCount || section.selectedCount} selected
                  </Text>
                  {section.items.length > 0 ? (
                    section.items.map(
                      (item: { id: string; primary: string; secondary?: string }) => (
                        <Text key={item.id}>
                          ✓ {item.primary}
                          {item.secondary ? ` (${item.secondary})` : ''}
                        </Text>
                      ),
                    )
                  ) : (
                    <Text dimColor>{section.emptyLabel}</Text>
                  )}
                </Box>
              ),
            )}
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
          </Box>
        );
      }
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
