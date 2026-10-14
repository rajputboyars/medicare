"use client";
/* eslint-disable @next/next/no-img-element -- previews are local blob: URLs, which next/image cannot optimise */
import { useRef, useState } from "react";
import clsx from "clsx";
import { Camera, FileText, Image as ImageIcon, X } from "lucide-react";
import { MAX_UPLOAD_BYTES } from "@/lib/file-validation";

/** Shrinks big phone photos before upload – saves data on slow connections. PDFs pass through untouched. */
export async function compressImage(file: File, maxSide = 1600, quality = 0.8): Promise<File> {
  if (!file.type.startsWith("image/") || file.type === "image/gif") return file;
  try {
    const bmp = await createImageBitmap(file);
    const scale = Math.min(1, maxSide / Math.max(bmp.width, bmp.height));
    if (scale === 1 && file.size < 800_000) return file;
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bmp.width * scale);
    canvas.height = Math.round(bmp.height * scale);
    canvas.getContext("2d")!.drawImage(bmp, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, "image/jpeg", quality));
    if (!blob || blob.size >= file.size) return file;
    return new File([blob], file.name.replace(/\.\w+$/, "") + ".jpg", { type: "image/jpeg" });
  } catch {
    return file;
  }
}

/**
 * Large camera / gallery / PDF tiles (each a comfortable tap target). Used for prescriptions and for the optional
 * medicine photo in Find My Medicine (`allowPdf={false}`, `required={false}`).
 */
export function PrescriptionPicker({ file, onChange, error, label = "Prescription", required = true, allowPdf = true, hint }: {
  file: File | null; onChange: (f: File | null) => void; error?: string; label?: string; required?: boolean; allowPdf?: boolean; hint?: string;
}) {
  const cam = useRef<HTMLInputElement>(null);
  const gal = useRef<HTMLInputElement>(null);
  const pdf = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string>();
  const [localError, setLocalError] = useState<string>();

  async function pick(f?: File) {
    setLocalError(undefined);
    if (!f) return;
    if (f.size > MAX_UPLOAD_BYTES * 2) return setLocalError("This file is too large. Please choose a smaller one.");
    const out = await compressImage(f);
    if (out.size > MAX_UPLOAD_BYTES) return setLocalError("File is larger than 8 MB.");
    if (preview) URL.revokeObjectURL(preview);
    setPreview(out.type.startsWith("image/") ? URL.createObjectURL(out) : undefined);
    onChange(out);
  }
  function clear() {
    if (preview) URL.revokeObjectURL(preview);
    setPreview(undefined);
    onChange(null);
  }

  const tile = "tap flex min-h-28 flex-col items-center justify-center gap-2 rounded-card border-2 border-dashed border-brand-300 bg-brand-50 p-3 text-center font-bold text-brand-800 hover:bg-brand-100";
  const err = error ?? localError;
  return (
    <div>
      <p className="t-label mb-2">{label}{required ? <span className="text-emergency" aria-hidden> *</span> : <span className="t-caption"> (optional)</span>}</p>
      {file ? (
        <div className="flex items-center gap-3 rounded-card border-2 border-brand-200 bg-brand-50 p-3">
          {preview ? <img src={preview} alt={`${label} preview`} className="size-20 rounded-control object-cover" /> : <FileText className="size-12 text-brand-700" aria-hidden />}
          <div className="min-w-0 flex-1"><p className="t-card truncate">{file.name}</p><p className="t-caption">{Math.round(file.size / 1024)} KB · ready to send</p></div>
          <button type="button" onClick={clear} aria-label={`Remove ${label.toLowerCase()}`} className="tap grid place-items-center rounded-control hover:bg-white"><X className="size-5" aria-hidden /></button>
        </div>
      ) : (
        <div className={clsx("grid gap-2", allowPdf ? "grid-cols-3" : "grid-cols-2")}>
          <button type="button" className={tile} onClick={() => cam.current?.click()}><Camera className="size-8" aria-hidden /> Take photo</button>
          <button type="button" className={tile} onClick={() => gal.current?.click()}><ImageIcon className="size-8" aria-hidden /> Gallery</button>
          {allowPdf && <button type="button" className={tile} onClick={() => pdf.current?.click()}><FileText className="size-8" aria-hidden /> PDF file</button>}
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={`Take a photo for ${label.toLowerCase()}`} />
      <input ref={gal} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={`Choose ${label.toLowerCase()} from gallery`} />
      <input ref={pdf} type="file" accept="application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label={`Choose a PDF for ${label.toLowerCase()}`} />
      {err && <p role="alert" className="mt-2 text-sm font-semibold text-emergency">{err}</p>}
      <p className="t-caption mt-2">{hint ?? "Make sure the doctor's name, date and medicines are clearly visible. JPG, PNG, WebP or PDF up to 8 MB."}</p>
    </div>
  );
}
