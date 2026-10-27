import { test, expect } from '@playwright/test'

function pdfDocument() {
  const stream = (color: string) => {
    const content = `${color} rg 0 0 300 450 re f\n`
    return `<< /Length ${content.length} >>\nstream\n${content}endstream`
  }
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 450] /Contents 5 0 R >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 450] /Contents 6 0 R >>',
    stream('1 0 0'),
    stream('0 0 1'),
  ]
  let text = '%PDF-1.4\n'
  const offsets = objects.map((object, index) => {
    const offset = text.length
    text += `${index + 1} 0 obj\n${object}\nendobj\n`
    return offset
  })
  const xref = text.length
  text += `xref\n0 7\n0000000000 65535 f \n${offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size 7 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`
  return Buffer.from(text)
}

test('PDF pages render in Panels with navigation, saved progress and continuous reading', async ({ page }) => {
  let saved = 0
  const comic = () => ({
    id: 98,
    libraryId: 1,
    title: 'PDF reader',
    series: '',
    author: '',
    description: '',
    format: 'pdf',
    pageCount: 2,
    pageIndex: saved,
    state: 'reading',
    readingSeconds: 0,
    direction: 'ltr',
    settings: '{}',
    lastReadAt: null,
    favourite: false,
    coverUrl: null,
    coverPage: 0,
    documentUrl: '/api/panels/comics/98/document?revision=1',
  })
  await page.route('**/api/panels/comics/98', route => route.fulfill({ json: comic() }))
  await page.route('**/api/panels/comics/98/document?revision=1', route =>
    route.fulfill({ contentType: 'application/pdf', body: pdfDocument() }),
  )
  await page.route('**/api/panels/comics/98/progress', async route => {
    saved = route.request().postDataJSON().pageIndex
    await route.fulfill({ status: 204 })
  })
  const imageRequests: string[] = []
  page.on('request', request => {
    if (request.url().includes('/comics/98/pages/')) imageRequests.push(request.url())
  })
  await page.goto('/panels?comic=98')
  const counter = page.getByRole('button', { name: 'Go to page', exact: true })
  const color = async (index: number) =>
    page.getByRole('img', { name: `PDF reader, page ${index}` }).evaluate(element => {
      const canvas = element as HTMLCanvasElement
      return Array.from(canvas.getContext('2d')!.getImageData(10, 10, 1, 1).data)
    })
  await expect.poll(() => color(1)).toEqual([255, 0, 0, 255])
  await page.getByRole('button', { name: 'Next page', exact: true }).click()
  await expect(counter).toHaveText('2 / 2')
  await expect.poll(() => color(2)).toEqual([0, 0, 255, 255])
  await page.getByRole('button', { name: 'Exit reader', exact: true }).click()
  await expect.poll(() => saved).toBe(1)
  await expect(counter).toHaveCount(0)
  await page.goBack()
  await expect(counter).toHaveText('2 / 2')
  await expect.poll(() => color(2)).toEqual([0, 0, 255, 255])
  await page.getByRole('button', { name: 'Reader settings', exact: true }).click()
  await page.getByRole('combobox', { name: 'Reading mode' }).selectOption('continuous')
  await page.getByRole('button', { name: 'Close', exact: true }).click()
  await expect.poll(() => color(2)).toEqual([0, 0, 255, 255])
  expect(imageRequests).toHaveLength(0)
})
