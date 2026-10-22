import { expect, test } from 'vitest'
import { droppedFiles } from './droppedFiles'

test('dropped directory readers drain every batch and preserve nested relative paths', async () => {
  function file(name: string): FileSystemEntry {
    return {
      name,
      isFile: true,
      file: (resolve: (file: File) => void) => resolve(new File(['image'], name)),
    } as unknown as FileSystemEntry
  }
  function directory(name: string, batches: FileSystemEntry[][]): FileSystemEntry {
    return {
      name,
      isFile: false,
      isDirectory: true,
      createReader: () => {
        let next = 0
        return { readEntries: (resolve: (entries: FileSystemEntry[]) => void) => resolve(batches[next++] ?? []) }
      },
    } as unknown as FileSystemEntry
  }
  const root = directory('holiday', [[file('first.jpg')], [directory('day2', [[file('second.jpg')]])]])
  const files = await droppedFiles({ items: [{ webkitGetAsEntry: () => root }], files: [] } as unknown as DataTransfer)
  expect(files.map(file => file.webkitRelativePath)).toEqual(['holiday/first.jpg', 'holiday/day2/second.jpg'])
})
