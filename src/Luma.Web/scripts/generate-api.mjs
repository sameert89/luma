import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { readFile, writeFile } from 'node:fs/promises'
import openapiTS, { astToString } from 'openapi-typescript'

const root = fileURLToPath(new URL('../../../', import.meta.url))
execFileSync('dotnet', ['build', 'src/Luma.Server', '-c', 'Release', '-t:Rebuild', '-p:OpenApiGenerateDocuments=true'], {
  cwd: root, stdio: 'inherit', env: { ...process.env, LUMA_EXPORT_OPENAPI: '1' },
})
const schema = new URL('../../../contracts/luma.json', import.meta.url)
await writeFile(schema, (await readFile(schema, 'utf8')).replaceAll('\r\n', '\n') + '\n')
const ast = await openapiTS(schema)
await writeFile(new URL('../src/lib/api/generated.ts', import.meta.url),
  '// Generated from the server OpenAPI document. Run npm run generate:api.\n' + astToString(ast))
