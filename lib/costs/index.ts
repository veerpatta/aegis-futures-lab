export {
  CONTRACT_SPECS,
  specFor,
  assertTradable,
  type ContractSpec,
} from "./specs";

export {
  LEGACY_MODEL,
  REALISTIC_MODEL,
  ZERO_COST_MODEL,
  COST_MODELS,
  roundTripCost,
  baseSlippagePoints,
  slippedSides,
  frictionDollarsPerContract,
  resolveExecution,
  frictionSpecFor,
  type CostModel,
  type SlipWindow,
  type FrictionSpec,
  type ExecutionBase,
} from "./model";

export { slippagePointsAt, windowMultiplier, macroMultiplier } from "./slippage";

export { nfpTimes, firstFridayKey, FOMC_DECISIONS, RELEASE_MIN } from "./macro";
