import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { body, bodyDocs, empty, param, pin, query, username } from '../system/input';
import { AuthService, cookieName, sessionToken } from './auth.service';
import { Actor, Public } from './principal';
import type { Principal } from './principal';

const studentLogin = z.strictObject({
  gradeId: z.uuid(),
  groupId: z.uuid().optional(),
  studentId: z.uuid(),
  pin,
});
const activation = studentLogin.extend({
  activationCode: z.string().trim().min(1).max(80),
});
const staffLogin = z.strictObject({ username, password: z.string().min(1).max(128) });
const staffSetup = z.strictObject({
  username,
  setupCode: z.string().trim().regex(/^[A-Za-z0-9_-]{24}$/),
  password: z.string().length(6),
});

const entryFilter = z.strictObject({ groupId: z.uuid().optional() });

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('grades')
  grades(@Req() req: Request, @query(entryFilter) filter: z.infer<typeof entryFilter>) {
    return this.auth.grades(req.ip ?? 'unknown', filter.groupId);
  }

  @Public()
  @Get('grades/:gradeId/students')
  students(@param('gradeId') gradeId: string, @Req() req: Request, @query(entryFilter) filter: z.infer<typeof entryFilter>) {
    return this.auth.roster(gradeId, req.ip ?? 'unknown', filter.groupId);
  }

  @Public()
  @Get('competition-entry/:id')
  competitionEntry(@param('id') id: string) {
    return this.auth.competitionEntry(id);
  }

  @Public()
  @Post('activate')
  @HttpCode(200)
  @bodyDocs(activation)
  async activate(@body(activation) input: z.infer<typeof activation>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.studentSignIn(input, req.ip ?? 'unknown');
    res.cookie(cookieName, session.token, { ...cookieOptions(), expires: session.expiresAt });
    return session.principal;
  }

  @Public()
  @Post('login')
  @HttpCode(200)
  @bodyDocs(studentLogin)
  async login(@body(studentLogin) input: z.infer<typeof studentLogin>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.studentSignIn(input, req.ip ?? 'unknown');
    res.cookie(cookieName, session.token, { ...cookieOptions(), expires: session.expiresAt });
    return session.principal;
  }

  @Public()
  @Post('staff-login')
  @HttpCode(200)
  @bodyDocs(staffLogin)
  async staffLogin(@body(staffLogin) input: z.infer<typeof staffLogin>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.staffSignIn(input, req.ip ?? 'unknown');
    res.cookie(cookieName, session.token, { ...cookieOptions(), expires: session.expiresAt });
    return session.principal;
  }

  @Public()
  @Post('staff-setup')
  @HttpCode(200)
  @bodyDocs(staffSetup)
  async staffSetup(@body(staffSetup) input: z.infer<typeof staffSetup>, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const session = await this.auth.setupServant(input, req.ip ?? 'unknown');
    res.cookie(cookieName, session.token, { ...cookieOptions(), expires: session.expiresAt });
    return session.principal;
  }

  @Get('me')
  me(@Actor() actor: Principal) {
    return actor;
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  @bodyDocs(empty)
  async logout(@body(empty) _: object, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(sessionToken(req));
    res.clearCookie(cookieName, cookieOptions());
  }
}
