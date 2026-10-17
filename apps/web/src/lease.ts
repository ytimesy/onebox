// Short read/write transactions serialize fallback ownership and every save.
// localStorage remains the attempt format; IndexedDB contains no game results.
type Owner = { owner: string; token: string; until: number };
export class TransactionLease {
  private db: IDBDatabase;
  private token = "";
  constructor(
    db: IDBDatabase,
    private id: string,
    private owner: string,
  ) {
    this.db = db;
  }
  static async open(id: string, owner: string) {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open("onebox-ownership-v1", 1);
      let finished = false;
      const deadline = setTimeout(() => {
        finished = true;
        reject(Error("Ownership unavailable"));
      }, 1500);
      const fail = () => {
        finished = true;
        clearTimeout(deadline);
        reject(Error("Ownership unavailable"));
      };
      request.onupgradeneeded = () =>
        request.result.createObjectStore("leases");
      request.onerror = fail;
      request.onblocked = fail;
      request.onsuccess = () => {
        clearTimeout(deadline);
        if (finished) request.result.close();
        else resolve(request.result);
      };
    });
    db.onversionchange = () => db.close();
    return new TransactionLease(db, id, owner);
  }
  private transact<T>(work: (store: IDBObjectStore, current?: Owner) => T) {
    return new Promise<T>((resolve, reject) => {
      const tx = this.db.transaction("leases", "readwrite"),
        store = tx.objectStore("leases"),
        get = store.get(this.id);
      let result: T;
      tx.oncomplete = () => resolve(result);
      tx.onabort = tx.onerror = () =>
        reject(Error("Ownership transaction failed"));
      get.onsuccess = () => {
        try {
          result = work(store, get.result);
        } catch {
          tx.abort();
        }
      };
    });
  }
  claim(takeover = false) {
    return this.transact((store, old) => {
      if (!takeover && old && old.until > Date.now()) return false;
      this.token = crypto.randomUUID();
      store.put(
        { owner: this.owner, token: this.token, until: Date.now() + 4000 },
        this.id,
      );
      return true;
    });
  }
  write(work: () => boolean) {
    const token = this.token;
    return this.transact((store, old) => {
      if (
        !token ||
        old?.owner !== this.owner ||
        old.token !== token ||
        old.until <= Date.now()
      )
        return false;
      const result = work();
      if (result) store.put({ ...old, until: Date.now() + 4000 }, this.id);
      return result;
    });
  }
  async release() {
    const token = this.token;
    this.token = "";
    try {
      await this.transact((store, old) => {
        if (old?.owner === this.owner && old.token === token)
          store.delete(this.id);
      });
    } finally {
      this.db.close();
    }
  }
  clear(work: () => void) {
    return this.transact((store) => {
      store.clear();
      work();
    });
  }
  mutate<T>(work: () => T) {
    return this.transact(() => work());
  }
  close() {
    this.db.close();
  }
}
export async function withStorageMutation<T>(work: () => T): Promise<T> {
  if (navigator.locks)
    return navigator.locks.request("onebox-storage-v1", work);
  const mutex = await TransactionLease.open("storage", crypto.randomUUID());
  try {
    return await mutex.mutate(work);
  } finally {
    mutex.close();
  }
}
