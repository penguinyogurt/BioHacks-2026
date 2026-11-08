import { buildTestPdf, score, testId, type TakeHomePayload } from '../src/lib/take-home'

export function create(payload: TakeHomePayload): Blob {
  return buildTestPdf(score(payload), {
    name: 'Participant', id: testId(payload.completedAt), completedAt: payload.completedAt,
  })
}
