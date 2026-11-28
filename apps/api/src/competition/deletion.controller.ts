import { Controller, Delete, Get, HttpCode } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { body, bodyDocs, param } from '../system/input';
import { DeletionService } from './deletion.service';

const confirmation = z.strictObject({ confirmation: z.literal('DELETE') });

@Controller('admin')
@ApiTags('Permanent deletion')
@ApiCookieAuth('sid')
@Roles('SUPER_ADMIN')
export class DeletionController {
  constructor(private readonly deletion: DeletionService) {}

  @Get('staff')
  listStaff(@Actor() actor: StaffPrincipal) {
    return this.deletion.staffList(actor);
  }

  @Delete('competitions/:id')
  @Roles('SUPER_ADMIN', 'SERVANT')
  @HttpCode(204)
  @bodyDocs(confirmation)
  removeCompetition(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(confirmation) _: unknown) {
    return this.deletion.competition(actor, id);
  }

  @Delete('students/:id')
  @Roles('SUPER_ADMIN', 'SERVANT')
  @HttpCode(204)
  @bodyDocs(confirmation)
  removeStudent(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(confirmation) _: unknown) {
    return this.deletion.student(actor, id);
  }

  @Delete('staff/:id')
  @HttpCode(204)
  @bodyDocs(confirmation)
  removeStaff(@Actor() actor: StaffPrincipal, @param('id') id: string, @body(confirmation) _: unknown) {
    return this.deletion.staff(actor, id);
  }
}
