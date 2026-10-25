import { useEffect, useState } from 'preact/hooks';

export interface SnapshotSource<T> { getSnapshot(): T; subscribe(listener: () => void): () => void }

/** Subscribes a component to a controller that publishes immutable snapshots. */
export function useSnapshot<T>(source: SnapshotSource<T>): T {
  const [snapshot, setSnapshot] = useState(source.getSnapshot());
  useEffect(() => {
    setSnapshot(source.getSnapshot());
    return source.subscribe(() => setSnapshot(source.getSnapshot()));
  }, [source]);
  return snapshot;
}
