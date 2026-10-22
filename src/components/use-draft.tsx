"use client";

import { useEffect, useRef, useState } from "react";

// Draft editing: hold a local copy of a product slice, edit freely, and only
// commit to the store (which persists) when Save is clicked. Resets whenever the
// source changes identity (e.g. switching active product).
export function useDraft<T>(source: T, sourceKey: string) {
  const [draft, setDraft] = useState<T>(source);
  const [saved, setSaved] = useState(false);
  const keyRef = useRef(sourceKey);
  const sourceRef = useRef(source);

  // Re-seed the draft when the underlying product/slice changes (product switch).
  useEffect(() => {
    if (keyRef.current !== sourceKey) {
      keyRef.current = sourceKey;
      sourceRef.current = source;
      setDraft(source);
      setSaved(false);
      return;
    }
    // Same product, new data underneath — typically the full record (with its
    // photos and documents) finishing its load after the form opened. Adopt it
    // while the user hasn't edited anything, so the form never sits on the
    // light copy's blank file placeholders or shows a false "Unsaved changes".
    if (source !== sourceRef.current) {
      const before = JSON.stringify(sourceRef.current);
      sourceRef.current = source;
      setDraft((d) => (JSON.stringify(d) === before ? source : d));
    }
  }, [sourceKey, source]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(source);

  // Field setter for a draft object.
  function setField<K extends keyof T>(k: K, v: T[K]) {
    setDraft((d) => ({ ...d, [k]: v }));
    setSaved(false);
  }
  // Replace the whole draft (for array slices etc.).
  function setAll(v: T) {
    setDraft(v);
    setSaved(false);
  }
  function flashSaved() {
    setSaved(true);
    setTimeout(() => setSaved(false), 1800);
  }
  function discard() {
    setDraft(source);
    setSaved(false);
  }

  return { draft, setField, setAll, dirty, saved, flashSaved, discard, setSaved };
}
