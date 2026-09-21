import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * Structural guarantees for "deterministic, no AI, no arbitrary code" — not
 * behaviour tests, but a tripwire: if someone adds an LLM client, dynamic code
 * execution, randomness or a clock to the engine, this fails.
 */
const ENGINE_DIR = __dirname;
const engineFiles = readdirSync(ENGINE_DIR).filter(
  (f) => f.endsWith('.ts') && !f.endsWith('.spec.ts'),
);

/** Strip comments so words in documentation ("no AI/LLM") don't trip checks. */
const code = (file: string) =>
  readFileSync(join(ENGINE_DIR, file), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

const importSpecifiers = (source: string) =>
  [...source.matchAll(/(?:from|require\()\s*['"]([^'"]+)['"]/g)].map(
    (m) => m[1],
  );

describe('the rule engine is deterministic, offline and AI-free', () => {
  it('has the expected engine files', () => {
    expect(engineFiles.sort()).toEqual([
      'discovery-engine.ts',
      'discovery-fields.ts',
      'rule-condition.ts',
    ]);
  });

  it('imports only sibling engine files and the closed project-value constants — no packages at all', () => {
    for (const file of engineFiles) {
      for (const spec of importSpecifiers(code(file))) {
        const allowed =
          spec.startsWith('./') ||
          spec === '../../projects/constants/project-values.constant';
        expect({ file, spec, allowed }).toEqual({ file, spec, allowed: true });
      }
    }
  });

  it('uses no dynamic code execution', () => {
    for (const file of engineFiles) {
      const source = code(file);
      for (const pattern of [
        /\beval\s*\(/,
        /\bnew\s+Function\b/,
        /\bFunction\s*\(/,
        /\bvm\./,
        /child_process/,
        /\bimport\s*\(/,
      ]) {
        expect({
          file,
          pattern: String(pattern),
          found: pattern.test(source),
        }).toEqual({ file, pattern: String(pattern), found: false });
      }
    }
  });

  it('has no sources of nondeterminism or I/O: no clock, randomness, network, filesystem or environment', () => {
    for (const file of engineFiles) {
      const source = code(file);
      for (const pattern of [
        /Date\.now/,
        /new Date\s*\(/,
        /Math\.random/,
        /randomUUID|randomBytes|crypto/,
        /process\.env/,
        /\bfetch\s*\(/,
        /\bhttps?:/,
        /\bfs\b/,
      ]) {
        expect({
          file,
          pattern: String(pattern),
          found: pattern.test(source),
        }).toEqual({ file, pattern: String(pattern), found: false });
      }
    }
  });

  it('references no AI / LLM / ML library or provider', () => {
    const forbidden =
      /anthropic|openai|langchain|llm|gpt|claude|gemini|mistral|cohere|ollama|tensorflow|onnx|embedding|transformers/i;
    for (const file of engineFiles) {
      expect({ file, found: forbidden.test(code(file)) }).toEqual({
        file,
        found: false,
      });
    }
  });

  it('the application declares no AI dependency that the engine could pull in', () => {
    const pkg = JSON.parse(
      readFileSync(join(__dirname, '../../../../package.json'), 'utf8'),
    );
    const deps = Object.keys({ ...pkg.dependencies, ...pkg.devDependencies });
    expect(
      deps.filter((d) =>
        /anthropic|openai|langchain|llm|tensorflow|onnx|transformers/i.test(d),
      ),
    ).toEqual([]);
  });
});
