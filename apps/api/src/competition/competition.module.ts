import { Module } from '@nestjs/common';
import { AttemptService } from './attempt.service';
import { CompetitionController, QuestionController, StaffAttemptController, StudentCompetitionController } from './competition.controller';
import { CompetitionService } from './competition.service';
import { QuestionService } from './question.service';
import { ResultsService } from './results.service';

@Module({
  controllers: [QuestionController, CompetitionController, StaffAttemptController, StudentCompetitionController],
  providers: [QuestionService, CompetitionService, AttemptService, ResultsService],
})
export class CompetitionModule {}
