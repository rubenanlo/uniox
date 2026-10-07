import type { RendererApi } from '@app/shared';

declare global {
  interface Window {
    api: RendererApi;
  }
}

export const api: RendererApi = window.api;
