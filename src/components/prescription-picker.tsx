"use client";
/* eslint-disable @next/next/no-img-element -- previews are local blob: URLs, which next/image cannot optimise */
import { useRef, useState } from "react";
import { Camera, FileText, Image as ImageIcon, X } from "lucide-react";
import { Button } from "@/components/ui";
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

export function PrescriptionPicker({ file, onChange, error }: { file: File | null; onChange: (f: File | null) => void; error?: string }) {
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

  const err = error ?? localError;
  return (
    <div>
      <p className="mb-2 text-sm font-semibold">Prescription <span className="text-emergency" aria-hidden>*</span></p>
      {file ? (
        <div className="flex items-center gap-3 rounded-2xl border-2 border-brand-200 bg-brand-50 p-3">
          {preview ? <img src={preview} alt="Your prescription preview" className="size-20 rounded-xl object-cover" /> : <FileText className="size-12 text-brand-700" aria-hidden />}
          <div className="min-w-0 flex-1"><p className="truncate font-semibold">{file.name}</p><p className="text-sm text-muted">{Math.round(file.size / 1024)} KB</p></div>
          <Button variant="ghost" onClick={clear} aria-label="Remove prescription" className="min-w-12 px-0"><X className="size-5" aria-hidden /></Button>
        </div>
      ) : (
        <div className="grid gap-2 sm:grid-cols-3">
          <Button type="button" variant="secondary" onClick={() => cam.current?.click()}><Camera className="size-5" aria-hidden /> Take photo</Button>
          <Button type="button" variant="secondary" onClick={() => gal.current?.click()}><ImageIcon className="size-5" aria-hidden /> From gallery</Button>
          <Button type="button" variant="secondary" onClick={() => pdf.current?.click()}><FileText className="size-5" aria-hidden /> PDF file</Button>
        </div>
      )}
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Take a photo of the prescription" />
      <input ref={gal} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose prescription from gallery" />
      <input ref={pdf} type="file" accept="application/pdf" className="hidden" onChange={(e) => pick(e.target.files?.[0])} aria-label="Choose a PDF prescription" />
      {err && <p role="alert" className="mt-2 text-sm font-medium text-emergency">{err}</p>}
      <p className="mt-2 text-sm text-muted">Make sure the doctor&apos;s name, date and medicines are clearly visible. JPG, PNG, WebP or PDF up to 8 MB.</p>
    </div>
  );
}
