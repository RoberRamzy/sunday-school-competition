import { CanActivate, ExecutionContext, ForbiddenException, Injectable, Module, UnauthorizedException } from '@nestjs/common';
import { APP_GUARD, Reflector } from '@nestjs/core';
import { AuthController } from './auth.controller';
import { AuthService, sessionToken } from './auth.service';
import { PUBLIC, ROLES } from './principal';
import type { AuthRequest, Principal } from './principal';

@Injectable()
class SessionGuard implements CanActivate {
  constructor(private readonly auth: AuthService, private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext) {
    const targets = [context.getHandler(), context.getClass()];
    if (this.reflector.getAllAndOverride<boolean>(PUBLIC, targets)) return true;
    const req = context.switchToHttp().getRequest<AuthRequest>();
    const principal = await this.auth.authenticate(sessionToken(req));
    if (!principal) throw new UnauthorizedException();
    const roles = this.reflector.getAllAndOverride<Principal['role'][]>(ROLES, targets);
    if (roles && !roles.includes(principal.role)) throw new ForbiddenException();
    req.principal = principal;
    return true;
  }
}

@Module({
  controllers: [AuthController],
  providers: [AuthService, { provide: APP_GUARD, useClass: SessionGuard }],
})
export class AuthModule {}
