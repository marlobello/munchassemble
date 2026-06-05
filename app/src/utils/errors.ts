/** Thrown when a duplicate resource is added (e.g., adding a restaurant already in the session). */
export class DuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateError';
  }
}
