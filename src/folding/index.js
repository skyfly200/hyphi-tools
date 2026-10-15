// Shared folding / assembly engine — public surface.
// Framework-free: no Vue, DOM or Three.js dependencies.

export * from './math.js';
export { bandPose, bandRadius, bandChord } from './bends/circular.js';
export { compileAssembly, geometryHash, connectionPose, CONNECTION_TYPES } from './model.js';
export { evaluatePoses, closureResiduals } from './kinematics.js';
export { solveConfiguration, DEFAULT_TOLERANCES } from './solver/backend.js';
export { solveStepContinuation, stepGenerator } from './solver/continuation.js';
export { levenbergMarquardt } from './solver/levenberg-marquardt.js';
export { validateSequence, resolveStep, solveSequence, stepCacheKey, SEQUENCE_VERSION } from './sequence.js';
export { emptyFoldform, attachSequence, readFoldform } from './serialization.js';
export { foldStudioToAssembly } from './adapters/foldstudio.js';
export { polyForgeToAssembly, legacyAnglesToEngine } from './adapters/polyforge.js';
export { bandCenterline, bendProfile, bandMaxCurvature, bandAngleLimit } from './bends/circular.js';
export { bandSurfaceGrid, gridDistortion, meshDistortion, bendStrainEstimate } from './bends/surface.js';
export { checkCollisions, checkPath, sectionSegments, chainSegments, envelope, radialExtents, measureFeatures, checkObstacles } from './collision/validation.js';
export { expandHingeWidths } from './hinges.js';
export { SolverClient, createInlineTransport } from './worker-client.js';
export { createSolverService } from './worker-core.js';
