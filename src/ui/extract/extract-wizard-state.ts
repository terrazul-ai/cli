import { useMemo, useReducer } from 'react';

import {
  computeStepOrder,
  HIDDEN_ARTIFACT_IDS,
  OPTION_TOGGLE_CONFIG,
  type OptionToggleId,
  type StepId,
} from './extract-wizard-config.js';
import {
  getPlanSubagentIds,
  type ExtractOptions,
  type ExtractPlan,
  type ExtractResult,
} from '../../core/extract/orchestrator.js';

export type WizardStatus = 'idle' | 'analyzing' | 'executing' | 'completed' | 'error';

export interface WizardSelections {
  artifacts: Set<string>;
  subagents: Set<string>;
  mcpServers: Set<string>;
}

export interface WizardCursors {
  artifacts: number;
  subagents: number;
  mcp: number;
  options: number;
}

export interface WizardAvailability {
  artifacts: string[];
  subagents: string[];
  mcpServers: string[];
}

export interface WizardState {
  status: WizardStatus;
  statusNote: string | null;
  errorMessage: string | null;
  result: ExtractResult | null;
  plan: ExtractPlan | null;
  options: ExtractOptions;
  step: StepId;
  stepOrder: StepId[];
  selections: WizardSelections;
  cursors: WizardCursors;
  metadataFocus: 0 | 1;
  availability: WizardAvailability;
}

interface ReducerState extends WizardState {
  prevVisibleArtifacts: Set<string>;
  prevSubagentIds: Set<string>;
  prevMcpIds: Set<string>;
}

type SelectionCollection = 'artifacts' | 'subagents' | 'mcpServers';
type CursorId = keyof WizardCursors;

interface ApplyPlanAction {
  type: 'APPLY_PLAN';
  plan: ExtractPlan;
  preferExistingSelections: boolean;
}

type WizardAction =
  | { type: 'SET_STATUS'; status: WizardStatus; note?: string | null }
  | { type: 'SET_STATUS_NOTE'; note: string | null }
  | { type: 'SET_ERROR'; error: string | null }
  | { type: 'SET_RESULT'; result: ExtractResult | null }
  | ApplyPlanAction
  | { type: 'TOGGLE_SELECTION'; collection: SelectionCollection; id: string }
  | { type: 'SELECT_ALL'; collection: SelectionCollection }
  | { type: 'CLEAR_SELECTIONS'; collection: SelectionCollection }
  | { type: 'SET_CURSOR'; cursor: CursorId; index: number }
  | { type: 'NEXT_STEP' }
  | { type: 'PREV_STEP' }
  | { type: 'SET_STEP'; step: StepId }
  | { type: 'SET_METADATA_FOCUS'; focus: 0 | 1 }
  | { type: 'UPDATE_OPTIONS'; changes: Partial<ExtractOptions> };

export interface UseExtractWizardStateInit {
  baseOptions: ExtractOptions;
  initialPlan?: ExtractPlan;
}

export interface WizardActions {
  setStatus: (status: WizardStatus, note?: string | null) => void;
  setStatusNote: (note: string | null) => void;
  setError: (message: string | null) => void;
  setResult: (result: ExtractResult | null) => void;
  applyPlan: (plan: ExtractPlan, preferExistingSelections: boolean) => void;
  toggleArtifact: (id: string) => void;
  selectAllArtifacts: () => void;
  clearArtifacts: () => void;
  toggleSubagent: (id: string) => void;
  selectAllSubagents: () => void;
  clearSubagents: () => void;
  toggleMcpServer: (id: string) => void;
  selectAllMcpServers: () => void;
  clearMcpServers: () => void;
  setCursor: (cursor: CursorId, index: number) => void;
  nextStep: () => void;
  prevStep: () => void;
  setStep: (step: StepId) => void;
  setMetadataFocus: (focus: 0 | 1) => void;
  updateOptions: (changes: Partial<ExtractOptions>) => void;
}

export interface UseExtractWizardStateReturn {
  state: WizardState;
  actions: WizardActions;
}

export function useExtractWizardState({
  baseOptions,
  initialPlan,
}: UseExtractWizardStateInit): UseExtractWizardStateReturn {
  const [state, dispatch] = useReducer(reducer, { baseOptions, initialPlan }, initializeState);

  const actions = useMemo<WizardActions>(
    () => ({
      setStatus: (status, note) => dispatch({ type: 'SET_STATUS', status, note }),
      setStatusNote: (note) => dispatch({ type: 'SET_STATUS_NOTE', note }),
      setError: (message) => dispatch({ type: 'SET_ERROR', error: message }),
      setResult: (result) => dispatch({ type: 'SET_RESULT', result }),
      applyPlan: (plan, preferExistingSelections) =>
        dispatch({ type: 'APPLY_PLAN', plan, preferExistingSelections }),
      toggleArtifact: (id) => dispatch({ type: 'TOGGLE_SELECTION', collection: 'artifacts', id }),
      selectAllArtifacts: () => dispatch({ type: 'SELECT_ALL', collection: 'artifacts' }),
      clearArtifacts: () => dispatch({ type: 'CLEAR_SELECTIONS', collection: 'artifacts' }),
      toggleSubagent: (id) => dispatch({ type: 'TOGGLE_SELECTION', collection: 'subagents', id }),
      selectAllSubagents: () => dispatch({ type: 'SELECT_ALL', collection: 'subagents' }),
      clearSubagents: () => dispatch({ type: 'CLEAR_SELECTIONS', collection: 'subagents' }),
      toggleMcpServer: (id) => dispatch({ type: 'TOGGLE_SELECTION', collection: 'mcpServers', id }),
      selectAllMcpServers: () => dispatch({ type: 'SELECT_ALL', collection: 'mcpServers' }),
      clearMcpServers: () => dispatch({ type: 'CLEAR_SELECTIONS', collection: 'mcpServers' }),
      setCursor: (cursor, index) => dispatch({ type: 'SET_CURSOR', cursor, index }),
      nextStep: () => dispatch({ type: 'NEXT_STEP' }),
      prevStep: () => dispatch({ type: 'PREV_STEP' }),
      setStep: (step) => dispatch({ type: 'SET_STEP', step }),
      setMetadataFocus: (focus) => dispatch({ type: 'SET_METADATA_FOCUS', focus }),
      updateOptions: (changes) => dispatch({ type: 'UPDATE_OPTIONS', changes }),
    }),
    [],
  );

  return useMemo(() => ({ state, actions }), [state, actions]);
}

interface InitializeArgs {
  baseOptions: ExtractOptions;
  initialPlan?: ExtractPlan;
}

function initializeState({ baseOptions, initialPlan }: InitializeArgs): ReducerState {
  const baseState: ReducerState = {
    status: initialPlan ? 'idle' : 'analyzing',
    statusNote: initialPlan ? null : 'Analyzing project…',
    errorMessage: null,
    result: null,
    plan: null,
    options: { ...baseOptions },
    step: 'artifacts',
    stepOrder: computeStepOrder(null),
    selections: {
      artifacts: new Set(),
      subagents: new Set(),
      mcpServers: new Set(),
    },
    cursors: {
      artifacts: 0,
      subagents: 0,
      mcp: 0,
      options: 0,
    },
    metadataFocus: 0,
    availability: {
      artifacts: [],
      subagents: [],
      mcpServers: [],
    },
    prevVisibleArtifacts: new Set(),
    prevSubagentIds: new Set(),
    prevMcpIds: new Set(),
  };

  if (!initialPlan) {
    return baseState;
  }

  return applyPlanToState(baseState, initialPlan, false);
}

function reducer(state: ReducerState, action: WizardAction): ReducerState {
  switch (action.type) {
    case 'SET_STATUS': {
      const statusNote = action.note === undefined ? state.statusNote : action.note;
      return { ...state, status: action.status, statusNote };
    }
    case 'SET_STATUS_NOTE': {
      return { ...state, statusNote: action.note };
    }
    case 'SET_ERROR': {
      return { ...state, errorMessage: action.error };
    }
    case 'SET_RESULT': {
      return { ...state, result: action.result };
    }
    case 'APPLY_PLAN': {
      return applyPlanToState(state, action.plan, action.preferExistingSelections);
    }
    case 'TOGGLE_SELECTION': {
      const nextSelections = cloneSelections(state.selections);
      const target = nextSelections[action.collection];
      if (target.has(action.id)) target.delete(action.id);
      else target.add(action.id);
      return { ...state, selections: nextSelections };
    }
    case 'SELECT_ALL': {
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.collection]: new Set(state.availability[action.collection]),
        },
      };
    }
    case 'CLEAR_SELECTIONS': {
      return {
        ...state,
        selections: {
          ...state.selections,
          [action.collection]: new Set(),
        },
      };
    }
    case 'SET_CURSOR': {
      const maxIndex = getMaxCursorIndex(state, action.cursor);
      return {
        ...state,
        cursors: {
          ...state.cursors,
          [action.cursor]: clamp(action.index, 0, maxIndex),
        },
      };
    }
    case 'NEXT_STEP': {
      const idx = state.stepOrder.indexOf(state.step);
      if (idx < 0) {
        return { ...state, step: state.stepOrder[0] ?? 'artifacts' };
      }
      const nextStep = state.stepOrder[Math.min(idx + 1, state.stepOrder.length - 1)] ?? state.step;
      return { ...state, step: nextStep };
    }
    case 'PREV_STEP': {
      const idx = state.stepOrder.indexOf(state.step);
      if (idx <= 0) {
        return { ...state, step: state.stepOrder[0] ?? 'artifacts' };
      }
      const prevStep = state.stepOrder[idx - 1] ?? state.step;
      return { ...state, step: prevStep };
    }
    case 'SET_STEP': {
      if (!state.stepOrder.includes(action.step)) return state;
      return { ...state, step: action.step };
    }
    case 'SET_METADATA_FOCUS': {
      return { ...state, metadataFocus: action.focus };
    }
    case 'UPDATE_OPTIONS': {
      return { ...state, options: { ...state.options, ...action.changes } };
    }
    default: {
      return state;
    }
  }
}

function applyPlanToState(
  state: ReducerState,
  plan: ExtractPlan,
  preferExistingSelections: boolean,
): ReducerState {
  const visibleArtifactIds = Object.keys(plan.detected).filter(
    (id) => !HIDDEN_ARTIFACT_IDS.has(id),
  );
  const subagentIds = getPlanSubagentIds(plan);
  const mcpIds = plan.mcpServers.map((server) => server.id);

  const nextArtifacts = computeNextSelection(
    state.selections.artifacts,
    visibleArtifactIds,
    preferExistingSelections,
    state.prevVisibleArtifacts,
  );
  const nextSubagents = computeNextSelection(
    state.selections.subagents,
    subagentIds,
    preferExistingSelections,
    state.prevSubagentIds,
  );
  const nextMcp = computeNextSelection(
    state.selections.mcpServers,
    mcpIds,
    preferExistingSelections,
    state.prevMcpIds,
  );

  const availability: WizardAvailability = {
    artifacts: visibleArtifactIds,
    subagents: subagentIds,
    mcpServers: mcpIds,
  };

  const nextCursors: WizardCursors = {
    artifacts: clamp(state.cursors.artifacts, 0, Math.max(visibleArtifactIds.length - 1, 0)),
    subagents: clamp(state.cursors.subagents, 0, Math.max(subagentIds.length - 1, 0)),
    mcp: clamp(state.cursors.mcp, 0, Math.max(mcpIds.length - 1, 0)),
    options: state.cursors.options,
  };

  const stepOrder = computeStepOrder(plan);
  const nextStep = stepOrder.includes(state.step) ? state.step : (stepOrder[0] ?? 'artifacts');

  return {
    ...state,
    plan,
    selections: {
      artifacts: nextArtifacts,
      subagents: nextSubagents,
      mcpServers: nextMcp,
    },
    availability,
    cursors: nextCursors,
    stepOrder,
    step: nextStep,
    prevVisibleArtifacts: new Set(visibleArtifactIds),
    prevSubagentIds: new Set(subagentIds),
    prevMcpIds: new Set(mcpIds),
  };
}

function computeNextSelection(
  current: Set<string>,
  available: string[],
  preferExistingSelections: boolean,
  previousAvailable: Set<string>,
): Set<string> {
  if (available.length === 0) {
    return new Set();
  }

  if (preferExistingSelections && current.size > 0) {
    const next = new Set<string>();
    for (const id of available) {
      if (current.has(id) || !previousAvailable.has(id)) {
        next.add(id);
      }
    }
    if (next.size > 0) {
      return next;
    }
  }

  return new Set(available);
}

function cloneSelections(selections: WizardSelections): WizardSelections {
  return {
    artifacts: new Set(selections.artifacts),
    subagents: new Set(selections.subagents),
    mcpServers: new Set(selections.mcpServers),
  };
}

function getMaxCursorIndex(state: ReducerState, cursor: CursorId): number {
  switch (cursor) {
    case 'artifacts': {
      return Math.max(state.availability.artifacts.length - 1, 0);
    }
    case 'subagents': {
      return Math.max(state.availability.subagents.length - 1, 0);
    }
    case 'mcp': {
      return Math.max(state.availability.mcpServers.length - 1, 0);
    }
    case 'options': {
      return Math.max(OPTION_TOGGLE_CONFIG.length - 1, 0);
    }
    default: {
      return 0;
    }
  }
}

function clamp(value: number, min: number, max: number): number {
  if (max < min) return min;
  return Math.min(Math.max(value, min), max);
}

export function isOptionToggleEnabled(options: ExtractOptions, id: OptionToggleId): boolean {
  return Boolean(options[id as keyof ExtractOptions]);
}
