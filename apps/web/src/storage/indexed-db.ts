export type MockFileRecord = {
  path: string;
  content: string;
  updatedAt: string;
};

const DB_VERSION = 1;
const MAX_FILE_BYTES = 512 * 1024;

export function createIndexedDbStore(databaseName = 'opencreator.web.v1') {
  return {
    async saveFile(file: MockFileRecord): Promise<void> {
      if (new TextEncoder().encode(file.content).byteLength > MAX_FILE_BYTES) {
        throw new Error('MOCK_FILE_TOO_LARGE');
      }

      const db = await openDb(databaseName);
      try {
        const transaction = db.transaction('files', 'readwrite');
        const store = transaction.objectStore('files');
        await requestToPromise(store.put(file));
        await transactionToPromise(transaction);
      } finally {
        db.close();
      }
    },
    async getFile(path: string): Promise<MockFileRecord | undefined> {
      const db = await openDb(databaseName);
      try {
        const transaction = db.transaction('files', 'readonly');
        const store = transaction.objectStore('files');
        const value = await requestToPromise(store.get(path));
        await transactionToPromise(transaction);
        return value as MockFileRecord | undefined;
      } finally {
        db.close();
      }
    }
  };
}

function openDb(databaseName: string): Promise<IDBDatabase> {
  const request = indexedDB.open(databaseName, DB_VERSION);
  request.onupgradeneeded = () => {
    const db = request.result;
    if (!db.objectStoreNames.contains('files')) db.createObjectStore('files', { keyPath: 'path' });
    if (!db.objectStoreNames.contains('mockTimeline')) db.createObjectStore('mockTimeline', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('mockApprovals')) db.createObjectStore('mockApprovals', { keyPath: 'id' });
    if (!db.objectStoreNames.contains('mockChanges')) db.createObjectStore('mockChanges', { keyPath: 'id' });
  };
  return requestToPromise(request);
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

function transactionToPromise(transaction: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onabort = () => reject(transaction.error ?? new Error('IndexedDB transaction aborted'));
    transaction.onerror = () => reject(transaction.error ?? new Error('IndexedDB transaction failed'));
  });
}
