/** Promise-based store behind <ConfirmHost/>. Call `confirmDialog(...)` from any async handler. */

export interface ConfirmOptions {
    title: string
    body?: string
    confirmLabel: string
    /** Style the confirm action as destructive. */
    danger?: boolean
}

export interface ConfirmRequest {
    id: number
    options: ConfirmOptions
    resolve: (confirmed: boolean) => void
}

let nextId = 1
const queue: ConfirmRequest[] = []
const listeners = new Set<() => void>()

function emit() {
    listeners.forEach(l => l())
}

/** Resolves true on confirm, false on Cancel or Esc. Calls made while one is open are queued. */
export function confirmDialog(options: ConfirmOptions): Promise<boolean> {
    return new Promise<boolean>(resolve => {
        queue.push({id: nextId++, options, resolve})
        emit()
    })
}

export function subscribeConfirm(listener: () => void): () => void {
    listeners.add(listener)
    return () => { listeners.delete(listener) }
}

export function currentConfirm(): ConfirmRequest | null {
    return queue[0] ?? null
}

export function settleConfirm(id: number, confirmed: boolean) {
    const i = queue.findIndex(r => r.id === id)
    if (i < 0) return
    const [req] = queue.splice(i, 1)
    req.resolve(confirmed)
    emit()
}
