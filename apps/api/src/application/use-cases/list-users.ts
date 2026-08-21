import type { UserRecord, UserRepository } from '../ports/user-repository';

/** GET /users - the seeded users, so the client can populate assignee pickers. */
export class ListUsersUseCase {
  constructor(private readonly users: UserRepository) {}

  execute(): Promise<UserRecord[]> {
    return this.users.list();
  }
}
