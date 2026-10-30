/** OpenAI spend is accounted in integer microdollars. Provider calls must go
 * through a durable, atomic reservation before they are made. */
export const MONTHLY_LIMIT_MICROS = 25_000_000;
export const USER_DAILY_REQUESTS = 10;
export const MAX_INPUT_TOKENS = 50_000;
export const MAX_OUTPUT_TOKENS = 4_000;

export interface ModelPrice {
  model: string;
  /** US dollars per million tokens, expressed as microdollars. */
  inputMicrosPerMillion: number;
  outputMicrosPerMillion: number;
  verifiedAt: number;
  expiresAt: number;
}
export interface BudgetRequest {
  requestId: string;
  userId: string;
  model: string;
  inputLimit: number;
  outputLimit: number;
  price: ModelPrice;
  /** Epoch milliseconds, supplied by the trusted caller, not a client. */
  now: number;
}
export interface Usage { inputTokens: number; outputTokens: number }
export interface ReservationInput { id: string; userId: string; model: string; reservedMicros: number }
export interface BudgetStore {
  /** Must atomically enforce monthly cap, daily limit and unique id. */
  reserve(input: ReservationInput): Promise<{ id: string }>;
  /** Must settle a reservation at most once; unresolved requests stay reserved. */
  settle(id: string, actualMicros: number): Promise<void>;
}

function integer(value: number, label: string, min: number, max: number): void {
  if (!Number.isSafeInteger(value) || value < min || value > max) throw new Error(`Invalid ${label}.`);
}
function validPrice(price: ModelPrice): void {
  if (!price || typeof price.model !== "string" || !price.model.trim()) throw new Error("Model pricing is unavailable.");
  integer(price.inputMicrosPerMillion, "input pricing", 1, 1_000_000_000_000);
  integer(price.outputMicrosPerMillion, "output pricing", 1, 1_000_000_000_000);
}
function ceilPrice(input: number, output: number, price: ModelPrice): number {
  const total = BigInt(input) * BigInt(price.inputMicrosPerMillion) + BigInt(output) * BigInt(price.outputMicrosPerMillion);
  const micros = (total + 999_999n) / 1_000_000n;
  if (micros > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error("Usage cost is too large to account for.");
  return Number(micros);
}
export function worstCaseMicros(req: BudgetRequest): number {
  if (!req.requestId?.trim() || !req.userId?.trim()) throw new Error("A request and user are required.");
  validPrice(req.price);
  if (req.model !== req.price.model) throw new Error("Model pricing is unavailable.");
  if (!Number.isFinite(req.now) || !Number.isFinite(req.price.verifiedAt) || !Number.isFinite(req.price.expiresAt) || req.price.verifiedAt > req.now || req.price.expiresAt <= req.now || req.price.expiresAt <= req.price.verifiedAt) throw new Error("Model pricing is not currently verified.");
  integer(req.inputLimit, "input limit", 1, MAX_INPUT_TOKENS);
  integer(req.outputLimit, "output limit", 1, MAX_OUTPUT_TOKENS);
  const cost = ceilPrice(req.inputLimit, req.outputLimit, req.price);
  if (cost <= 0 || cost > MONTHLY_LIMIT_MICROS) throw new Error("Request exceeds the monthly budget.");
  return cost;
}
export function actualUsageMicros(usage: Usage, price: ModelPrice): number {
  validPrice(price);
  if (!usage) throw new Error("Provider usage is missing.");
  integer(usage.inputTokens, "input token usage", 0, 1_000_000_000);
  integer(usage.outputTokens, "output token usage", 0, 1_000_000_000);
  return ceilPrice(usage.inputTokens, usage.outputTokens, price);
}

/** Invoke exactly once after a successful reservation. Any timeout, thrown
 * provider error or absent usage leaves the full reservation outstanding. */
export async function budgetedRequest<T>(
  store: BudgetStore, req: BudgetRequest,
  invoke: () => Promise<{ value: T; usage: Usage | null }>,
): Promise<T> {
  const reservedMicros = worstCaseMicros(req);
  const reservation = await store.reserve({ id: req.requestId, userId: req.userId, model: req.model, reservedMicros });
  if (reservation.id !== req.requestId) throw new Error("Budget reservation identity mismatch.");
  const response = await invoke();
  if (!response?.usage) throw new Error("Provider usage is missing; full reservation retained.");
  const actualMicros = actualUsageMicros(response.usage, req.price);
  // Even an unexpected overrun must be recorded so future requests account for it.
  await store.settle(reservation.id, actualMicros);
  if (response.usage.inputTokens > req.inputLimit || response.usage.outputTokens > req.outputLimit || actualMicros > reservedMicros) throw new Error("Provider usage exceeded the reserved limit.");
  return response.value;
}
