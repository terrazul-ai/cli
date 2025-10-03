export interface APISuccessResponse<T> {
  success: true;
  data: T;
  meta?: Record<string, unknown>;
}

export interface APIErrorResponse {
  success: false;
  error: {
    code: string;
    message: string;
  };
  meta?: Record<string, unknown>;
}

export type APIResponse<T> = APISuccessResponse<T> | APIErrorResponse;
