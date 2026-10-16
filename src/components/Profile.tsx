import { useRef, useState } from "react";
import { Pencil } from "lucide-react";
import type { Preferences } from "../../shared/app";
import { Dialog } from "./Dialog";

export function Avatar({
  name,
  picture,
}: {
  name: string;
  picture?: string | null;
}) {
  return (
    <span className="avatar" aria-hidden="true">
      {picture ? (
        <img src={picture} alt="" />
      ) : (
        Array.from(name)[0]?.toUpperCase()
      )}
    </span>
  );
}

export function Profile({
  username,
  preferences,
  busy,
  onSave,
  onClose,
}: {
  username: string;
  preferences: Preferences;
  busy: boolean;
  onSave: (patch: Partial<Preferences>) => Promise<boolean | undefined>;
  onClose: () => void;
}) {
  const [name, setName] = useState(preferences.displayName ?? "");
  const [picture, setPicture] = useState(preferences.avatarDataUrl ?? null);
  const [reading, setReading] = useState(false);
  const [error, setError] = useState("");
  const generation = useRef(0);
  async function readPicture(file?: File) {
    if (!file) return;
    const current = ++generation.current;
    setError("");
    if (
      !/^image\/(png|jpeg|webp)$/.test(file.type) ||
      file.size > 5 * 1024 * 1024
    ) {
      setError("Choose a PNG, JPEG or WebP picture under 5 MB.");
      return;
    }
    setReading(true);
    try {
      const bitmap = await createImageBitmap(file);
      try {
        const canvas = document.createElement("canvas");
        canvas.width = canvas.height = 192;
        const context = canvas.getContext("2d");
        if (!context) throw new Error("Picture processing is unavailable.");
        const side = Math.min(bitmap.width, bitmap.height);
        context.drawImage(
          bitmap,
          (bitmap.width - side) / 2,
          (bitmap.height - side) / 2,
          side,
          side,
          0,
          0,
          192,
          192,
        );
        const image = canvas.toDataURL("image/webp", 0.85);
        if (image.length > 65536)
          throw new Error("This picture is too large. Choose another image.");
        if (current === generation.current) setPicture(image);
      } finally {
        bitmap.close();
      }
    } catch {
      if (current === generation.current)
        setError("Could not open this picture. Choose another image.");
    } finally {
      if (current === generation.current) setReading(false);
    }
  }
  return (
    <Dialog title="Edit profile" onClose={onClose}>
      <form
        className="profile-form"
        onSubmit={async (event) => {
          event.preventDefault();
          setError("");
          if (
            await onSave({ displayName: name.trim(), avatarDataUrl: picture })
          )
            onClose();
          else setError("Could not save your profile. Try again.");
        }}
      >
        <div className="profile-picture-row">
          <Avatar name={name.trim() || username} picture={picture} />
          <div className="profile-picture-actions">
            <label
              className={`button secondary profile-upload ${busy || reading ? "disabled" : ""}`}
            >
              <Pencil size={15} aria-hidden="true" />
              {reading ? "Opening picture…" : "Choose picture"}
              <input
                type="file"
                accept="image/png,image/jpeg,image/webp"
                aria-label="Profile picture"
                disabled={busy || reading}
                onChange={(event) => {
                  void readPicture(event.target.files?.[0]);
                  event.target.value = "";
                }}
              />
            </label>
            <small className="muted">PNG, JPEG or WebP, up to 5 MB</small>
            {picture ? (
              <button
                className="text-button"
                type="button"
                disabled={busy || reading}
                onClick={() => setPicture(null)}
              >
                Remove picture
              </button>
            ) : null}
          </div>
        </div>
        <label>
          Display name
          <input
            value={name}
            maxLength={60}
            placeholder={username}
            disabled={busy}
            onChange={(event) => setName(event.target.value)}
          />
        </label>
        <p className="muted profile-username">
          Sign-in username: <strong>{username}</strong>
        </p>
        {error ? (
          <p role="alert" className="notice error">
            {error}
          </p>
        ) : null}
        <button type="submit" disabled={busy || reading}>
          {busy ? "Saving…" : "Save profile"}
        </button>
      </form>
    </Dialog>
  );
}
