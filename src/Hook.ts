export interface EventRegistryHooks {
    logTrace(message: string, ...args: any[]);
    logAsyncInvokeError(error: any);
    logReactInvokeError(error: any);
}

export let eventRegistryHooks: EventRegistryHooks = new class implements EventRegistryHooks {
    logAsyncInvokeError(error: any) {
        console.error("[Events] Async invoke returned error: %o", error);
    }

    logReactInvokeError(error: any) {
        console.error("[Events] React invoke returned error: %o", error);
    }

    logTrace(message: string, ...args: any[]) {
        console.debug("[Events] " + message, ...args);
    }
};

export function setEventRegistryHooks(hooks: EventRegistryHooks) {
    eventRegistryHooks = hooks;
}