import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { DatabaseModule } from './database/database.module';
import { CompetitionModule } from './competition/competition.module';
import { RosterModule } from './roster/roster.module';
import { SystemModule } from './system/system.module';

@Module({
  imports: [DatabaseModule, AuthModule, RosterModule, SystemModule, CompetitionModule],
})
export class AppModule {}
