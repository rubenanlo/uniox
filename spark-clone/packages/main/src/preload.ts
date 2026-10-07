import { contextBridge, ipcRenderer } from 'electron';
import type { AiChunk, DeltaEvent, RendererApi } from '@app/shared';

const { isPackaged } = ipcRenderer.sendSync('app-meta') as { isPackaged: boolean };

const api: RendererApi = {
  isPackaged,
  query: (channel, args) => ipcRenderer.invoke('query', channel, args),
  command: (channel, args) => ipcRenderer.invoke('command', channel, args),
  onDelta: (cb) => {
    const listener = (_e: unknown, event: DeltaEvent) => cb(event);
    ipcRenderer.on('delta', listener);
    return () => {
      ipcRenderer.removeListener('delta', listener);
    };
  },
  onAiChunk: (cb) => {
    const listener = (_e: unknown, chunk: AiChunk) => cb(chunk);
    ipcRenderer.on('ai:chunk', listener);
    return () => {
      ipcRenderer.removeListener('ai:chunk', listener);
    };
  },
  onTriageUndo: (cb) => {
    const listener = () => cb();
    ipcRenderer.on('triage:undo', listener);
    return () => {
      ipcRenderer.removeListener('triage:undo', listener);
    };
  },
};

contextBridge.exposeInMainWorld('api', api);
