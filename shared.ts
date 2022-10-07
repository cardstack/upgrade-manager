// Importing app code from the test helpers breaks hardhat environment fixtures for some reason

// Helpers useful in both tests and plugin task code should live here and be imported from each

export function getErrorMessageAndStack(error: unknown): {
  message: string;
  stack?: string;
} {
  if (error instanceof Error) return error;
  return { message: String(error), stack: new Error().stack };
}
