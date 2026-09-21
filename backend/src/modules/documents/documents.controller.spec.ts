import { GUARDS_METADATA, METHOD_METADATA } from '@nestjs/common/constants';
import { RequestMethod } from '@nestjs/common';
import { ROLES_KEY } from '../auth/decorators/roles.decorator';
import { RolesGuard } from '../auth/guards/roles.guard';
import { ENTERPRISE_ACCESS_KEY } from '../enterprises/constants/enterprise-access-key.constant';
import { EnterpriseAccessGuard } from '../enterprises/guards/enterprise-access.guard';
import {
  DOCUMENT_READ_LEVEL,
  DOCUMENT_WRITE_LEVEL,
} from './constants/document.constants';
import { DocumentsController } from './documents.controller';

/**
 * A structural guard against "an endpoint with no authorisation": every route
 * handler of the document controller must declare an enterprise access level
 * AND be behind the enterprise access guard, the class must require the
 * applicant role, and the level must match what the operation does. A future
 * route added without these fails here, before it can ship.
 */
const prototype = DocumentsController.prototype as unknown as Record<
  string,
  (...args: unknown[]) => unknown
>;
const handlers = Object.getOwnPropertyNames(prototype).filter(
  (name) =>
    name !== 'constructor' &&
    Reflect.getMetadata(METHOD_METADATA, prototype[name]) !== undefined,
);
const methodOf = (name: string) =>
  RequestMethod[Reflect.getMetadata(METHOD_METADATA, prototype[name])];

describe('DocumentsController authorisation wiring', () => {
  it('finds every route handler (so the checks below are not vacuous)', () => {
    expect(handlers.sort()).toEqual(
      [
        'download',
        'get',
        'list',
        'replace',
        'requirements',
        'upload',
        'versions',
      ].sort(),
    );
  });

  it('requires the applicant role and the role guard on the whole controller', () => {
    expect(Reflect.getMetadata(ROLES_KEY, DocumentsController)).toEqual([
      'APPLICANT',
    ]);
    expect(Reflect.getMetadata(GUARDS_METADATA, DocumentsController)).toContain(
      RolesGuard,
    );
  });

  it.each(handlers)(
    '%s declares an enterprise access level and the guard that enforces it',
    (name) => {
      const level = Reflect.getMetadata(ENTERPRISE_ACCESS_KEY, prototype[name]);
      expect(level).toEqual(expect.any(String));
      expect(['VIEW_ONLY', 'PREPARE_SUBMIT', 'FULL', 'OWNER']).toContain(level);
      expect(Reflect.getMetadata(GUARDS_METADATA, prototype[name])).toContain(
        EnterpriseAccessGuard,
      );
    },
  );

  it('gives every write (upload, replace) at least Prepare & Submit, and reads View Only', () => {
    expect(DOCUMENT_WRITE_LEVEL).toBe('PREPARE_SUBMIT');
    expect(DOCUMENT_READ_LEVEL).toBe('VIEW_ONLY');
    for (const name of handlers) {
      const expected = ['upload', 'replace'].includes(name)
        ? DOCUMENT_WRITE_LEVEL
        : DOCUMENT_READ_LEVEL;
      expect({
        name,
        level: Reflect.getMetadata(ENTERPRISE_ACCESS_KEY, prototype[name]),
      }).toEqual({ name, level: expected });
    }
  });

  it('is exactly: writes are POST, everything else is GET (nothing else is exposed)', () => {
    for (const name of handlers) {
      expect({
        name,
        method: methodOf(name),
      }).toEqual({
        name,
        method: ['upload', 'replace'].includes(name) ? 'POST' : 'GET',
      });
    }
  });

  it('has no handler that deletes, patches or puts a document', () => {
    const methods = handlers.map(methodOf);
    for (const forbidden of ['DELETE', 'PATCH', 'PUT']) {
      expect(methods).not.toContain(forbidden);
    }
  });
});
