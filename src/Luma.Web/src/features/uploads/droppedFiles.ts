// Read each directory in batches; Chrome may return only the first 100 entries per call.
export async function droppedFiles(data: DataTransfer): Promise<File[]> {
  const entries = [...data.items]
    .map(item => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry)
  if (!entries.length) return [...data.files]
  const files: File[] = []
  async function walk(entry: FileSystemEntry, parent = '', depth = 0): Promise<void> {
    if (depth > 127) throw new Error('Folder upload exceeds the depth limit.')
    const path = parent ? `${parent}/${entry.name}` : entry.name
    if (entry.isFile) {
      if (files.length >= 10000) throw new Error('Choose at most 10,000 files at once.')
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject))
      Object.defineProperty(file, 'webkitRelativePath', { value: path })
      files.push(file)
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader()
      while (true) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject))
        if (!batch.length) break
        for (const child of batch) await walk(child, path, depth + 1)
      }
    }
  }
  for (const entry of entries) await walk(entry)
  return files
}
