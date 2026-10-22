import ts from 'typescript'
import { expect, test } from 'vitest'
import i18n from './index'

const sources = import.meta.glob('/src/**/*.{ts,tsx}', { query: '?raw', import: 'default', eager: true }) as Record<
  string,
  string
>

test('every static translation reference exists in the bundled English catalogs', () => {
  const missing: string[] = []
  for (const [file, source] of Object.entries(sources)) {
    if (file.includes('.test.') || file.includes('/lib/i18n/')) continue
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    const check = (key: string) => {
      if (!i18n.exists(key, { count: 1 }) || !i18n.exists(key, { count: 2 })) missing.push(`${file}: ${key}`)
    }
    function visit(node: ts.Node) {
      if (ts.isCallExpression(node) && node.expression.getText(ast) === 't') {
        const key = node.arguments[0]
        if (key && ts.isStringLiteral(key)) check(key.text)
        if (key && ts.isConditionalExpression(key)) {
          for (const branch of [key.whenTrue, key.whenFalse]) if (ts.isStringLiteral(branch)) check(branch.text)
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(ast) === 'i18nKey') {
        if (node.initializer && ts.isStringLiteral(node.initializer)) check(node.initializer.text)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  expect(missing).toEqual([])
})

test('visible JSX text and accessibility labels are extracted instead of embedded in components', () => {
  const embedded: string[] = []
  const attributes = new Set(['aria-label', 'placeholder', 'label', 'description', 'title', 'alt'])
  for (const [file, source] of Object.entries(sources)) {
    if (file.includes('.test.') || file.includes('/lib/i18n/')) continue
    const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true)
    function visit(node: ts.Node) {
      if (ts.isJsxText(node) && /[a-zA-Z]/.test(node.text) && !['Luma', 'luma'].includes(node.text.trim()))
        embedded.push(`${file}: ${node.text.trim()}`)
      if (ts.isJsxAttribute(node) && attributes.has(node.name.getText(ast))) {
        const value = node.initializer
        if (value && ts.isStringLiteral(value) && /[a-zA-Z]/.test(value.text))
          embedded.push(`${file}: ${node.name.getText(ast)}=${value.text}`)
      }
      ts.forEachChild(node, visit)
    }
    visit(ast)
  }
  expect(embedded).toEqual([])
})
