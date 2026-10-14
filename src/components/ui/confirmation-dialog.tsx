"use client";
import dynamic from "next/dynamic";
import type { ReactNode } from "react";
import { Button } from "./button";
import { Modal } from "./modal";

export interface ConfirmationDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: () => void;
  title: string;
  description?: string;
  confirmLabel?: string;
  cancelLabel?: string;
  /** "danger" for anything that cancels, rejects or deletes. */
  tone?: "default" | "danger";
  loading?: boolean;
  confirmDisabled?: boolean;
  error?: string;
  /** Extra content, e.g. a "reason" field. */
  children?: ReactNode;
}

function Impl({ open, onClose, onConfirm, title, description, confirmLabel = "Confirm", cancelLabel = "Go back", tone = "default", loading, confirmDisabled, error, children }: ConfirmationDialogProps) {
  return (
    <Modal
      open={open}
      onClose={loading ? () => undefined : onClose}
      title={title}
      description={description}
      dismissible={!loading}
      footer={
        <>
          <Button variant="secondary" onClick={onClose} disabled={loading}>{cancelLabel}</Button>
          <Button variant={tone === "danger" ? "danger" : "primary"} onClick={onConfirm} loading={loading} disabled={confirmDisabled}>{confirmLabel}</Button>
        </>
      }
    >
      {children}
      {error && <p role="alert" className="mt-3 text-sm font-semibold text-emergency">{error}</p>}
    </Modal>
  );
}

const Lazy = dynamic(() => Promise.resolve(Impl), { ssr: false });

/** Loaded on demand: the dialog code is only fetched the first time someone opens one. */
export function ConfirmationDialog(props: ConfirmationDialogProps) {
  if (!props.open) return null;
  return <Lazy {...props} />;
}
