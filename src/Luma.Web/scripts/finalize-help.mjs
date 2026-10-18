import { rename, writeFile } from 'node:fs/promises'
await rename(new URL('../help-dist/help.html', import.meta.url), new URL('../help-dist/index.html', import.meta.url))
await writeFile(new URL('../help-dist/.nojekyll', import.meta.url), '')
