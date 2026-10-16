import { useCallback, useEffect, useState } from "react";
import type {
  Draft,
  DraftConflict,
  DraftData,
  DraftSave,
} from "../../shared/app";
import type { SourceFiles } from "../../shared/content";
import {
  api,
  ApiError,
  getLocalOwner,
  recoveryStore,
  subscribeLocalOwner,
  type LocalDraftRecord,
} from "./api";

export type SaveStatus =
  | "Saving locally"
  | "Saved on this device"
  | "Syncing"
  | "Saved to account"
  | "Save failed — retry"
  | "Conflict — choose a version";

export interface DraftSnapshot {
  draft: Draft | null;
  data: DraftData | null;
  status: SaveStatus;
  conflict: DraftConflict | null;
  error: string | null;
}

export interface DraftStorage {
  load(): Promise<LocalDraftRecord | null>;
  write(
    record: Omit<LocalDraftRecord, "key" | "ownerId" | "tabId" | "exerciseId">,
  ): Promise<void>;
  acknowledge(data: DraftData): Promise<void>;
  archive(draft: Draft, reason: string): Promise<void>;
}

export interface DraftTransport {
  load(): Promise<Draft | null>;
  save(save: DraftSave): Promise<Draft>;
  resolve(
    conflictId: string,
    choice: "local" | "remote",
    revision: number,
  ): Promise<Draft>;
}

interface ControllerOptions {
  exerciseId: string;
  contentVersion: number;
  starter: SourceFiles;
  storage: DraftStorage;
  transport: DraftTransport;
  online?: () => boolean;
  debounceMs?: number;
  maxWaitMs?: number;
  retryMs?: number;
}

function freshData(files: SourceFiles): DraftData {
  return {
    files: structuredClone(files),
    stdin: "",
    activeFile: Object.keys(files)[0] ?? "main.c",
    step: 0,
    cursor: { anchor: 0, head: 0 },
    scrollAnchor: 0,
    paneSize: 48,
    notes: "",
    bookmark: false,
  };
}

function readConflict(error: unknown): DraftConflict | null {
  if (!(error instanceof ApiError) || error.status !== 409) return null;
  const detail = error.detail;
  if (!detail || typeof detail !== "object" || !("conflict" in detail))
    return null;
  const conflict = detail.conflict as DraftConflict;
  return conflict?.id && conflict.local?.data && conflict.remote?.data
    ? conflict
    : null;
}

function message(error: unknown) {
  return error instanceof Error
    ? error.message
    : "Saving failed. Your current code remains in the editor.";
}

/**
 * One serialized account writer per open draft. Edits never adopt older response data.
 * An uncertain network result retries the same mutation before sending newer edits.
 */
export class DraftController {
  private snapshot: DraftSnapshot = {
    draft: null,
    data: null,
    status: "Saving locally",
    conflict: null,
    error: null,
  };
  private listeners = new Set<(snapshot: DraftSnapshot) => void>();
  private sequence = 0;
  private acknowledged = 0;
  private localTail: Promise<void> = Promise.resolve();
  private syncPromise: Promise<void> | null = null;
  private request: { save: DraftSave; sequence: number } | null = null;
  private debounceTimer: ReturnType<typeof setTimeout> | undefined;
  private maxWaitTimer: ReturnType<typeof setTimeout> | undefined;
  private retryTimer: ReturnType<typeof setTimeout> | undefined;
  private retryCount = 0;
  private disposed = false;
  private initialized = false;
  private resolving = false;
  private localFailed = false;
  private accountConfirmed = false;
  private versionNote: string | null = null;

  constructor(private options: ControllerOptions) {}

  getSnapshot = () => this.snapshot;

  subscribe = (listener: (snapshot: DraftSnapshot) => void) => {
    this.listeners.add(listener);
    listener(this.snapshot);
    return () => {
      this.listeners.delete(listener);
    };
  };

  private publish(patch: Partial<DraftSnapshot>) {
    this.snapshot = { ...this.snapshot, ...patch };
    if (!this.disposed)
      this.listeners.forEach((listener) => listener(this.snapshot));
  }

  private online() {
    return this.options.online?.() ?? true;
  }

  async start() {
    if (this.initialized || this.disposed) return;
    this.initialized = true;
    const [localResult, remoteResult] = await Promise.allSettled([
      this.options.storage.load(),
      this.options.transport.load(),
    ]);
    if (this.disposed) return;
    // A denied account request never reveals a previous owner's device recovery.
    if (
      remoteResult.status === "rejected" &&
      remoteResult.reason instanceof ApiError &&
      [401, 403].includes(remoteResult.reason.status)
    ) {
      this.publish({
        status: "Save failed — retry",
        error: message(remoteResult.reason),
      });
      return;
    }
    const local = localResult.status === "fulfilled" ? localResult.value : null;
    const remote =
      remoteResult.status === "fulfilled" ? remoteResult.value : null;
    this.accountConfirmed = remote !== null;
    let draft = remote ??
      local?.draft ?? {
        exerciseId: this.options.exerciseId,
        contentVersion: this.options.contentVersion,
        revision: 0,
        data: freshData(this.options.starter),
        updatedAt: new Date().toISOString(),
      };
    const pendingLocal =
      local?.pending &&
      JSON.stringify(local.draft.data) !== JSON.stringify(remote?.data);
    if (pendingLocal) draft = local.draft;
    this.sequence = pendingLocal ? Math.max(1, local.sequence) : 0;
    this.acknowledged = 0;
    if (draft.contentVersion !== this.options.contentVersion) {
      this.versionNote = `Your draft uses exercise version ${draft.contentVersion}; this lesson is now version ${this.options.contentVersion}. Your code has been preserved. Review the current instructions before checking it.`;
    }
    this.publish({
      draft: structuredClone(draft),
      data: structuredClone(draft.data),
      conflict: pendingLocal ? (local.conflict ?? null) : null,
      status: pendingLocal
        ? local.conflict
          ? "Conflict — choose a version"
          : "Saved on this device"
        : remote
          ? "Saved to account"
          : local
            ? "Saved on this device"
            : "Saving locally",
      error:
        this.versionNote ??
        (remoteResult.status === "rejected"
          ? "Account connection unavailable. You can keep drafting on this device."
          : null),
    });
    if (pendingLocal && local.mutation) {
      this.request = {
        save: structuredClone(local.mutation),
        sequence:
          JSON.stringify(local.mutation.data) === JSON.stringify(draft.data)
            ? this.sequence
            : this.sequence - 1,
      };
    }
    // A starter is also a real saved draft, so its step and workspace can be resumed.
    if (!remote && !pendingLocal) this.sequence = 1;
    if (remote && local?.pending && !pendingLocal) {
      void this.options.storage.acknowledge(remote.data).catch(() => undefined);
    }
    this.persist();
    if (this.sequence > this.acknowledged && !this.snapshot.conflict)
      this.schedule();
  }

  update = (patch: Partial<DraftData>) => {
    if (
      !this.snapshot.data ||
      !this.snapshot.draft ||
      this.disposed ||
      this.resolving
    )
      return;
    const next = { ...this.snapshot.data, ...structuredClone(patch) };
    if (JSON.stringify(next) === JSON.stringify(this.snapshot.data)) return;
    this.sequence += 1;
    const draft = { ...this.snapshot.draft, data: next };
    this.publish({
      draft,
      data: next,
      status: this.snapshot.conflict
        ? "Conflict — choose a version"
        : "Saving locally",
      conflict: this.snapshot.conflict
        ? { ...this.snapshot.conflict, local: draft }
        : null,
      error: this.versionNote,
    });
    this.persist();
    this.schedule();
  };

  private persist() {
    if (!this.snapshot.draft) return;
    const sequence = this.sequence;
    const record = {
      draft: structuredClone(this.snapshot.draft),
      pending: sequence > this.acknowledged,
      sequence,
      touchedAt: Date.now(),
      mutation: this.request ? structuredClone(this.request.save) : undefined,
      conflict: this.snapshot.conflict
        ? structuredClone(this.snapshot.conflict)
        : undefined,
    };
    // Capture every edit synchronously, then serialize IndexedDB writes in edit order.
    this.localTail = this.localTail.then(async () => {
      try {
        await this.options.storage.write(record);
        this.localFailed = false;
        if (
          sequence === this.sequence &&
          !this.syncPromise &&
          !this.snapshot.conflict
        ) {
          this.publish({
            status:
              sequence > this.acknowledged || !this.accountConfirmed
                ? "Saved on this device"
                : "Saved to account",
          });
        }
      } catch (error) {
        this.localFailed = true;
        this.publish({
          status: "Save failed — retry",
          error: `Device recovery failed: ${message(error)} Account saving will still be attempted.`,
        });
      }
    });
  }

  private schedule() {
    if (this.disposed || this.snapshot.conflict || this.resolving) return;
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      void this.flush();
    }, this.options.debounceMs ?? 600);
    this.maxWaitTimer ??= setTimeout(() => {
      void this.flush();
    }, this.options.maxWaitMs ?? 2000);
  }

  private clearSaveTimers() {
    if (this.debounceTimer) clearTimeout(this.debounceTimer);
    if (this.maxWaitTimer) clearTimeout(this.maxWaitTimer);
    this.debounceTimer = undefined;
    this.maxWaitTimer = undefined;
  }

  private retry() {
    if (this.disposed || this.snapshot.conflict || this.retryTimer) return;
    const delay = Math.min(
      15_000,
      (this.options.retryMs ?? 1000) * 2 ** Math.min(this.retryCount++, 4),
    );
    this.retryTimer = setTimeout(() => {
      this.retryTimer = undefined;
      void this.flush();
    }, delay);
  }

  private async sync() {
    while (
      !this.disposed &&
      !this.snapshot.conflict &&
      this.snapshot.draft &&
      this.snapshot.data &&
      this.sequence > this.acknowledged
    ) {
      if (!this.online()) {
        this.publish({
          status: this.localFailed
            ? "Save failed — retry"
            : "Saved on this device",
          error:
            "Offline drafting is available. Running and checking require the server.",
        });
        this.retry();
        return;
      }
      this.request ??= {
        sequence: this.sequence,
        save: {
          revision: this.snapshot.draft.revision,
          contentVersion: this.snapshot.draft.contentVersion,
          mutationId: crypto.randomUUID(),
          data: structuredClone(this.snapshot.data),
        },
      };
      const request = this.request;
      // Persist the idempotency key before sending an uncertain network request.
      this.persist();
      await this.localTail;
      if (this.disposed) return;
      this.publish({ status: "Syncing", error: this.versionNote });
      try {
        const saved = await this.options.transport.save(request.save);
        this.accountConfirmed = true;
        this.acknowledged = Math.max(this.acknowledged, request.sequence);
        this.request = null;
        this.retryCount = 0;
        const data =
          this.sequence > request.sequence ? this.snapshot.data : saved.data;
        this.publish({
          draft: { ...saved, data: structuredClone(data) },
          data: structuredClone(data),
          status:
            this.sequence > this.acknowledged
              ? "Saving locally"
              : "Saved to account",
          error: this.versionNote,
        });
        try {
          await this.options.storage.acknowledge(request.save.data);
        } catch {
          /* The accepted server revision is authoritative even if device bookkeeping fails. */
        }
        this.persist();
        await this.localTail;
      } catch (error) {
        const conflict = readConflict(error);
        if (conflict) {
          this.request = null;
          this.publish({
            conflict: {
              ...conflict,
              local: {
                ...conflict.local,
                data: structuredClone(this.snapshot.data),
              },
            },
            status: "Conflict — choose a version",
            error:
              "This draft also changed in another tab or device. Both versions are preserved. Choose which version to continue with.",
          });
          this.persist();
          await this.localTail;
        } else {
          this.publish({
            status: this.online()
              ? "Save failed — retry"
              : "Saved on this device",
            error: message(error),
          });
          // Keep request/mutationId: a dropped response may have already committed the save.
          if (!(
            error instanceof ApiError &&
            [400, 401, 403, 413, 422].includes(error.status)
          ))
            this.retry();
        }
        return;
      }
    }
  }

  flush = async () => {
    this.clearSaveTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.retryTimer = undefined;
    await this.localTail;
    if (this.snapshot.conflict || this.resolving || this.disposed) return;
    if (this.syncPromise) return this.syncPromise;
    this.syncPromise = this.sync().finally(() => {
      this.syncPromise = null;
    });
    await this.syncPromise;
  };

  resolve = async (choice: "local" | "remote") => {
    const conflict = this.snapshot.conflict;
    if (!conflict || this.resolving || this.disposed) return;
    await this.localTail;
    this.resolving = true;
    this.publish({ status: "Syncing" });
    try {
      const local = structuredClone(this.snapshot.data!);
      const result = await this.options.transport.resolve(
        conflict.id,
        choice,
        conflict.remote.revision,
      );
      this.accountConfirmed = true;
      const chosen = choice === "local" ? local : result.data;
      this.sequence += 1;
      this.acknowledged =
        JSON.stringify(chosen) === JSON.stringify(result.data)
          ? this.sequence
          : this.sequence - 1;
      this.request = null;
      this.publish({
        draft: { ...result, data: structuredClone(chosen) },
        data: structuredClone(chosen),
        conflict: null,
        status:
          this.sequence === this.acknowledged
            ? "Saved to account"
            : "Saving locally",
        error: this.versionNote,
      });
      // Server history retains the other version. Device recovery keeps an archived copy
      // until the next edit; it is never silently merged with the chosen source files.
      await this.options.storage.acknowledge(local);
      this.persist();
      await this.localTail;
    } catch (error) {
      const next = readConflict(error);
      this.publish({
        conflict:
          next && this.snapshot.data
            ? {
                ...next,
                local: {
                  ...next.local,
                  data: structuredClone(this.snapshot.data),
                },
              }
            : conflict,
        status: "Conflict — choose a version",
        error: message(error),
      });
      this.persist();
    } finally {
      this.resolving = false;
    }
    if (!this.snapshot.conflict && this.sequence > this.acknowledged)
      await this.flush();
  };

  archiveLocal = async (reason = "before reset") => {
    await this.localTail;
    if (!this.snapshot.draft || this.disposed)
      throw new Error("The draft is not ready to archive.");
    try {
      await this.options.storage.archive(
        structuredClone(this.snapshot.draft),
        reason,
      );
    } catch (error) {
      this.publish({
        status: "Save failed — retry",
        error: `Recovery copy failed: ${message(error)} Your draft has not been reset.`,
      });
      throw error;
    }
  };

  retryCurrentVersion = async () => {
    if (!this.snapshot.draft || this.disposed)
      throw new Error("The draft is not ready.");
    if (this.snapshot.conflict || this.resolving)
      throw new Error(
        "Resolve the draft conflict before retrying the updated exercise.",
      );
    if (this.snapshot.draft.contentVersion === this.options.contentVersion) {
      await this.flush();
      return;
    }
    // Finish an uncertain request before changing its content version or idempotency key.
    await this.flush();
    if (this.snapshot.conflict)
      throw new Error(
        "Resolve the draft conflict before retrying the updated exercise.",
      );
    await this.archiveLocal("before content-version retry");
    this.request = null;
    this.sequence += 1;
    this.versionNote = null;
    this.publish({
      draft: {
        ...this.snapshot.draft,
        contentVersion: this.options.contentVersion,
      },
      status: "Saving locally",
      error: null,
    });
    this.persist();
    await this.flush();
  };

  dispose() {
    this.disposed = true;
    this.clearSaveTimers();
    if (this.retryTimer) clearTimeout(this.retryTimer);
    this.listeners.clear();
  }
}

// A fresh id on every document load also keeps duplicated browser tabs independent.
const tabId =
  typeof crypto !== "undefined" ? crypto.randomUUID() : `tab-${Date.now()}`;

export function useDraft(
  exerciseId: string,
  contentVersion: number,
  starter: SourceFiles,
) {
  const [owner, setOwner] = useState(getLocalOwner);
  const [controller, setController] = useState<DraftController | null>(null);
  const [snapshot, setSnapshot] = useState<DraftSnapshot>({
    draft: null,
    data: null,
    status: "Saving locally",
    conflict: null,
    error: null,
  });

  useEffect(() => subscribeLocalOwner(() => setOwner(getLocalOwner())), []);

  useEffect(() => {
    if (!owner) {
      setController(null);
      setSnapshot({
        draft: null,
        data: null,
        status: "Save failed — retry",
        conflict: null,
        error: "Sign in to save your work.",
      });
      return;
    }
    const path = `/api/drafts/${encodeURIComponent(exerciseId)}`;
    const next = new DraftController({
      exerciseId,
      contentVersion,
      starter,
      // A rapidly reopened exercise may overlap a finishing save from its previous
      // mount. Independent local keys preserve both instead of allowing that old
      // controller's acknowledgement to replace a new controller's pending edits.
      storage: recoveryStore(
        owner,
        `${tabId}:${crypto.randomUUID()}`,
        exerciseId,
      ),
      transport: {
        load: () => api<Draft | null>(path),
        save: (save) =>
          api<Draft>(path, { method: "PUT", body: JSON.stringify(save) }),
        resolve: (conflictId, choice, revision) =>
          api<Draft>(`${path}/resolve`, {
            method: "POST",
            body: JSON.stringify({ conflictId, choice, revision }),
          }),
      },
      online: () => navigator.onLine,
    });
    setController(next);
    const unsubscribe = next.subscribe(setSnapshot);
    void next.start();
    const online = () => {
      void next.flush();
    };
    const hidden = () => {
      if (document.visibilityState === "hidden") void next.flush();
    };
    window.addEventListener("online", online);
    document.addEventListener("visibilitychange", hidden);
    return () => {
      unsubscribe();
      window.removeEventListener("online", online);
      document.removeEventListener("visibilitychange", hidden);
      // Captured local writes complete even after navigation. An in-flight server response
      // is coalesced before disposal so a remount can recover the acknowledged revision.
      void next.flush().finally(() => next.dispose());
    };
    // Stable exercise IDs/versions define controller lifetime; starter objects are content data.
  }, [exerciseId, contentVersion, owner]);

  const update = useCallback(
    (patch: Partial<DraftData>) => controller?.update(patch),
    [controller],
  );
  const flush = useCallback(
    () => controller?.flush() ?? Promise.resolve(),
    [controller],
  );
  const resolve = useCallback(
    (choice: "local" | "remote") =>
      controller?.resolve(choice) ?? Promise.resolve(),
    [controller],
  );
  const archiveLocal = useCallback(
    (reason = "before reset") => {
      if (!controller)
        return Promise.reject(new Error("The draft is not ready to archive."));
      return controller.archiveLocal(reason);
    },
    [controller],
  );
  const retryCurrentVersion = useCallback(() => {
    if (!controller)
      return Promise.reject(new Error("The draft is not ready."));
    return controller.retryCurrentVersion();
  }, [controller]);
  return {
    ...snapshot,
    update,
    flush,
    resolve,
    archiveLocal,
    retryCurrentVersion,
  };
}
