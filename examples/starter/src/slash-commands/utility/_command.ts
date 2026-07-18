import { slash } from '../../framework.ts'

export default slash({
  description: 'Notes, diagnostics, and application utilities',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user']
})
