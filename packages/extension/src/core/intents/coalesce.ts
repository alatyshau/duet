/**
 * Join the runs of one reading. A call that comes while the task is under way
 * leads to one more run after it and gets the same promise, so whoever awaits
 * sees the disk as it was after their call, and ten calls cost two readings.
 */
export function coalesce(task: () => Promise<void>): () => Promise<void> {
    let running: Promise<void> | null = null;
    let again = false;
    return () => {
        if (running) {
            again = true;
            return running;
        }
        running = (async () => {
            try {
                do {
                    again = false;
                    await task();
                } while (again);
            } finally {
                running = null;
            }
        })();
        return running;
    };
}
