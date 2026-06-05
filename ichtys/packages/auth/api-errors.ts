import { AccessError } from './validate-study-access'

const ACCESS_ERROR_MESSAGES: Record<AccessError['status'], string> = {
  401: 'Unauthorized',
  403: 'Forbidden',
  404: 'Not Found',
}

export function handleApiError(err: unknown): Response {
  if (err instanceof AccessError) {
    return new Response(ACCESS_ERROR_MESSAGES[err.status], { status: err.status })
  }

  console.error('api route error', err)
  return new Response('Internal Server Error', { status: 500 })
}
