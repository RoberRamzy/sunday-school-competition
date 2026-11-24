import { Controller, Get, HttpCode, Patch, Post, StreamableFile } from '@nestjs/common';
import { ApiCookieAuth, ApiProduces, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { body, bodyDocs, empty, param, query } from '../system/input';
import {
  gradeInput, handoutInput, servantInput, servantPatch, studentFilter, studentImport, studentInput, studentPatch,
} from './roster.input';
import { RosterService } from './roster.service';

@ApiCookieAuth('sid')
@ApiTags('Roster and staff')
@Roles('SUPER_ADMIN', 'SERVANT')
@Controller('admin')
export class RosterController {
  constructor(private readonly roster: RosterService) {}

  @Get('grades')
  grades(@Actor() actor: StaffPrincipal) {
    return this.roster.grades(actor);
  }

  @Post('grades')
  @Roles('SUPER_ADMIN')
  @bodyDocs(gradeInput)
  createGrade(@Actor() actor: StaffPrincipal, @body(gradeInput) input: z.infer<typeof gradeInput>) {
    return this.roster.saveGrade(actor, input.name);
  }

  @Patch('grades/:id')
  @Roles('SUPER_ADMIN')
  @bodyDocs(gradeInput)
  updateGrade(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(gradeInput) input: z.infer<typeof gradeInput>) {
    return this.roster.saveGrade(actor, input.name, id);
  }

  @Get('students')
  students(@Actor() actor: StaffPrincipal, @query(studentFilter) input: z.infer<typeof studentFilter>) {
    return this.roster.students(actor, input.gradeId);
  }

  @Post('students')
  @bodyDocs(studentInput)
  createStudent(@Actor() actor: StaffPrincipal, @body(studentInput) input: z.infer<typeof studentInput>) {
    return this.roster.createStudent(actor, input);
  }

  @Patch('students/:id')
  @bodyDocs(studentPatch)
  updateStudent(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(studentPatch) input: z.infer<typeof studentPatch>) {
    return this.roster.updateStudent(actor, id, input);
  }

  @Post('students/import')
  @HttpCode(200)
  @bodyDocs(studentImport)
  import(@Actor() actor: StaffPrincipal, @body(studentImport) input: z.infer<typeof studentImport>) {
    return this.roster.import(actor, input);
  }

  @Post('students/:id/reset-pin')
  @HttpCode(200)
  @bodyDocs(empty)
  reset(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.roster.reset(actor, id);
  }

  @Post('grades/:gradeId/activation-handout')
  @HttpCode(200)
  @bodyDocs(handoutInput)
  @ApiProduces('application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
  async handout(@Actor() actor: StaffPrincipal, @param('gradeId') gradeId: string, @body(handoutInput) input: z.infer<typeof handoutInput>) {
    const bytes = await this.roster.handout(actor, gradeId, input.studentIds);
    return new StreamableFile(bytes, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: 'attachment; filename="activation-handout.xlsx"',
    });
  }

  @Get('servants')
  @Roles('SUPER_ADMIN')
  servants() {
    return this.roster.servants();
  }

  @Post('servants')
  @Roles('SUPER_ADMIN')
  @bodyDocs(servantInput)
  createServant(@Actor() actor: StaffPrincipal, @body(servantInput) input: z.infer<typeof servantInput>) {
    return this.roster.saveServant(actor, input);
  }

  @Patch('servants/:id')
  @Roles('SUPER_ADMIN')
  @bodyDocs(servantPatch)
  updateServant(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(servantPatch) input: z.infer<typeof servantPatch>) {
    return this.roster.saveServant(actor, input, id);
  }

  @Post('servants/:id/reset-credential')
  @Roles('SUPER_ADMIN')
  @HttpCode(200)
  @bodyDocs(empty)
  resetServantCredential(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(empty) _: object) {
    return this.roster.resetServantCredential(actor, id);
  }
}
