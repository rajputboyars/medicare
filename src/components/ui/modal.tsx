"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";
import { X } from "lucide-react";

/**
 * Accessible modal built on the native <dialog>: focus is trapped inside, Esc closes, background is inert,
 * and focus returns to the control that opened it. Bottom sheet on phones, centred card from 640px.
 */
export function Modal({ open, onClose, title, description, children, footer, dismissible = true }: {
  open: boolean; onClose: () => void; title: string; description?: string; children?: ReactNode; footer?: ReactNode; dismissible?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  const descId = useId();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);

  return (
    <dialog
      ref={ref}
      className="modal"
      aria-labelledby={titleId}
      aria-describedby={description ? descId : undefined}
      onCancel={(e) => { e.preventDefault(); if (dismissible) onClose(); }}
      onClick={(e) => { if (dismissible && e.target === e.currentTarget) onClose(); }}
    >
      <div className="w-full rounded-t-sheet bg-surface p-5 shadow-overlay sm:w-[28rem] sm:max-w-[92vw] sm:rounded-sheet">
        <div className="flex items-start justify-between gap-3">
          <h2 id={titleId} className="t-section">{title}</h2>
          {dismissible && (
            <button type="button" onClick={onClose} aria-label="Close" className="tap -mr-2 -mt-2 grid place-items-center rounded-control text-muted hover:bg-surface-2">
              <X className="size-5" aria-hidden />
            </button>
          )}
        </div>
        {description && <p id={descId} className="t-support mt-1">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
        {footer && <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
      </div>
    </dialog>
  );
}
