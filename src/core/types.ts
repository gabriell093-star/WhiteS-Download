import type { SerializedError } from "./errors.js";

export interface ResolutionSuccess {
  ok: true;
  providerId: string;
  destinationUrl: string;
  meta?: Readonly<Record<string, string>>;
}

export interface ResolutionFailure {
  ok: false;
  providerId: string | null;
  error: SerializedError;
}

export type ResolverResult = ResolutionSuccess | ResolutionFailure;