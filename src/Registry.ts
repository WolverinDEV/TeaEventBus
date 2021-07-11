import {arrayRemove, createEvent, guid, validateEventPayload} from "./Helper";
import {Event, EventConsumer, EventMap, EventSender} from "./Events";
import {IpcEventDispatcher, IpcRegistryDescription} from "./Ipc";
import {eventRegistryHooks} from "./Hook";
import {useEffect} from "react";
import {unstable_batchedUpdates} from "react-dom";
import * as React from "react";

interface EventHandlerRegisterData {
    registeredHandler: {[key: string]: ((event) => void)[]}
}

const kEventAnnotationKey = guid();
export class Registry<Events extends EventMap<Events> = EventMap<any>> implements EventSender<Events> {
    protected readonly registryMetadataSymbol: symbol;

    protected persistentEventHandler: { [key: string]: ((event) => void)[] } = {};
    protected oneShotEventHandler: { [key: string]: ((event) => void)[] } = {};
    protected genericEventHandler: ((event) => void)[] = [];
    protected consumer: EventConsumer[] = [];

    private ipcConsumer: IpcEventDispatcher;

    private debugPrefix = undefined;
    private warnUnhandledEvents = false;

    private pendingAsyncCallbacks: { type: any, data: any, callback: () => void }[];
    private pendingAsyncCallbacksTimeout: number = 0;

    private pendingReactCallbacks: { type: any, data: any, callback: () => void }[];
    private pendingReactCallbacksFrame: number = 0;

    static fromIpcDescription<Events extends EventMap<Events> = EventMap<any>>(description: IpcRegistryDescription<Events>) : Registry<Events> {
        const registry = new Registry<Events>();
        registry.ipcConsumer = new IpcEventDispatcher(registry as any, description.ipcChannelId);
        registry.registerConsumer(registry.ipcConsumer);
        return registry;
    }

    constructor() {
        this.registryMetadataSymbol = Symbol("event registry");
    }

    destroy() {
        Object.values(this.persistentEventHandler).forEach(handlers => handlers.splice(0, handlers.length));
        Object.values(this.oneShotEventHandler).forEach(handlers => handlers.splice(0, handlers.length));
        this.genericEventHandler.splice(0, this.genericEventHandler.length);
        this.consumer.splice(0, this.consumer.length);

        this.ipcConsumer?.destroy();
        this.ipcConsumer = undefined;
    }

    enableDebug(prefix: string) { this.debugPrefix = prefix || "---"; }
    disableDebug() { this.debugPrefix = undefined; }

    enableWarnUnhandledEvents() { this.warnUnhandledEvents = true; }
    disableWarnUnhandledEvents() { this.warnUnhandledEvents = false; }

    fire<T extends keyof Events>(eventType: T, data?: Events[T]) {
        data = validateEventPayload(eventType, data);
        for(const consumer of this.consumer) {
            consumer.handleEvent("sync", eventType as string, data);
        }

        this.doInvokeEvent("sync", createEvent(eventType, data));
    }

    fire_later<T extends keyof Events>(eventType: T, data?: Events[T], callback?: () => void) {
        data = validateEventPayload(eventType, data);

        if(!this.pendingAsyncCallbacksTimeout) {
            this.pendingAsyncCallbacksTimeout = setTimeout(() => this.invokeAsyncCallbacks());
            this.pendingAsyncCallbacks = [];
        }
        this.pendingAsyncCallbacks.push({ type: eventType, data: data, callback: callback });

        for(const consumer of this.consumer) {
            consumer.handleEvent("later", eventType as string, data);
        }
    }

    fire_react<T extends keyof Events>(eventType: T, data?: Events[T], callback?: () => void) {
        data = validateEventPayload(eventType, data);

        if(!this.pendingReactCallbacks) {
            this.pendingReactCallbacksFrame = requestAnimationFrame(() => this.invokeReactCallbacks());
            this.pendingReactCallbacks = [];
        }

        this.pendingReactCallbacks.push({ type: eventType, data: data, callback: callback });

        for(const consumer of this.consumer) {
            consumer.handleEvent("react", eventType as string, data);
        }
    }

    private registerHandlerCallback<T extends keyof Events>(type: "persistent" | "one-shot", events: T | T[], handler: (event: Event<Events, T>) => void) : () => void {
        if(!Array.isArray(events)) {
            events = [events];
        }

        const handlerArray = type === "persistent" ? this.persistentEventHandler : this.oneShotEventHandler;
        for(const event of events as string[]) {
            const registeredHandler = handlerArray[event] || (handlerArray[event] = []);
            registeredHandler.push(handler);
        }

        return () => {
            for(const event of events as string[]) {
                const registeredHandler = handlerArray[event] || (handlerArray[event] = []);
                arrayRemove(registeredHandler, handler);
            }
        };
    }

    on<T extends keyof Events>(event: T | T[], handler: (event: Event<Events, T>) => void) : () => void;
    on(events, handler) : () => void {
        return this.registerHandlerCallback("persistent", events, handler);
    }

    one<T extends keyof Events>(event: T | T[], handler: (event: Event<Events, T>) => void) : () => void;
    one(events, handler) : () => void {
        return this.registerHandlerCallback("one-shot", events, handler);
    }

    off(handler: (event: Event<Events, keyof Events>) => void);
    off<T extends keyof Events>(events: T | T[], handler: (event: Event<Events, T>) => void);
    off(handlerOrEvents, handler?) {
        if(typeof handlerOrEvents === "function") {
            this.offAll(handler);
        } else if(typeof handlerOrEvents === "string") {
            if(this.persistentEventHandler[handlerOrEvents]) {
                arrayRemove(this.persistentEventHandler[handlerOrEvents], handler);
            }

            if(this.oneShotEventHandler[handlerOrEvents]) {
                arrayRemove(this.oneShotEventHandler[handlerOrEvents], handler);
            }
        } else if(Array.isArray(handlerOrEvents)) {
            handlerOrEvents.forEach(handler_or_event => this.off(handler_or_event, handler));
        }
    }

    onAll(handler: (event: Event<Events, keyof Events>) => void): () => void {
        this.genericEventHandler.push(handler);
        return () => arrayRemove(this.genericEventHandler, handler);
    }

    offAll(handler: (event: Event<Events, keyof Events>) => void) {
        Object.values(this.persistentEventHandler).forEach(persistentHandler => arrayRemove(persistentHandler, handler));
        Object.values(this.oneShotEventHandler).forEach(oneShotHandler => arrayRemove(oneShotHandler, handler));
        arrayRemove(this.genericEventHandler, handler);
    }

    /**
     * @param event
     * @param handler
     * @param reactEffectDependencies
     */
    reactUse<T extends keyof Events>(event: T | T[], handler: (event: Event<Events, T>) => void, reactEffectDependencies?: any[]);

    /**
     * @param event
     * @param handler
     * @param condition If a boolean the event handler will only be registered if the condition is true
     * @param reactEffectDependencies
     */
    reactUse<T extends keyof Events>(event: T | T[], handler: (event: Event<Events, T>) => void, condition?: boolean, reactEffectDependencies?: any[]);
    reactUse(event, handler, condition?, reactEffectDependencies?) {
        if(Array.isArray(condition)) {
            reactEffectDependencies = condition;
            condition = undefined;
        }

        if(typeof condition === "boolean" && !condition) {
            useEffect(() => {});
            return;
        }

        if(!Array.isArray(reactEffectDependencies)) {
            reactEffectDependencies = [];
        }

        /*
         * Register the current registry as effect dependency since if the registry changes we need to register the event to
         * the new registry.
         */
        reactEffectDependencies.push(this.registryMetadataSymbol);

        const handlers = this.persistentEventHandler[event] || (this.persistentEventHandler[event] = []);

        useEffect(() => {
            handlers.push(handler);

            return () => { arrayRemove(handlers, handler); };
        }, reactEffectDependencies);
    }

    private doInvokeEvent(dispatchType: string, event: Event<Events, keyof Events>) {
        if(this.debugPrefix) {
            eventRegistryHooks.logTrace("[%s] Invoke %s event: %s", this.debugPrefix, dispatchType, event.type);
        }

        const oneShotHandler = this.oneShotEventHandler[event.type];
        if(oneShotHandler) {
            delete this.oneShotEventHandler[event.type];
            for(const handler of oneShotHandler) {
                handler(event);
            }
        }

        const handlers = [...(this.persistentEventHandler[event.type] || [])];
        for(const handler of handlers) {
            handler(event);
        }

        for(const handler of this.genericEventHandler) {
            handler(event);
        }
        /*
        let invokeCount = 0;
        if(this.warnUnhandledEvents && invokeCount === 0) {
            logWarn(LogCategory.EVENT_REGISTRY, "Event handler (%s) triggered event %s which has no consumers.", this.debugPrefix, event.type);
        }
        */
    }

    private invokeAsyncCallbacks() {
        const callbacks = this.pendingAsyncCallbacks;
        this.pendingAsyncCallbacksTimeout = 0;
        this.pendingAsyncCallbacks = undefined;

        let index = 0;
        while(index < callbacks.length) {
            /* don't use this.fire since this will trigger a fired event */
            this.doInvokeEvent("async", createEvent(callbacks[index].type, callbacks[index].data));
            try {
                if(callbacks[index].callback) {
                    callbacks[index].callback();
                }
            } catch (error) {
                eventRegistryHooks.logAsyncInvokeError(error);
            }
            index++;
        }
    }

    private invokeReactCallbacks() {
        const callbacks = this.pendingReactCallbacks;
        this.pendingReactCallbacksFrame = 0;
        this.pendingReactCallbacks = undefined;

        /* run this after the requestAnimationFrame has been finished since else it might be fired instantly */
        setTimeout(() => {
            /* batch all react updates */
            unstable_batchedUpdates(() => {
                let index = 0;
                while(index < callbacks.length) {
                    /* don't use this.fire since this will trigger a fired event */
                    this.doInvokeEvent("react", createEvent(callbacks[index].type, callbacks[index].data));
                    try {
                        if(callbacks[index].callback) {
                            callbacks[index].callback();
                        }
                    } catch (error) {
                        eventRegistryHooks.logReactInvokeError(error);
                    }
                    index++;
                }
            });
        });
    }

    registerHandler(handler: any, parentClasses?: boolean) {
        if(typeof handler !== "object") {
            throw "event handler must be an object";
        }

        if(typeof handler[this.registryMetadataSymbol] !== "undefined") {
            throw "event handler already registered";
        }

        const prototype = Object.getPrototypeOf(handler);
        if(typeof prototype !== "object") {
            throw "event handler must have a prototype";
        }

        const data = handler[this.registryMetadataSymbol] = {
            registeredHandler: {}
        } as EventHandlerRegisterData;

        let currentPrototype = prototype;
        do {
            Object.getOwnPropertyNames(currentPrototype).forEach(functionName => {
                if(functionName === "constructor") {
                    return;
                }

                if(typeof prototype[functionName] !== "function") {
                    return;
                }

                if(typeof prototype[functionName][kEventAnnotationKey] !== "object") {
                    return;
                }

                const eventData = prototype[functionName][kEventAnnotationKey];
                const eventHandler = event => prototype[functionName].call(handler, event);
                for(const event of eventData.events) {
                    const registeredHandler = data.registeredHandler[event] || (data.registeredHandler[event] = []);
                    registeredHandler.push(eventHandler);

                    this.on(event, eventHandler);
                }
            });

            if(!parentClasses) {
                break;
            }
        } while ((currentPrototype = Object.getPrototypeOf(currentPrototype)));
    }

    unregisterHandler(handler: any) {
        if(typeof handler !== "object") {
            throw "event handler must be an object";
        }

        if(typeof handler[this.registryMetadataSymbol] === "undefined") {
            throw "event handler not registered";
        }

        const data = handler[this.registryMetadataSymbol] as EventHandlerRegisterData;
        delete handler[this.registryMetadataSymbol];

        for(const event of Object.keys(data.registeredHandler)) {
            for(const handler of data.registeredHandler[event]) {
                this.off(event as any, handler);
            }
        }
    }

    registerConsumer(consumer: EventConsumer) : () => void {
        const allConsumer = this.consumer;
        allConsumer.push(consumer);

        return () => arrayRemove(allConsumer, consumer);
    }

    unregisterConsumer(consumer: EventConsumer) {
        arrayRemove(this.consumer, consumer);
    }

    generateIpcDescription() : IpcRegistryDescription<Events> {
        if(!this.ipcConsumer) {
            this.ipcConsumer = new IpcEventDispatcher(this as any, undefined);
            this.registerConsumer(this.ipcConsumer);
        }

        return {
            ipcChannelId: this.ipcConsumer.ipcChannelId
        };
    }
}

export function EventHandler<EventTypes>(events: (keyof EventTypes) | (keyof EventTypes)[]) {
    return function (target: any,
                     propertyKey: string,
                     _descriptor: PropertyDescriptor) {
        if(typeof target[propertyKey] !== "function") {
            throw "Invalid event handler annotation. Expected to be on a function type.";
        }

        target[propertyKey][kEventAnnotationKey] = {
            events: Array.isArray(events) ? events : [events]
        };
    }
}

export function ReactEventHandler<ObjectClass = React.Component<any, any>, Events = any>(registryCallback: (object: ObjectClass) => Registry<Events>) {
    return function (constructor: Function) {
        if(!React.Component.prototype.isPrototypeOf(constructor.prototype)) {
            throw "Class/object isn't an instance of React.Component";
        }

        const didMount = constructor.prototype.componentDidMount;
        constructor.prototype.componentDidMount = function() {
            const registry = registryCallback(this);
            if(!registry) {
                throw "Event registry returned for an event object is invalid";
            }

            registry.registerHandler(this);
            if(typeof didMount === "function") {
                didMount.call(this, arguments);
            }
        };

        const willUnmount = constructor.prototype.componentWillUnmount;
        constructor.prototype.componentWillUnmount = function () {
            const registry = registryCallback(this);
            if(!registry) {
                throw "Event registry returned for an event object is invalid";
            }

            try {
                registry.unregisterHandler(this);
            } catch (error) {
                console.warn("Failed to unregister event handler: %o", error);
            }

            if(typeof willUnmount === "function") {
                willUnmount.call(this, arguments);
            }
        };
    }
}