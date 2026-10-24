/** Connect the app's planning-cycle data to the existing FastAPI endpoints. */

import {
  MAX_CYCLE_NAME_LENGTH,
  MAX_CYCLE_PRIMARY_FOCUS_LENGTH,
  MAX_CYCLE_THEME_LENGTH,
  normalizeCycleName,
  normalizeCyclePrimaryFocus,
  normalizeCycleTheme,
  type PlanningCycleDetails,
} from '../cycleIdentityUtils';
import { ApiError, apiRequest, type ApiRequestOptions } from './apiClient';

/** IDs here are native PostgreSQL IDs, including cycles imported from SQLite. */
export type ApiPlanningCycle = {
  id: number;
  sourcePlanningCycleId: number | null;
  name: string | null;
  primaryFocus: string | null;
  theme: string | null;
  startDate: string;
  endDate: string;
  active: boolean;
  createdAt: string;
  completedAt: string | null;
};

export type CreateApiPlanningCycleInput = PlanningCycleDetails & { startDate: string };
export type UpdateApiPlanningCycleInput = PlanningCycleDetails & { startDate?: string };
export type PlanningCycleApiOptions = Pick<ApiRequestOptions, 'baseUrl' | 'timeoutMs' | 'signal' | 'headers'>;

const PATH = '/api/v1/planning-cycles';
const INPUT_FIELDS = ['startDate', 'name', 'primaryFocus', 'theme'];

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function postgresId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0 && value <= 2_147_483_647;
}
function dateKey(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const year = Number(value.slice(0, 4)), month = Number(value.slice(5, 7)), day = Number(value.slice(8, 10));
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  return year >= 1 && month >= 1 && month <= 12 && day >= 1 &&
    day <= [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31][month - 1];
}
function timestamp(value: unknown): value is string {
  return typeof value === 'string' && dateKey(value.slice(0, 10)) &&
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value) &&
    Number.isFinite(Date.parse(value));
}
function optionalText(value: unknown, limit: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= limit);
}
function invalidInput(message: string): never {
  throw new ApiError(message, { kind: 'configuration' });
}
function requireId(id: number): void {
  if (!postgresId(id)) invalidInput('Use the planning cycle\'s PostgreSQL ID.');
}
function decodeCycle(value: unknown): ApiPlanningCycle {
  if (!object(value) || !postgresId(value.id) ||
      !(value.source_planning_cycle_id === null ||
        (typeof value.source_planning_cycle_id === 'number' && Number.isSafeInteger(value.source_planning_cycle_id) && value.source_planning_cycle_id > 0)) ||
      !optionalText(value.name, MAX_CYCLE_NAME_LENGTH) ||
      !optionalText(value.primary_focus, MAX_CYCLE_PRIMARY_FOCUS_LENGTH) ||
      !optionalText(value.theme, MAX_CYCLE_THEME_LENGTH) ||
      !dateKey(value.start_date) || !dateKey(value.end_date) || value.end_date < value.start_date ||
      typeof value.active !== 'boolean' || !timestamp(value.created_at) ||
      !(value.completed_at === null || timestamp(value.completed_at))) {
    throw new Error('Invalid planning-cycle response.');
  }
  return {
    id: value.id, sourcePlanningCycleId: value.source_planning_cycle_id as number | null,
    name: value.name, primaryFocus: value.primary_focus, theme: value.theme,
    startDate: value.start_date, endDate: value.end_date, active: value.active,
    createdAt: value.created_at, completedAt: value.completed_at as string | null,
  };
}
function decodeList(value: unknown): ApiPlanningCycle[] {
  if (!Array.isArray(value)) throw new Error('Expected a planning-cycle list.');
  const cycles = value.map(decodeCycle);
  if (new Set(cycles.map((cycle) => cycle.id)).size !== cycles.length) {
    throw new Error('Duplicate planning-cycle IDs.');
  }
  if (cycles.filter((cycle) => cycle.active).length > 1) {
    throw new Error('More than one active planning cycle.');
  }
  return cycles;
}
function requestBody(input: unknown, creating: boolean): Record<string, unknown> {
  if (!object(input) || Object.keys(input).some((field) => !INPUT_FIELDS.includes(field))) {
    invalidInput('Planning-cycle input contains unsupported fields.');
  }
  const body: Record<string, unknown> = {};
  if (creating || input.startDate !== undefined) {
    if (!dateKey(input.startDate)) invalidInput('startDate must be a real YYYY-MM-DD date.');
    body.start_date = input.startDate;
  }
  for (const [field, serverField, normalize] of [
    ['name', 'name', normalizeCycleName],
    ['primaryFocus', 'primary_focus', normalizeCyclePrimaryFocus],
    ['theme', 'theme', normalizeCycleTheme],
  ] as const) {
    const value = input[field];
    if (value === undefined) continue;
    if (value !== null && typeof value !== 'string') invalidInput(`${field} must be text or null.`);
    try {
      body[serverField] = normalize(value);
    } catch (error) {
      invalidInput(error instanceof Error ? error.message : `Invalid ${field}.`);
    }
  }
  return body;
}

export async function fetchApiPlanningCycles(options: PlanningCycleApiOptions = {}): Promise<ApiPlanningCycle[]> {
  return apiRequest(PATH, decodeList, { ...options, method: 'GET' });
}

export async function fetchApiCurrentPlanningCycle(options: PlanningCycleApiOptions = {}): Promise<ApiPlanningCycle | null> {
  return apiRequest(`${PATH}/current`, (value) => {
    if (value === null) return null;
    const cycle = decodeCycle(value);
    if (!cycle.active) throw new Error('The current planning cycle must be active.');
    return cycle;
  }, { ...options, method: 'GET' });
}

export async function fetchApiPlanningCycle(id: number, options: PlanningCycleApiOptions = {}): Promise<ApiPlanningCycle> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    const cycle = decodeCycle(value);
    if (cycle.id !== id) throw new Error('The returned planning-cycle ID does not match.');
    return cycle;
  }, { ...options, method: 'GET' });
}

/** PostgreSQL creates the ID and calculates the cycle's end date. */
export async function createApiPlanningCycle(
  input: CreateApiPlanningCycleInput,
  options: PlanningCycleApiOptions = {}
): Promise<ApiPlanningCycle> {
  return apiRequest(PATH, decodeCycle, { ...options, method: 'POST', body: requestBody(input, true) });
}

/** Omitted fields stay unchanged. Explicit null clears optional text. */
export async function updateApiPlanningCycle(
  id: number,
  input: UpdateApiPlanningCycleInput,
  options: PlanningCycleApiOptions = {}
): Promise<ApiPlanningCycle> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    const cycle = decodeCycle(value);
    if (cycle.id !== id) throw new Error('The returned planning-cycle ID does not match.');
    return cycle;
  }, { ...options, method: 'PATCH', body: requestBody(input, false) });
}

export async function deleteApiPlanningCycle(id: number, options: PlanningCycleApiOptions = {}): Promise<void> {
  requireId(id);
  return apiRequest(`${PATH}/${id}`, (value) => {
    if (value !== null) throw new Error('Expected an empty delete response.');
  }, { ...options, method: 'DELETE' });
}

/** Validate a planning cycle returned inside another API action. */
export function decodeApiPlanningCycle(
  value: unknown
): ApiPlanningCycle {
  return decodeCycle(value);
}