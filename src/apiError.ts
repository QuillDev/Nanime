interface EdenError {
  readonly status: unknown;
  readonly value: unknown;
}

interface ApiErrorDetails {
  readonly status: number | null;
  readonly source: string | null;
  readonly retryAfterSeconds: number | null;
}

export class ApiError extends Error {
  public readonly status: number | null;
  public readonly source: string | null;
  public readonly retryAfterSeconds: number | null;

  public constructor(
    message: string,
    details: ApiErrorDetails,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = details.status;
    this.source = details.source;
    this.retryAfterSeconds = details.retryAfterSeconds;
  }
}

function errorDetail(error: EdenError): string {
  if (typeof error.value === "string" && error.value !== "") {
    const detail = error.value.trim();
    if (/^(?:<!doctype\s+html|<html\b)/iu.test(detail)) {
      return `HTTP ${String(error.status)} (gateway returned an error page)`;
    }
    return detail.length <= 500 ? detail : `${detail.slice(0, 500)}…`;
  }
  if (typeof error.value === "object" && error.value !== null && "message" in error.value) {
    const { message } = error.value;
    if (typeof message === "string" && message !== "") {
      return message;
    }
  }
  return `HTTP ${String(error.status)}`;
}

function errorSource(error: EdenError): string | null {
  if (typeof error.value !== "object" || error.value === null) {
    return null;
  }
  const source = "source" in error.value ? error.value.source : null;
  return typeof source === "string" && source !== "" ? source : null;
}

function errorRetryAfter(error: EdenError): number | null {
  if (typeof error.value !== "object" || error.value === null) {
    return null;
  }
  const seconds = "retryAfterSeconds" in error.value
    ? error.value.retryAfterSeconds
    : null;
  return typeof seconds === "number" && Number.isFinite(seconds) && seconds > 0 ? seconds : null;
}

export function apiError(error: EdenError, label: string): ApiError {
  const status = typeof error.status === "number" ? error.status : null;
  const retryAfterSeconds = errorRetryAfter(error);
  const retryHint = retryAfterSeconds === null
    ? ""
    : ` Retry after ${String(retryAfterSeconds)} seconds.`;
  const detail = errorDetail(error);
  const separator = retryHint === "" || detail.endsWith(".") ? "" : ".";
  return new ApiError(
    `${label} failed: ${detail}${separator}${retryHint}`,
    { status, retryAfterSeconds, source: errorSource(error) },
  );
}
