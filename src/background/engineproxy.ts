
import {DiscoveryResponse, SearchResponse} from "backend/Engine";
import {ChromePlatform, MessagePort} from "chrome/chromeplatform";

export interface Message {
  type: string;
  payload: any;
}

export const QUERY_DISCOVERY_REQUEST = "QUERY_DISCOVERY_REQUEST";
export function queryDiscoveryRequest(): Message {
  return {
    type: QUERY_DISCOVERY_REQUEST,
    payload: {}
  };
}

export const QUERY_DISCOVERY_RESPONSE = "QUERY_DISCOVERY_RESPONSE";
export function queryDiscoveryResponse(response: any): Message {
  return {
    type: QUERY_DISCOVERY_RESPONSE,
    payload: {
      response
    }
  };
}

export const QUERY_SEARCH_REQUEST = "QUERY_SEARCH_REQUEST";
export function querySearchRequest(q: string, limit: number, delegate: boolean): Message {
  return {
    type: QUERY_SEARCH_REQUEST,
    payload: {q, limit, delegate}
  };
}

export const QUERY_SEARCH_RESPONSE = "QUERY_SEARCH_RESPONSE";
export function querySearchResponse(response: any): Message {
  return {
    type: QUERY_SEARCH_RESPONSE,
    payload: {
      response
    }
  };
}

/**
 * Proxies search requests through a message port, sending responses to a single listener
 * callback for each type.
 */
export class EngineProxy {
  private port: MessagePort;
  private discoveryResponseCallback: (err: Error, response: DiscoveryResponse) => void;
  private searchResponseCallback: (err: Error, response: SearchResponse) => void;

  constructor(platform: ChromePlatform) {
    this.port = platform.connectPort("engine");
    this.discoveryResponseCallback = null;
    this.searchResponseCallback = null;

    this.port.addMessageReceiver(this.onPortMessage.bind(this));
  }

  /** Registers discovery response callback. */
  public onDiscoveryResponse(callback: (err: Error, response: DiscoveryResponse) => void) {
    this.discoveryResponseCallback = callback;
  }

  /** Registers search response callback. */
  public onSearchResponse(callback: (err: Error, response: SearchResponse) => void) {
    this.searchResponseCallback = callback;
  }

  public queryDiscovery() {
    this.port.sendMessage(queryDiscoveryRequest());
  }

  public querySearch(q: string, limit: number, delegate: boolean) {
    this.port.sendMessage(querySearchRequest(q, limit, delegate));
  }

  private onPortMessage(msg: any) {
    console.log("EngineProxy received", msg);
    if (msg.type === QUERY_DISCOVERY_RESPONSE && this.discoveryResponseCallback) {
      const response = msg.payload.response as DiscoveryResponse;
      this.discoveryResponseCallback(null, response);
    } else if (msg.type === QUERY_SEARCH_RESPONSE && this.searchResponseCallback) {
      const response = msg.payload.response as SearchResponse;
      this.searchResponseCallback(null, response);
    }
  }
}
