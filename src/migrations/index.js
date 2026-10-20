import * as core from './001_core.js';
import * as tools from './002_tools.js';
import * as evaluations from './003_evaluations.js';
import * as evaluationPoints from './004_evaluation_points.js';

/** Ordered list of migrations applied automatically on boot. */
export const migrations = [core, tools, evaluations, evaluationPoints];
