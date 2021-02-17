import {EventMap, Event} from "./Events";

function s4() {
    return Math
        .floor((1 + Math.random()) * 0x10000)
        .toString(16)
        .substring(1);
}

export function guid() {
    return s4() + s4() + '-' + s4() + '-' + s4() + '-' + s4() + '-' + s4() + s4() + s4();
}

export function arrayRemove(array: any[], element: any) : boolean {
    const index = array.indexOf(element);
    if(index !== -1) {
        array.splice(index, 1);
        return true;
    } else {
        return false;
    }
}

/**
 * Turn the payload object into a bus event object
 * @param payload
 */
/* May inline this somehow? A function call seems to be 3% slower */
export function createEvent<P extends EventMap<P>, T extends keyof P>(type: T, payload?: P[T]) : Event<P, T> {
    if(payload) {
        (payload as any).type = type;
        let event = payload as any as Event<P, T>;
        event.as = as;
        event.asUnchecked = asUnchecked;
        event.asAnyUnchecked = asUnchecked;
        event.extractPayload = extractPayload;
        return event;
    } else {
        return {
            type,
            as,
            asUnchecked,
            asAnyUnchecked: asUnchecked,
            extractPayload
        } as any;
    }
}

function extractPayload() {
    const result = Object.assign({}, this);
    delete result["as"];
    delete result["asUnchecked"];
    delete result["asAnyUnchecked"];
    delete result["extractPayload"];
    return result;
}

function as(target) {
    if(this.type !== target) {
        throw "Mismatching event type. Expected: " + target + ", Got: " + this.type;
    }

    return this;
}

function asUnchecked() {
    return this;
}