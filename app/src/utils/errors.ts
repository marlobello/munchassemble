/** Thrown when a duplicate resource is added (e.g., adding a restaurant already in the session). */
export class DuplicateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'DuplicateError';
  }
}

/** Thrown when a state machine rule is violated (e.g., Out user voting, Maybe user hosting carpool). */
export class StateError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StateError';
  }
}
