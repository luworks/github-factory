/** At most two bounded cache reads and one replaceable latest selection. No
 * polling, retry clock or request from hover/paint. Late results cannot win. */
export function selectionLoader<T>(read: (key: string) => Promise<T>) {
    let generation = 0, active = 0, pending: {
        key: string;
        generation: number;
        accept: (value: T) => void;
        reject: (error: unknown) => void;
    } | null = null;
    const start = (task: NonNullable<typeof pending>) => { active++; void read(task.key).then(value => { if (task.generation === generation)
        task.accept(value); }, error => { if (task.generation === generation)
        task.reject(error); }).finally(() => { active--; if (pending) {
        const next = pending;
        pending = null;
        if (next.generation === generation)
            start(next);
    } }); };
    return { select(key: string, accept: (value: T) => void, reject: (error: unknown) => void) { const task = { key, generation: ++generation, accept, reject }; if (active < 2)
            start(task);
        else
            pending = task; }, cancel() { generation++; pending = null; } };
}
