import { Module } from '@nestjs/common';
import { AttemptService } from './attempt.service';
import { CompetitionController, StaffAttemptController, StudentCompetitionController } from './competition.controller';
import { CompetitionService } from './competition.service';
import { LeaderboardController, LeaderboardService } from './leaderboard';
import { ResultsService } from './results.service';

@Module({
  controllers: [CompetitionController, StaffAttemptController, StudentCompetitionController, LeaderboardController],
  providers: [CompetitionService, AttemptService, ResultsService, LeaderboardService],
})
export class CompetitionModule {}
