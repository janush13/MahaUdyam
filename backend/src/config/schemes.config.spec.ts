import {
  DEFAULT_SCHEME_PUBLISHER_ROLES,
  buildSchemeConfig,
} from './schemes.config';

describe('buildSchemeConfig', () => {
  const original = process.env;
  beforeEach(() => {
    process.env = { ...original };
    delete process.env.SCHEME_PUBLISHER_ROLES;
  });
  afterAll(() => {
    process.env = original;
  });

  it('defaults to the Department Administrator publishing (separate from the drafting Scheme Officer)', () => {
    expect(buildSchemeConfig()).toEqual({ publisherRoles: ['DEPT_ADMIN'] });
    expect(DEFAULT_SCHEME_PUBLISHER_ROLES).toEqual(['DEPT_ADMIN']);
  });

  it('returns a copy of the default, never the shared array', () => {
    buildSchemeConfig().publisherRoles.push('LEGAL_COMPLIANCE');
    expect(buildSchemeConfig().publisherRoles).toEqual(['DEPT_ADMIN']);
  });

  it('parses a list of the named candidates, ignoring case, spaces and repeats', () => {
    process.env.SCHEME_PUBLISHER_ROLES =
      ' legal_compliance , DEPT_ADMIN,dept_admin ';
    expect(buildSchemeConfig().publisherRoles).toEqual([
      'LEGAL_COMPLIANCE',
      'DEPT_ADMIN',
    ]);
    process.env.SCHEME_PUBLISHER_ROLES = 'SCHEME_OFFICER';
    expect(buildSchemeConfig().publisherRoles).toEqual(['SCHEME_OFFICER']);
  });

  it('treats an empty value as unset', () => {
    process.env.SCHEME_PUBLISHER_ROLES = '   ';
    expect(buildSchemeConfig().publisherRoles).toEqual(['DEPT_ADMIN']);
  });

  it('refuses any other role (a System Administrator can never publish) and a list of only commas', () => {
    process.env.SCHEME_PUBLISHER_ROLES = 'SYSTEM_ADMIN';
    expect(() => buildSchemeConfig()).toThrow(/SYSTEM_ADMIN/);
    process.env.SCHEME_PUBLISHER_ROLES = 'DEPT_ADMIN,SUPER_ADMIN';
    expect(() => buildSchemeConfig()).toThrow(/SUPER_ADMIN/);
    process.env.SCHEME_PUBLISHER_ROLES = ',,';
    expect(() => buildSchemeConfig()).toThrow(/SCHEME_PUBLISHER_ROLES/);
  });
});
