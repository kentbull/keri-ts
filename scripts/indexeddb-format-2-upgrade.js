/**
 * Upgrade browser keri-ts IndexedDB databases from format 1 to format 2.
 *
 * keri-ts refuses a format-1 database (name starting `keri-ts:`, version 1). Run `migrate()` in each origin that
 * holds one, before upgrading the code: paste this file into the devtools console, or import it as a module, then
 *   await keriIndexedDbFormat2.migrate();            // rewrite every format-1 database as format 2
 *   await keriIndexedDbFormat2.deleteKeriDatabases(); // or delete every keri-ts database, then re-create or restore
 * Close every tab and wallet of the origin first, or the delete stays blocked.
 *
 * Safari/WebKit caveat: WebKit's on-disk IndexedDB mis-reads the binary parts of format-1 array keys, so keys read
 * here may already be corrupted and migration cannot repair them. On Safari delete and re-create or restore instead.
 */
(() => {
  const hex = (buffer) => Array.from(new Uint8Array(buffer), (byte) => byte.toString(16).padStart(2, "0")).join("");
  const request = (req) =>
    new Promise((resolve, reject) => {
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error("blocked by another open connection; close other tabs"));
    });
  const complete = (tx) =>
    new Promise((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = tx.onabort = () => reject(tx.error);
    });

  async function names(factory, wanted) {
    const all = await factory.databases();
    return all.filter(({ name, version }) => name?.startsWith("keri-ts:") && (!wanted || version === 1)).map((d) =>
      d.name
    );
  }

  /** Read every row and meta record of a format-1 database. */
  async function read(factory, name) {
    const db = await request(factory.open(name));
    try {
      const tx = db.transaction(["rows", "meta"], "readonly");
      const [keys, values, metaKeys, metaValues] = await Promise.all([
        request(tx.objectStore("rows").getAllKeys()),
        request(tx.objectStore("rows").getAll()),
        request(tx.objectStore("meta").getAllKeys()),
        request(tx.objectStore("meta").getAll()),
      ]);
      await complete(tx);
      return { keys, values, metaKeys, metaValues };
    } finally {
      db.close();
    }
  }

  /** Rewrite one format-1 database as format 2; returns its table and row counts. */
  async function migrateOne(factory, name) {
    const { keys, values, metaKeys, metaValues } = await read(factory, name);
    const dupsort = new Map();
    let version = null;
    metaKeys.forEach((key, index) => {
      if (key === "version") version = metaValues[index];
      else dupsort.set(String(key).slice("table:".length), metaValues[index] === true);
    });
    await request(factory.deleteDatabase(name));
    const open = factory.open(name, 2);
    open.onupgradeneeded = () => {
      open.result.createObjectStore("rows");
      open.result.createObjectStore("meta");
    };
    const db = await request(open);
    try {
      const tx = db.transaction(["rows", "meta"], "readwrite", { durability: "strict" });
      const rows = tx.objectStore("rows");
      const meta = tx.objectStore("meta");
      for (const [table, isDupsort] of dupsort) {
        meta.put({ kind: "table", name: table, dupsort: isDupsort }, `table:${table}`);
      }
      if (version !== null) meta.put({ kind: "version", version }, "version");
      keys.forEach(([table, key, dup], index) => {
        const value = dup.byteLength > 0 ? dup : values[index];
        rows.put({ t: table, k: key, v: value }, `${hex(key)}.${dup.byteLength > 0 ? hex(dup) : ""}.${table}`);
      });
      await complete(tx);
    } finally {
      db.close();
    }
    return { tables: dupsort.size, rows: keys.length };
  }

  /** Migrate every `keri-ts:` database at version 1. */
  async function migrate(factory = globalThis.indexedDB) {
    const migrated = [];
    for (const name of await names(factory, true)) {
      const summary = await migrateOne(factory, name);
      console.log(`migrated ${name}: ${summary.tables} tables, ${summary.rows} rows`);
      migrated.push({ name, ...summary });
    }
    if (migrated.length === 0) console.log("no format 1 keri-ts databases found");
    return migrated;
  }

  /** Delete every `keri-ts:` database, whatever its version. */
  async function deleteKeriDatabases(factory = globalThis.indexedDB) {
    const deleted = await names(factory, false);
    for (const name of deleted) {
      await request(factory.deleteDatabase(name));
      console.log(`deleted ${name}`);
    }
    return deleted;
  }

  globalThis.keriIndexedDbFormat2 = { migrate, deleteKeriDatabases };
})();
