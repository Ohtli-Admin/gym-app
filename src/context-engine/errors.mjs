export class ContextValidationError extends Error {
  constructor(issues) {
    super(
      `Invalid training context input: ${issues
        .map((issue) => `${issue.field}: ${issue.message}`)
        .join('; ')}`,
    );
    this.name = 'ContextValidationError';
    this.issues = issues;
  }
}
