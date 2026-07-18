import { slash } from '../../framework.ts'

export default slash({
  description: 'Fun commands and small interaction examples',
  contexts: ['guild', 'botDm', 'privateChannel'],
  installations: ['guild', 'user']
})
