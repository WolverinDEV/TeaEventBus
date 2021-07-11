/*
export type EventPayloadObject = {
    [key: string]: EventPayload
} | {
    [key: number]: EventPayload
};

export type EventPayload = string | number | bigint | null | undefined | EventPayloadObject;
*/
export type EventPayloadObject = any;

export type EventMap<P> = {
    [K in keyof P]: EventPayloadObject & {
        /* prohibit the type attribute on the highest layer (used to identify the event type) */
        type?: never
    }
};

export type Event<P extends EventMap<P>, T extends keyof P> = {
    readonly type: T,

    as<S extends T>(target: S) : Event<P, S>;
    asUnchecked<S extends T>(target: S) : Event<P, S>;
    asAnyUnchecked<S extends keyof P>(target: S) : Event<P, S>;

    /**
     * Return an object containing only the event payload specific key value pairs.
     */
    extractPayload() : P[T];
} & P[T];

export interface EventSender<Events extends EventMap<Events> = EventMap<any>> {
    fire<T extends keyof Events>(event_type: T, data?: Events[T], overrideTypeKey?: boolean);

    /**
     * Fire an event later by using setTimeout(..)
     * @param event_type The target event to be fired
     * @param data The payload of the event
     * @param callback The callback will be called after the event has been successfully dispatched
     */
    fire_later<T extends keyof Events>(event_type: T, data?: Events[T], callback?: () => void);

    /**
     * Fire an event, which will be delayed until the next animation frame.
     * This ensures that all react components have been successfully mounted/unmounted.
     * @param event_type The target event to be fired
     * @param data The payload of the event
     * @param callback The callback will be called after the event has been successfully dispatched
     */
    fire_react<T extends keyof Events>(event_type: T, data?: Events[T], callback?: () => void);
}

export type EventDispatchType = "sync" | "later" | "react";

export interface EventConsumer {
    handleEvent(mode: EventDispatchType, type: string, data: any);
}