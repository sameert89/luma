import { cpSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('../../../', import.meta.url))
cpSync(new URL('../dist/', import.meta.url), new URL('../../Luma.Server/wwwroot/', import.meta.url), { recursive: true })
execFileSync('dotnet', ['publish', 'src/Luma.Server', '-c', 'Release', '-o', '.local/publish'], {
  cwd: root, stdio: 'inherit',
})
