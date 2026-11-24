import { BadRequestException, Body, Param, PipeTransform, Query } from '@nestjs/common';
import { ApiBody } from '@nestjs/swagger';
import { z } from 'zod';

class SchemaPipe implements PipeTransform {
  constructor(private readonly schema: z.ZodType) {}

  transform(value: unknown) {
    const result = this.schema.safeParse(value);
    if (!result.success) {
      throw new BadRequestException(result.error.issues.map((issue) =>
        [issue.path.join('.'), issue.message].filter(Boolean).join(' ')
      ));
    }
    return result.data;
  }
}

export const body = (schema: z.ZodType) => Body(new SchemaPipe(schema));
export const bodyDocs = (schema: z.ZodType) => ApiBody({ schema: z.toJSONSchema(schema, { io: 'input', target: 'openapi-3.0' }) as Extract<Parameters<typeof ApiBody>[0], { schema: unknown }>['schema'] });
export const param = (name: string, schema = z.uuid()) => Param(name, new SchemaPipe(schema));
export const query = (schema: z.ZodType) => Query(new SchemaPipe(schema));
export const name = z.string().trim().min(1).max(150);
export const username = z.string().trim().normalize("NFC").toLowerCase()
  .overwrite(value => value.replace(/ +/g, ' '))
  .min(3).max(64)
  .regex(/^[\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}._-]*(?: [\p{L}\p{Nd}][\p{L}\p{M}\p{Nd}._-]*)*$/u);
export const newPassword = z.string().min(12).max(128);
export const pin = z.string().regex(/^[0-9]{6}$/);
export const empty = z.strictObject({}).default({});
