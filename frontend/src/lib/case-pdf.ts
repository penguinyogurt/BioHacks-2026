import { GlobalWorkerOptions, getDocument } from 'pdfjs-dist'
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url'

GlobalWorkerOptions.workerSrc = workerUrl

export type CaseFile = {
  name: string
  sizeKB: number
  pages: number
  words: number
  /** Plain text per page, as the agent receives it. */
  text: string[]
}

/** Extract the text of a patient-case PDF, in the browser. Nothing is uploaded. */
export async function readCasePdf(file: File): Promise<CaseFile> {
  const task = getDocument({ data: new Uint8Array(await file.arrayBuffer()) })
  const pdf = await task.promise
  try {
    const text: string[] = []
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i)
      const content = await page.getTextContent()
      text.push(
        content.items
          .map((it) => ('str' in it ? it.str + (it.hasEOL ? '\n' : ' ') : ''))
          .join('')
          .replace(/[ \t]+\n/g, '\n')
          .trim(),
      )
    }
    const words = text.join(' ').split(/\s+/).filter(Boolean).length
    return { name: file.name, sizeKB: Math.round(file.size / 1024), pages: pdf.numPages, words, text }
  } finally {
    await task.destroy()
  }
}
