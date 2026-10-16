import test from "node:test";
import assert from "node:assert/strict";
import {
  DraftController,
  type DraftStorage,
  type DraftTransport,
} from "../src/lib/autosave";
import { ApiError, type LocalDraftRecord } from "../src/lib/api";
import type { Draft, DraftData, DraftSave } from "../shared/app";

const files = {
  "main.c": '#include <stdio.h>\nint main(void) { puts("start"); return 0; }\n',
};
const data: DraftData = {
  files,
  stdin: "",
  activeFile: "main.c",
  step: 0,
  cursor: { anchor: 0, head: 0 },
  scrollAnchor: 0,
  paneSize: 48,
  notes: "",
  bookmark: false,
};
const base: Draft = {
  exerciseId: "first-edit",
  contentVersion: 1,
  revision: 1,
  data,
  updatedAt: new Date(0).toISOString(),
};

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

function harness(
  overrides: Partial<DraftTransport> = {},
  online: () => boolean = () => true,
) {
  const writes: Parameters<DraftStorage["write"]>[0][] = [];
  const saves: DraftSave[] = [];
  const archives: { draft: Draft; reason: string }[] = [];
  let current = structuredClone(base);
  const storage: DraftStorage = {
    load: async () => null,
    write: async (record) => {
      writes.push(structuredClone(record));
    },
    acknowledge: async () => undefined,
    archive: async (draft, reason) => {
      archives.push({ draft: structuredClone(draft), reason });
    },
  };
  const transport: DraftTransport = {
    load: async () => current,
    save: async (save) => {
      saves.push(structuredClone(save));
      assert.equal(save.revision, current.revision);
      current = {
        ...current,
        revision: current.revision + 1,
        data: structuredClone(save.data),
        updatedAt: new Date().toISOString(),
      };
      return current;
    },
    resolve: async () => {
      throw new Error("No conflict");
    },
    ...overrides,
  };
  const controller = new DraftController({
    exerciseId: base.exerciseId,
    contentVersion: 1,
    starter: files,
    storage,
    transport,
    online,
    debounceMs: 60_000,
    maxWaitMs: 60_000,
    retryMs: 60_000,
  });
  return { controller, writes, saves, archives, storage, transport };
}

test("draft edits are coalesced while preserving every source and resume field", async () => {
  const h = harness();
  await h.controller.start();
  h.controller.update({ files: { "main.c": "first" }, stdin: "2\n", step: 2 });
  h.controller.update({
    files: { "main.c": "second", "stats.h": "int sum(void);" },
    activeFile: "stats.h",
  });
  h.controller.update({
    notes: "Check empty input",
    bookmark: true,
    paneSize: 63,
    cursor: { anchor: 2, head: 4 },
  });
  await h.controller.flush();
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].data.files["main.c"], "second");
  assert.equal(h.saves[0].data.stdin, "2\n");
  assert.equal(h.saves[0].data.activeFile, "stats.h");
  assert.equal(h.saves[0].data.step, 2);
  assert.equal(h.saves[0].data.notes, "Check empty input");
  assert.deepEqual(h.saves[0].data.cursor, { anchor: 2, head: 4 });
  assert.equal(h.controller.getSnapshot().status, "Saved to account");
  assert.equal(h.writes.at(-1)?.pending, false);
  h.controller.dispose();
});

test("a slow earlier response cannot overwrite a newer editor value", async () => {
  const first = deferred<Draft>();
  const saves: DraftSave[] = [];
  const h = harness({
    save: async (save) => {
      saves.push(structuredClone(save));
      if (saves.length === 1) return first.promise;
      return { ...base, revision: 3, data: save.data };
    },
  });
  await h.controller.start();
  h.controller.update({ files: { "main.c": "version one" } });
  const flushing = h.controller.flush();
  await new Promise((resolve) => setImmediate(resolve));
  h.controller.update({ files: { "main.c": "version two" }, step: 3 });
  first.resolve({ ...base, revision: 2, data: saves[0].data });
  await flushing;
  assert.equal(saves.length, 2);
  assert.equal(saves[1].revision, 2);
  assert.equal(saves[1].data.files["main.c"], "version two");
  assert.equal(h.controller.getSnapshot().data?.files["main.c"], "version two");
  assert.equal(h.controller.getSnapshot().draft?.revision, 3);
  h.controller.dispose();
});

test("unknown network outcomes reuse the mutation ID before newer edits are sent", async () => {
  const saves: DraftSave[] = [];
  const h = harness({
    save: async (save) => {
      saves.push(structuredClone(save));
      if (saves.length === 1) throw new TypeError("Network request lost");
      return { ...base, revision: saves.length === 2 ? 2 : 3, data: save.data };
    },
  });
  await h.controller.start();
  h.controller.update({ notes: "original uncertain save" });
  await h.controller.flush();
  assert.equal(h.controller.getSnapshot().status, "Save failed — retry");
  h.controller.update({ notes: "newer edit" });
  await h.controller.flush();
  assert.equal(saves.length, 3);
  assert.equal(saves[0].mutationId, saves[1].mutationId);
  assert.deepEqual(saves[0], saves[1]);
  assert.notEqual(saves[2].mutationId, saves[1].mutationId);
  assert.equal(saves[2].data.notes, "newer edit");
  assert.equal(saves[2].revision, 2);
  h.controller.dispose();
});

test("offline edits only use device recovery and sync once on reconnect", async () => {
  let connected = false;
  const h = harness({}, () => connected);
  await h.controller.start();
  h.controller.update({ files: { "main.c": "offline work" }, stdin: "7" });
  await h.controller.flush();
  assert.equal(h.saves.length, 0);
  assert.equal(h.writes.at(-1)?.draft.data.files["main.c"], "offline work");
  assert.equal(h.controller.getSnapshot().status, "Saved on this device");
  connected = true;
  await h.controller.flush();
  await h.controller.flush();
  assert.equal(h.saves.length, 1);
  assert.equal(h.controller.getSnapshot().status, "Saved to account");
  h.controller.dispose();
});

test("a genuine server revision conflict preserves both versions until explicit resolution", async () => {
  const remote = {
    ...base,
    revision: 4,
    data: { ...data, notes: "other device" },
  };
  let calls = 0;
  const resolutions: unknown[] = [];
  const h = harness({
    save: async (save) => {
      calls += 1;
      throw new ApiError(409, {
        error: "Draft conflict",
        conflict: {
          id: "conflict-1",
          local: { ...base, data: save.data },
          remote,
        },
      });
    },
    resolve: async (id, choice, revision) => {
      resolutions.push({ id, choice, revision });
      return { ...remote, revision: 5 };
    },
  });
  await h.controller.start();
  h.controller.update({ notes: "this device" });
  await h.controller.flush();
  await h.controller.flush();
  assert.equal(calls, 1);
  assert.equal(
    h.controller.getSnapshot().status,
    "Conflict — choose a version",
  );
  assert.equal(
    h.controller.getSnapshot().conflict?.local.data.notes,
    "this device",
  );
  assert.equal(
    h.controller.getSnapshot().conflict?.remote.data.notes,
    "other device",
  );
  await h.controller.resolve("remote");
  assert.deepEqual(resolutions, [
    { id: "conflict-1", choice: "remote", revision: 4 },
  ]);
  assert.equal(h.controller.getSnapshot().data?.notes, "other device");
  assert.equal(h.controller.getSnapshot().status, "Saved to account");
  h.controller.dispose();
});

test("an edit after a conflict is retained when choosing the local version", async () => {
  let calls = 0;
  const saves: DraftSave[] = [];
  const h = harness({
    save: async (save) => {
      saves.push(save);
      if (++calls === 1)
        throw new ApiError(409, {
          error: "Draft conflict",
          conflict: {
            id: "conflict-1",
            local: { ...base, data: save.data },
            remote: { ...base, revision: 2 },
          },
        });
      return { ...base, revision: 4, data: save.data };
    },
    resolve: async () => ({ ...base, revision: 3, data: saves[0].data }),
  });
  await h.controller.start();
  h.controller.update({ notes: "submitted conflict" });
  await h.controller.flush();
  h.controller.update({ notes: "kept editing during conflict" });
  await h.controller.resolve("local");
  assert.equal(saves.length, 2);
  assert.equal(saves[1].revision, 3);
  assert.equal(saves[1].data.notes, "kept editing during conflict");
  assert.equal(
    h.controller.getSnapshot().data?.notes,
    "kept editing during conflict",
  );
  h.controller.dispose();
});

test("local writes are strictly serialized even when a storage operation is slow", async () => {
  const gate = deferred<void>();
  const h = harness();
  let active = 0;
  let maximum = 0;
  const seen: string[] = [];
  h.storage.write = async (record) => {
    active += 1;
    maximum = Math.max(maximum, active);
    if (record.draft.data.notes === "first") await gate.promise;
    seen.push(record.draft.data.notes);
    active -= 1;
  };
  await h.controller.start();
  h.controller.update({ notes: "first" });
  h.controller.update({ notes: "last" });
  const flush = h.controller.flush();
  await new Promise((resolve) => setImmediate(resolve));
  gate.resolve();
  await flush;
  assert.equal(maximum, 1);
  assert.equal(seen.at(-1), "last");
  assert.ok(seen.indexOf("first") < seen.lastIndexOf("last"));
  h.controller.dispose();
});

test("a pending recovery keeps its old base revision so a newer account draft cannot be overwritten", async () => {
  const h = harness();
  h.transport.load = async () => ({
    ...base,
    revision: 8,
    data: { ...data, notes: "remote newer" },
  });
  h.storage.load = async (): Promise<LocalDraftRecord> => ({
    key: "owner:old-tab:first-edit",
    ownerId: "owner",
    tabId: "old-tab",
    exerciseId: base.exerciseId,
    draft: {
      ...base,
      revision: 2,
      data: { ...data, notes: "unacknowledged recovery" },
    },
    pending: true,
    sequence: 7,
    touchedAt: Date.now(),
  });
  h.transport.save = async (save) => {
    h.saves.push(save);
    throw new ApiError(409, {
      error: "Draft conflict",
      conflict: {
        id: "new-conflict",
        local: { ...base, data: save.data },
        remote: {
          ...base,
          revision: 8,
          data: { ...data, notes: "remote newer" },
        },
      },
    });
  };
  await h.controller.start();
  await h.controller.flush();
  assert.equal(h.saves[0].revision, 2);
  assert.equal(h.saves[0].data.notes, "unacknowledged recovery");
  assert.equal(
    h.controller.getSnapshot().conflict?.remote.data.notes,
    "remote newer",
  );
  h.controller.dispose();
});

test("an unauthenticated load does not display cached account drafts", async () => {
  const h = harness({
    load: async () => {
      throw new ApiError(401, { error: "Sign in" });
    },
  });
  h.storage.load = async (): Promise<LocalDraftRecord> => ({
    key: "owner:tab:first-edit",
    ownerId: "owner",
    tabId: "tab",
    exerciseId: base.exerciseId,
    draft: base,
    pending: true,
    sequence: 1,
    touchedAt: Date.now(),
  });
  await h.controller.start();
  assert.equal(h.controller.getSnapshot().data, null);
  assert.equal(h.controller.getSnapshot().status, "Save failed — retry");
  assert.equal(h.writes.length, 0);
  h.controller.dispose();
});

test("a new draft never claims an account save before an acknowledgement", async () => {
  const gate = deferred<Draft>();
  const statuses: string[] = [];
  const h = harness({ load: async () => null, save: async () => gate.promise });
  h.controller.subscribe((snapshot) => statuses.push(snapshot.status));
  await h.controller.start();
  assert.ok(!statuses.includes("Saved to account"));
  const flush = h.controller.flush();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(h.controller.getSnapshot().status, "Syncing");
  assert.ok(!statuses.includes("Saved to account"));
  gate.resolve({ ...base, revision: 1 });
  await flush;
  assert.equal(h.controller.getSnapshot().status, "Saved to account");
  h.controller.dispose();
});

test("the maximum save wait remains bounded during continuous edits", async () => {
  const h = harness();
  const checked = deferred<void>();
  const controller = new DraftController({
    exerciseId: base.exerciseId,
    contentVersion: 1,
    starter: files,
    storage: h.storage,
    transport: {
      ...h.transport,
      save: async (save) => {
        const saved = await h.transport.save(save);
        checked.resolve();
        return saved;
      },
    },
    debounceMs: 1000,
    maxWaitMs: 25,
  });
  await controller.start();
  controller.update({ notes: "first" });
  const edits = setInterval(
    () => controller.update({ notes: String(Date.now()) }),
    5,
  );
  const timeout = setTimeout(
    () => checked.reject(new Error("Save exceeded its bounded wait")),
    750,
  );
  try {
    await checked.promise;
    assert.ok(h.saves.length >= 1);
  } finally {
    clearInterval(edits);
    clearTimeout(timeout);
    controller.dispose();
    h.controller.dispose();
  }
});

test("an offline pre-reset archive preserves files and resume state without changing the draft", async () => {
  const h = harness({}, () => false);
  await h.controller.start();
  h.controller.update({
    files: { "main.c": "unsynced main", "data.h": "unsynced header" },
    stdin: "45\n",
    activeFile: "data.h",
    step: 3,
    notes: "return here",
    cursor: { anchor: 4, head: 8 },
    scrollAnchor: 160,
    paneSize: 61,
  });
  const beforeReset = structuredClone(h.controller.getSnapshot().data);
  await h.controller.archiveLocal();
  assert.equal(h.archives.length, 1);
  assert.equal(h.archives[0].reason, "before reset");
  assert.deepEqual(h.archives[0].draft.data, beforeReset);
  assert.deepEqual(h.controller.getSnapshot().data, beforeReset);
  h.controller.update({
    files,
    activeFile: "main.c",
    cursor: { anchor: 0, head: 0 },
  });
  await h.controller.flush();
  assert.equal(h.archives[0].draft.data.files["main.c"], "unsynced main");
  assert.equal(h.archives[0].draft.data.files["data.h"], "unsynced header");
  assert.equal(h.saves.length, 0);
  h.controller.dispose();
});

test("an unsuccessful recovery archive rejects so the reset action can keep the original code", async () => {
  const h = harness();
  h.storage.archive = async () => {
    throw new Error("Device storage full");
  };
  await h.controller.start();
  h.controller.update({ files: { "main.c": "valuable work" } });
  await assert.rejects(h.controller.archiveLocal(), /Device storage full/);
  assert.equal(
    h.controller.getSnapshot().data?.files["main.c"],
    "valuable work",
  );
  assert.equal(h.controller.getSnapshot().status, "Save failed — retry");
  h.controller.dispose();
});

test("content-version retry requires an explicit action and keeps an archived old-version draft", async () => {
  const h = harness();
  const saves: DraftSave[] = [];
  const controller = new DraftController({
    exerciseId: base.exerciseId,
    contentVersion: 2,
    starter: { "main.c": "new starter, must not overwrite work" },
    storage: h.storage,
    transport: {
      ...h.transport,
      save: async (save) => {
        saves.push(structuredClone(save));
        if (save.contentVersion !== 2)
          throw new ApiError(422, {
            error: "Updated exercise. Retry current version.",
          });
        return { ...base, revision: 2, contentVersion: 2, data: save.data };
      },
    },
    debounceMs: 60_000,
    maxWaitMs: 60_000,
  });
  await controller.start();
  assert.equal(controller.getSnapshot().draft?.contentVersion, 1);
  assert.equal(controller.getSnapshot().data?.files["main.c"], files["main.c"]);
  controller.update({
    files: { "main.c": "older lesson, latest edit" },
    notes: "preserve this too",
  });
  await controller.retryCurrentVersion();
  assert.equal(saves.length, 2);
  assert.equal(saves[0].contentVersion, 1);
  assert.equal(saves[1].contentVersion, 2);
  assert.notEqual(saves[0].mutationId, saves[1].mutationId);
  assert.equal(saves[1].data.files["main.c"], "older lesson, latest edit");
  assert.equal(saves[1].data.notes, "preserve this too");
  assert.equal(h.archives[0].reason, "before content-version retry");
  assert.equal(h.archives[0].draft.contentVersion, 1);
  assert.equal(
    h.archives[0].draft.data.files["main.c"],
    "older lesson, latest edit",
  );
  assert.equal(controller.getSnapshot().draft?.contentVersion, 2);
  assert.equal(controller.getSnapshot().status, "Saved to account");
  controller.dispose();
  h.controller.dispose();
});
