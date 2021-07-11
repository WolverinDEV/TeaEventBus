import {EventConsumer, EventDispatchType, EventMap} from "./Events";
import {guid} from "./Helper";
import {Registry} from "./Registry";

export type IpcRegistryDescription<Events extends EventMap<Events> = EventMap<any>> = {
    ipcChannelId: string
}

export class IpcEventDispatcher implements EventConsumer {
    readonly registry: Registry;
    readonly ipcChannelId: string;
    private readonly localDispatchId: string;
    private readonly localDispatchSymbol: symbol;
    private broadcastChannel: BroadcastChannel;

    constructor(registry: Registry, ipcChannelId: string | undefined) {
        this.registry = registry;
        this.localDispatchId = guid();
        this.localDispatchSymbol = Symbol("ipc-dispatcher-" + this.localDispatchId);

        this.ipcChannelId = ipcChannelId || ("teaspeak-ipc-events-" + guid());
        this.broadcastChannel = new BroadcastChannel(this.ipcChannelId);
        this.broadcastChannel.onmessage = event => this.handleIpcMessage(event.data, event.source, event.origin);
    }

    destroy() {
        if(this.broadcastChannel) {
            this.broadcastChannel.onmessage = undefined;
            this.broadcastChannel.onmessageerror = undefined;
            this.broadcastChannel.close();
        }

        this.broadcastChannel = undefined;
    }

    handleEvent(dispatchType: EventDispatchType, eventType: string, eventPayload: any) {
        if(this.localDispatchSymbol in eventPayload) {
            /* We dispatched that event */
            return;
        }

        try {
            this.broadcastChannel.postMessage({
                type: "event",
                source: this.localDispatchId,

                dispatchType,
                eventType,
                eventPayload,
            });
        } catch (error) {
            if(error instanceof DOMException && error.message.indexOf("could not be cloned") !== -1) {
                console.warn("[IPC] Failed to fire IPC event %s because an uncloneable object has been passed: %o", error);
                return;
            }

            throw error;
        }
    }

    private handleIpcMessage(message: any, _source: MessageEventSource | null, _origin: string) {
        if(message.source === this.localDispatchId) {
            /* It's our own event */
            return;
        }

        if(message.type === "event") {
            const payload = message.eventPayload;
            payload[this.localDispatchSymbol] = true;
            switch(message.dispatchType as EventDispatchType) {
                case "sync":
                    this.registry.fire(message.eventType, payload);
                    break;

                case "react":
                    this.registry.fire_react(message.eventType, payload);
                    break;

                case "later":
                    this.registry.fire_later(message.eventType, payload);
                    break;
            }
        }
    }
}