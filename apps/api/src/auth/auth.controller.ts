import { Controller, Get, HttpCode, Post, Req, Res } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { body, bodyDocs, empty, param } from '../system/input';
import { username } from '../system/input';
import { AuthService, cookieName, sessionToken } from './auth.service';
import { Actor, Public } from './principal';
import type { Principal } from './principal';

const studentLogin = z.strictObject({
  gradeId: z.uuid(),
  studentId: z.uuid(),
  pin: z.string().regex(/^[0-9]{6}$/),
});
const activation = studentLogin.extend({
  activationCode: z.string().trim().min(1).max(80),
});
const staffLogin = z.strictObject({ username, password: z.string().min(1).max(128) });

function cookieOptions() {
  return { httpOnly: true, sameSite: 'lax' as const, secure: process.env.NODE_ENV === 'production', path: '/' };
}

@ApiTags('Authentication')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Get('grades')
  grades(@Req() req: Request) {
    return this.auth.grades(req.ip ?? 'unknown');
  }

  @Public()
  @Get('grades/:gradeId/students')
  students(@param('gradeId') gradeId: string, @Req() req: Request) {
    return this.auth.roster(gradeId, req.ip ?? 'unknown');
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
