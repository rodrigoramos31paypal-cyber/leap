"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Check } from "lucide-react";
import sheet from "./avatars-projeto21-20.jpg";
import ownerPhoto from "./joao-pedro-avatar-projeto21.jpg";
import { saveProfileAvatar } from "./leap-profile-avatar-actions";
import type { ProfileAvatar } from "./leap-profile-avatar-data";

const portraits = Array.from({ length: 20 }, (_, index) => `portrait-${index + 1}`);

export function LeapAvatar({ name, choice, photo, owner = false, fallback, size = "size-16" }: {
  name: string;
  choice: string | null;
  photo?: string | null;
  owner?: boolean;
  fallback?: string | null;
  size?: string;
}) {
  const index = portraits.indexOf(choice ?? "");
  const src = choice === "photo" ? photo : !choice ? fallback || (owner ? ownerPhoto.src : null) : null;
  const initials = name.trim().split(/\s+/).slice(0, 2).map(word => Array.from(word)[0]).join("").toLocaleUpperCase("pt-PT");

  return (
    <span aria-hidden="true" className={`grid ${size} shrink-0 place-items-center overflow-hidden rounded-full border bg-zinc-800 text-lg font-bold text-white ${owner ? "border-gold-400 ring-2 ring-gold-400/40" : "border-zinc-500"}`}>
      {index >= 0 ? (
        <span className="size-full" style={{
          backgroundImage: `url(${sheet.src})`,
          backgroundSize: "500% 400%",
          backgroundPosition: `${(index % 5) * 25}% ${Math.floor(index / 5) * 100 / 3}%`,
        }} />
      ) : src ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={src} alt="" className="size-full object-cover" />
      ) : initials || "?"}
    </span>
  );
}

async function preparePhoto(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 10 * 1024 * 1024) {
    throw new Error("Escolhe uma imagem JPEG, PNG ou WebP até 10 MB.");
  }
  const image = await createImageBitmap(file);
  try {
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 224;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Não foi possível preparar a foto.");
    const side = Math.min(image.width, image.height);
    context.fillStyle = "#fff";
    context.fillRect(0, 0, 224, 224);
    context.drawImage(image, (image.width - side) / 2, (image.height - side) / 2, side, side, 0, 0, 224, 224);
    const jpeg = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, "image/jpeg", 0.9));
    if (!jpeg) throw new Error("Não foi possível preparar a foto.");
    return new File([jpeg], "avatar.jpg", { type: "image/jpeg" });
  } finally {
    image.close();
  }
}

export function ProfileAvatarPicker({ name, avatar, owner, fallback }: {
  name: string;
  avatar: ProfileAvatar;
  owner?: boolean;
  fallback?: string | null;
}) {
  const router = useRouter();
  const dialog = useRef<HTMLDialogElement>(null);
  const [choice, setChoice] = useState(avatar.choice);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [preparing, setPreparing] = useState(false);
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (!file) {
      setPreview(null);
      return;
    }
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function open() {
    setChoice(avatar.choice);
    setFile(null);
    setError("");
    dialog.current?.showModal();
  }

  function save() {
    if (!choice) return;
    const form = new FormData();
    form.set("choice", choice);
    if (choice === "photo" && file) form.set("photo", file);
    setError("");
    startTransition(async () => {
      try {
        const result = await saveProfileAvatar(form);
        if (result.error) {
          setError(result.error);
          return;
        }
        dialog.current?.close();
        router.refresh();
      } catch {
        setError("Não foi possível guardar o avatar. Tenta novamente.");
      }
    });
  }

  const displayedChoice = choice ?? (!owner && !fallback ? "initials" : null);

  return (
    <>
      <div className="flex shrink-0 flex-col items-start gap-1">
        <button type="button" aria-label="Alterar avatar" onClick={open} className="rounded-full">
          <LeapAvatar name={name} {...avatar} owner={owner} fallback={fallback} />
        </button>
        <button type="button" onClick={open} className="text-[10px] leading-4 font-semibold underline underline-offset-2">Alterar avatar</button>
      </div>
      <dialog ref={dialog} aria-labelledby="leap-avatar-title" className="m-auto max-h-[90dvh] w-[calc(100%_-_2rem)] max-w-md overflow-y-auto rounded-2xl bg-white p-4 text-zinc-900 backdrop:bg-black/65 dark:bg-zinc-900 dark:text-white" onCancel={event => {
        if (pending || preparing) event.preventDefault();
      }}>
        <h2 id="leap-avatar-title" className="text-lg font-bold">Alterar avatar</h2>
        <div className="mt-3 flex items-center gap-3">
          <LeapAvatar name={name} choice={choice} photo={preview ?? avatar.photo} owner={owner} fallback={fallback} />
          <p className="text-sm">Pré-visualização</p>
        </div>
        <fieldset disabled={pending || preparing} className="mt-4 space-y-3">
          <legend className="sr-only">Escolhe o teu avatar</legend>
          <div className="grid grid-cols-5 gap-2">
            {portraits.map((portrait, index) => (
              <label key={portrait} className="relative block cursor-pointer">
                <input className="peer sr-only" type="radio" name="profile-avatar" checked={choice === portrait} onChange={() => setChoice(portrait)} aria-label={`Retrato ${index + 1}`} />
                <span className="block rounded-full peer-checked:ring-2 peer-checked:ring-blue-500 peer-focus-visible:ring-2 peer-focus-visible:ring-blue-500">
                  <LeapAvatar name={name} choice={portrait} size="w-full aspect-square" />
                </span>
                {choice === portrait && <Check aria-hidden="true" className="absolute bottom-0 right-0 size-5 rounded-full bg-blue-700 p-0.5 text-white" />}
              </label>
            ))}
          </div>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="profile-avatar" checked={displayedChoice === "initials"} onChange={() => setChoice("initials")} />
            Usar as iniciais
          </label>
          <label className="flex cursor-pointer items-center gap-2 text-sm">
            <input type="radio" name="profile-avatar" checked={choice === "photo"} onChange={() => setChoice("photo")} />
            Carregar uma foto pessoal
          </label>
          {choice === "photo" && (
            <input type="file" aria-label="Escolher foto pessoal" accept="image/jpeg,image/png,image/webp" className="w-full text-sm" onChange={async event => {
              const selected = event.currentTarget.files?.[0];
              if (!selected) return;
              setFile(null);
              setPreparing(true);
              setError("");
              try {
                setFile(await preparePhoto(selected));
              } catch (problem) {
                setError(problem instanceof Error ? problem.message : "Não foi possível abrir esta imagem.");
              } finally {
                setPreparing(false);
              }
            }} />
          )}
        </fieldset>
        {error && <p role="alert" className="mt-3 text-sm text-red-600 dark:text-red-300">{error}</p>}
        <div className="mt-5 flex justify-end gap-2">
          <button type="button" disabled={pending || preparing} className="btn-outline" onClick={() => dialog.current?.close()}>Cancelar</button>
          <button type="button" disabled={!choice || pending || preparing || (choice === "photo" && !file && !avatar.photo)} className="btn-primary disabled:opacity-50" onClick={save}>{pending ? "A guardar…" : "Guardar"}</button>
        </div>
      </dialog>
    </>
  );
}
