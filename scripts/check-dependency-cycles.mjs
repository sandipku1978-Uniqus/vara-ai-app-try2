#!/usr/bin/env node

/**
 * Fail when relative imports within src form a dependency cycle.
 *
 * This uses the TypeScript compiler version pinned in package-lock.json,
 * rather than a floating `npx` architecture tool. Static imports, re-exports,
 * `import()` calls, and CommonJS `require()` calls are all represented.
 */

import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import ts from 'typescript';

const sourceRoot = path.resolve(process.argv[2] || 'src');
const sourceExtensions = ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'];
const sourceExtensionSet = new Set(sourceExtensions);

async function collectSourceFiles(directory) {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await collectSourceFiles(absolute));
    } else if (sourceExtensionSet.has(path.extname(entry.name))) {
      files.push(absolute);
    }
  }
  return files;
}

function moduleSpecifiers(sourceText, fileName) {
  const sourceFile = ts.createSourceFile(
    fileName,
    sourceText,
    ts.ScriptTarget.Latest,
    true,
    fileName.endsWith('.tsx') || fileName.endsWith('.jsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS,
  );
  const specifiers = new Set();

  function addString(node) {
    if (node && ts.isStringLiteralLike(node) && node.text.startsWith('.')) {
      specifiers.add(node.text);
    }
  }

  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      addString(node.moduleSpecifier);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      addString(node.argument.literal);
    } else if (ts.isCallExpression(node)) {
      const isDynamicImport = node.expression.kind === ts.SyntaxKind.ImportKeyword;
      const isRequire = ts.isIdentifier(node.expression) && node.expression.text === 'require';
      if (isDynamicImport || isRequire) addString(node.arguments[0]);
    }
    ts.forEachChild(node, visit);
  }

  visit(sourceFile);
  return [...specifiers];
}

async function isFile(candidate) {
  try {
    return (await stat(candidate)).isFile();
  } catch {
    return false;
  }
}

async function resolveRelativeImport(importer, specifier) {
  const base = path.resolve(path.dirname(importer), specifier);
  const candidates = sourceExtensionSet.has(path.extname(base))
    ? [base]
    : [
        ...sourceExtensions.map(extension => `${base}${extension}`),
        ...sourceExtensions.map(extension => path.join(base, `index${extension}`)),
      ];
  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }
  return null;
}

function stronglyConnectedComponents(graph) {
  let nextIndex = 0;
  const indexes = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function connect(node) {
    indexes.set(node, nextIndex);
    lowLinks.set(node, nextIndex);
    nextIndex += 1;
    stack.push(node);
    onStack.add(node);

    for (const dependency of graph.get(node) || []) {
      if (!indexes.has(dependency)) {
        connect(dependency);
        lowLinks.set(node, Math.min(lowLinks.get(node), lowLinks.get(dependency)));
      } else if (onStack.has(dependency)) {
        lowLinks.set(node, Math.min(lowLinks.get(node), indexes.get(dependency)));
      }
    }

    if (lowLinks.get(node) === indexes.get(node)) {
      const component = [];
      let member;
      do {
        member = stack.pop();
        onStack.delete(member);
        component.push(member);
      } while (member !== node);
      components.push(component);
    }
  }

  for (const node of graph.keys()) {
    if (!indexes.has(node)) connect(node);
  }
  return components;
}

const files = await collectSourceFiles(sourceRoot);
const graph = new Map(files.map(file => [file, new Set()]));

for (const file of files) {
  const sourceText = await readFile(file, 'utf8');
  for (const specifier of moduleSpecifiers(sourceText, file)) {
    const dependency = await resolveRelativeImport(file, specifier);
    if (dependency && graph.has(dependency)) graph.get(file).add(dependency);
  }
}

const cycles = stronglyConnectedComponents(graph)
  .filter(component => component.length > 1 || graph.get(component[0])?.has(component[0]))
  .map(component => component.map(file => path.relative(process.cwd(), file)).sort())
  .sort((left, right) => left[0].localeCompare(right[0]));

if (cycles.length > 0) {
  console.error(`Dependency-cycle gate failed: found ${cycles.length} strongly connected component(s).`);
  for (const [index, cycle] of cycles.entries()) {
    console.error(`\nCycle ${index + 1}:`);
    for (const file of cycle) console.error(`  - ${file}`);
  }
  process.exitCode = 1;
} else {
  console.log(`Dependency-cycle gate passed: 0 cycles across ${files.length} source files.`);
}
