import { Controller, Get, HttpCode, Patch, Post, StreamableFile } from '@nestjs/common';
import { ApiCookieAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { body, bodyDocs, empty, param, query } from '../system/input';
import { AttemptService } from './attempt.service';
import type { StudentPrincipal } from './attempt.service';
import {
  answerInput, sharedCompetitionInput, competitionPatch, exportFilter, reasonInput,
} from './competition.input';
import { CompetitionService } from './competition.service';
import { ResultsService } from './results.service';

@ApiTags('Competition management')
@ApiCookieAuth('sid')
@Roles('SUPER_ADMIN', 'SERVANT')
@Controller('admin/competitions')
export class CompetitionController {
  constructor(private readonly competitions: CompetitionService, private readonly results: ResultsService) {}

  @Get()
  list(@Actor() actor: StaffPrincipal) {
    return this.competitions.list(actor);
  }

  @Get(':id')
  detail(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.competitions.detail(actor, id);
  }

  @Post()
  @bodyDocs(sharedCompetitionInput)
  create(@Actor() actor: StaffPrincipal, @body(sharedCompetitionInput) input: z.infer<typeof sharedCompetitionInput>) {
    return this.competitions.save(actor, input);
  }

  @Patch(':id')
  @bodyDocs(competitionPatch)
  update(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(competitionPatch) input: z.infer<typeof competitionPatch>) {
    return this.competitions.save(actor, input, id);
  }

  @Post(':id/activate')
  @HttpCode(200)
  @bodyDocs(empty)
  activate(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.competitions.activate(actor, id);
  }

  @Post(':id/close')
  @HttpCode(200)
  @bodyDocs(empty)
  close(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.competitions.close(actor, id);
  }

  @Post(':id/archive')
  @HttpCode(200)
  @bodyDocs(empty)
  archive(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.competitions.archive(actor, id);
  }

  @Post(':id/publish')
  @HttpCode(200)
  @bodyDocs(empty)
  publish(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.competitions.publish(actor, id);
  }

  @Get(':id/monitoring')
  monitoring(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.results.report(actor, id);
  }

  @Get(':id/results')
  resultsReport(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.results.report(actor, id, true);
  }

  @Get(':id/results/export')
  @ApiProduces('text/csv', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async export(@Actor() actor: StaffPrincipal, @param('id') id: string, @query(exportFilter) input: z.infer<typeof exportFilter>) {
    const bytes = await this.results.export(actor, id, input.format);
    return new StreamableFile(bytes, {
      type: input.format === 'csv' ? 'text/csv; charset=utf-8' : 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="results.${input.format}"`,
    });
  }
}

@ApiTags('Attempt review')
@ApiCookieAuth('sid')
@Roles('SUPER_ADMIN', 'SERVANT')
@Controller('admin/attempts')
export class StaffAttemptController {
  constructor(private readonly attempts: AttemptService) {}

  @Get(':id')
  detail(@Actor() actor: StaffPrincipal, @param('id') id: string) {
    return this.attempts.detail(actor, id);
  }

  @Post(':id/flag')
  @HttpCode(200)
  @bodyDocs(reasonInput)
  flag(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(reasonInput) input: z.infer<typeof reasonInput>) {
    return this.attempts.flag(actor, id, input.reason);
  }

  @Post(':id/authorize-replacement')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @bodyDocs(reasonInput)
  replace(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(reasonInput) input: z.infer<typeof reasonInput>) {
    return this.attempts.replace(actor, id, input.reason);
  }
}

@ApiTags('Student competition')
@ApiCookieAuth('sid')
@Roles('STUDENT')
@Controller()
export class StudentCompetitionController {
  constructor(private readonly attempts: AttemptService, private readonly results: ResultsService) {}

  @Get(['student/dashboard', 'student/competitions'])
  list(@Actor() actor: StudentPrincipal) {
    return this.results.student(actor);
  }

  @Get('student/competitions/:id')
  detail(@Actor() actor: StudentPrincipal, @param('id') id: string) {
    return this.results.student(actor, id);
  }

  @Post('competitions/:id/start')
  @HttpCode(200)
  @bodyDocs(empty)
  start(@Actor() actor: StudentPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.attempts.start(actor, id);
  }

  @Get(['student/attempts/:id', 'attempts/:id/status'])
  status(@Actor() actor: StudentPrincipal, @param('id') id: string) {
    return this.attempts.status(actor, id);
  }

  @Post('attempts/:id/answers')
  @HttpCode(200)
  @bodyDocs(answerInput)
  answer(@Actor() actor: StudentPrincipal, @param('id') id: string, @body(answerInput) input: z.infer<typeof answerInput>) {
    return this.attempts.answer(actor, id, input);
  }

  @Post('attempts/:id/submit')
  @HttpCode(200)
  @bodyDocs(empty)
  submit(@Actor() actor: StudentPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.attempts.submit(actor, id);
  }
}
