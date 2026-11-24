import {
  ArgumentsHost, Catch, ConsoleLogger, ExceptionFilter, HttpException, INestApplication, Logger,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { AppModule } from './app.module';

@Catch()
class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(error: unknown, host: ArgumentsHost) {
    const response = host.switchToHttp().getResponse<Response>();
    if (error instanceof HttpException) {
      const statusCode = error.getStatus();
      const payload = error.getResponse();
      response.status(statusCode).json(typeof payload === 'string' ? { statusCode, message: payload } : payload);
      return;
    }
    if (error instanceof SyntaxError && 'status' in error && error.status === 400) {
      response.status(400).json({ statusCode: 400, message: 'Malformed JSON' });
      return;
    }
    if (error instanceof Error && 'status' in error && error.status === 413) {
      response.status(413).json({ statusCode: 413, message: 'Request body is too large' });
      return;
    }
    this.logger.error({ event: 'unexpected_request_error', kind: error instanceof Error ? error.name : typeof error });
    response.status(500).json({ statusCode: 500, message: 'Internal server error' });
  }
}

export function configureApp(app: INestApplication, origin: string) {
  app.getHttpAdapter().getInstance().disable('x-powered-by');
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'no-referrer');
    if (!['GET', 'HEAD', 'OPTIONS'].includes(req.method) && req.headers.origin !== origin) {
      res.status(403).json({ statusCode: 403, message: 'Request origin rejected' });
      return;
    }
    next();
  });
  app.enableCors({ origin: [origin], credentials: true });
  const importBody = json({ limit: '2mb' });
  const competitionBody = json({ limit: '512kb' });
  // Nest installs its default JSON parser when no global jsonParser middleware is present.
  app.use('/api/admin/students/import', (req: Request, res: Response, next: NextFunction) => importBody(req, res, next));
  app.use('/api/admin/competitions', (req: Request, res: Response, next: NextFunction) => competitionBody(req, res, next));
  app.useGlobalFilters(new ApiExceptionFilter());
  app.setGlobalPrefix('api', { exclude: ['health', 'ready'] });
  const config = new DocumentBuilder()
    .setTitle('Sunday School Competition API')
    .setVersion('1.0')
    .addCookieAuth('sid', { type: 'apiKey', in: 'cookie' }, 'sid')
    .build();
  SwaggerModule.setup('api/docs', app, () => SwaggerModule.createDocument(app, config));
}

export async function createApp() {
  if (!process.env.DATABASE_URL) throw new Error('DATABASE_URL is required');
  const origin = process.env.PUBLIC_ORIGIN ?? (process.env.NODE_ENV === 'production' ? '' : 'http://localhost:3000');
  const publicUrl = new URL(origin);
  if (publicUrl.origin !== origin || !['http:', 'https:'].includes(publicUrl.protocol) ||
      (process.env.NODE_ENV === 'production' && publicUrl.protocol !== 'https:')) {
    throw new Error('PUBLIC_ORIGIN must be an HTTP origin, with HTTPS required in production');
  }
  const app = await NestFactory.create(AppModule, { logger: new ConsoleLogger({ json: true }) });
  configureApp(app, origin);
  return app;
}
