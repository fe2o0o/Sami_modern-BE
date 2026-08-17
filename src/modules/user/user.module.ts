import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { User } from './entities/user.entity';
import { Role } from '../role/entities/role.entity';
import { Branch } from '../branch/entities/branch.entity';
import { UserService } from './user.service';
import { UserController } from './user.controller';

@Module({
  imports: [TypeOrmModule.forFeature([User, Role, Branch])],
  controllers: [UserController],
  providers: [UserService],
  // Exported so AuthModule can reuse credential/refresh helpers.
  exports: [UserService, TypeOrmModule],
})
export class UserModule {}
