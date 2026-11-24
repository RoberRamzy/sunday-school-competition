import { Module } from '@nestjs/common';
import { AttemptService } from './attempt.service';
import { CompetitionController, StaffAttemptController, StudentCompetitionController } from './competition.controller';
import { CompetitionService } from './competition.service';
import { LeaderboardController, LeaderboardService } from './leaderboard';
import { ResultsService } from './results.service';
import { DeletionController } from './deletion.controller';
import { DeletionService } from './deletion.service';

@Module({
  controllers: [CompetitionController, StaffAttemptController, StudentCompetitionController, LeaderboardController, DeletionController],
  providers: [CompetitionService, AttemptService, ResultsService, LeaderboardService, DeletionService],
})
export class CompetitionModule {}
