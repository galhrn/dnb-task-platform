/**
 * Users are seeded, never managed (section 2), so this port is read-only on purpose.
 */

export interface UserRecord {
  readonly id: string;
  readonly name: string;
  readonly email: string;
  readonly createdAt: Date;
}

export interface UserRepository {
  findById(id: string): Promise<UserRecord | null>;

  /** Cheaper than findById when a use case only needs to know an assignee is real (WF-1). */
  exists(id: string): Promise<boolean>;

  list(): Promise<UserRecord[]>;
}
