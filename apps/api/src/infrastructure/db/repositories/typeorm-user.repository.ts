import type { EntityManager } from 'typeorm';

import type { UserRecord, UserRepository } from '../../../application/ports/user-repository';
import { UserEntity } from '../entities/user.entity';

function toUserRecord(entity: UserEntity): UserRecord {
  return {
    id: entity.id,
    name: entity.name,
    email: entity.email,
    createdAt: entity.createdAt,
  };
}

export class TypeOrmUserRepository implements UserRepository {
  constructor(private readonly manager: EntityManager) {}

  async findById(id: string): Promise<UserRecord | null> {
    const entity = await this.manager.findOne(UserEntity, { where: { id } });

    return entity === null ? null : toUserRecord(entity);
  }

  async exists(id: string): Promise<boolean> {
    return this.manager.exists(UserEntity, { where: { id } });
  }

  async list(): Promise<UserRecord[]> {
    const entities = await this.manager.find(UserEntity, { order: { name: 'ASC' } });

    return entities.map(toUserRecord);
  }
}
