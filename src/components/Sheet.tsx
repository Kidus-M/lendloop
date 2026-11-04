"use client";

import { X } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

/** A side sheet on the native <dialog>, which traps focus and closes on Esc. */
export function Sheet({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  return (
    <dialog ref={ref} className="sheet" aria-label={title} onClose={onClose}>
      <div className="flex items-start justify-between gap-4 border-b border-line p-5">
        <h2 className="text-3xl">{title}</h2>
        <button
          type="button"
          className="btn min-w-11 px-2"
          aria-label="Close"
          onClick={() => ref.current?.close()}
        >
          <X className="size-5" aria-hidden="true" />
        </button>
      </div>
      <div className="p-5">{children}</div>
    </dialog>
  );
}
