/**
 * Standard API error response structure.
 * Returned with non-2xx HTTP status codes.
 */
export interface APIError {
  code: string;
  message: string;
}
