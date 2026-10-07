/** Entry point for the Electron utilityProcess hosting the sync engine. */
import type { MainToSync, SyncToMain } from '@app/shared';
import { SyncService } from './service';

declare const process: NodeJS.Process & {
  parentPort: {
    on(event: 'message', cb: (e: { data: MainToSync }) => void): void;
    postMessage(msg: SyncToMain): void;
  };
};

const post = (msg: SyncToMain) => process.parentPort.postMessage(msg);
const service = new SyncService(post);

process.parentPort.on('message', (e) => {
  const msg = e.data;
  switch (msg.kind) {
    case 'init':
      try {
        service.init(msg.dbPath, msg.attachmentsDir);
      } catch (err) {
        console.error('[sync] init failed', err);
        // Exit non-zero so the main-process supervisor restarts us; a throw here
        // would be swallowed by the uncaughtException handler below, leaving a
        // live process with no database.
        process.exit(1);
      }
      break;
    case 'account-added':
    case 'credentials':
      service.provideCredentials(msg.accountId, msg.password);
      break;
    case 'power':
      service.setPower(msg.state);
      break;
    case 'query':
      void service
        .handleQuery(msg.channel, msg.args)
        .then((result) => post({ kind: 'query-result', id: msg.id, result }))
        .catch((err: unknown) =>
          post({
            kind: 'query-result',
            id: msg.id,
            result: null,
            error: err instanceof Error ? err.message : String(err),
          }),
        );
      break;
    case 'enqueue-task': {
      const taskId = service.enqueue(msg.task);
      post({ kind: 'task-enqueued', id: msg.id, taskId });
      break;
    }
  }
});

process.on('uncaughtException', (err) => {
  console.error('[sync] uncaught', err);
});
process.on('unhandledRejection', (err) => {
  console.error('[sync] unhandled rejection', err);
});
