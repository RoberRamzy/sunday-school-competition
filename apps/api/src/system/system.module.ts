import { Controller, Get, Module, Put, ServiceUnavailableException } from '@nestjs/common';
import { ApiCookieAuth, ApiTags } from '@nestjs/swagger';
import { z } from 'zod';
import { Actor, audit, lockStaff, Public, Roles } from '../auth/principal';
import type { StaffPrincipal } from '../auth/principal';
import { Database } from '../database/database.module';
import { body, bodyDocs } from './input';

const appearance = z.strictObject({ theme: z.enum(['classic', 'christmas']) });

@ApiTags('System')
@Controller()
class SystemController {
  constructor(private readonly db: Database) {}

  @Public()
  @Get('health')
  health() {
    return { status: 'ok' };
  }

  @Public()
  @Get('ready')
  async ready() {
    try {
      await this.db.$queryRaw`SELECT 1`;
      return { status: 'ok' };
    } catch {
      throw new ServiceUnavailableException('Database unavailable');
    }
  }

  @Public()
  @Get('appearance')
  async appearance() {
    return await this.db.appearance.findUnique({ where: { id: 1 }, select: { theme: true } }) ?? { theme: 'classic' };
  }

  @Put('admin/appearance')
  @ApiCookieAuth('sid')
  @Roles('SUPER_ADMIN')
  @bodyDocs(appearance)
  async setAppearance(@Actor() actor: StaffPrincipal, @body(appearance) input: z.infer<typeof appearance>) {
    return this.db.$transaction(async (tx) => {
      await lockStaff(tx, actor);
      const settings = await tx.appearance.upsert({
        where: { id: 1 }, create: { id: 1, ...input }, update: input, select: { theme: true },
      });
      await audit(tx, actor, 'APPEARANCE_UPDATED', settings);
      return settings;
    });
  }
}

@Module({ controllers: [SystemController] })
export class SystemModule {}
