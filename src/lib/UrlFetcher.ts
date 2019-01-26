import axios, {AxiosResponse} from "axios";
import * as Bluebird from "bluebird";

import ErrorSubclass from "./ErrorSubclass";

export class HttpFailure extends ErrorSubclass {
  public readonly url: string;
  public readonly status: number;
  public readonly body: string | object;

  // Notes
  // Status=0 includes DNS name not resolved, being offline
  constructor(url: string, status: number, body: object | string) {
    const bodyStr = body instanceof Object ? JSON.stringify(body) : body;  // avoid "[object Object]"
    super(`HTTP request to ${url} failed with status ${status}: "${bodyStr}"`);
    this.url = url;
    this.status = status;
    this.body = body;
  }

  /**
   * Human readable error string, to be displayed to the end-user.
   * @returns str
   */
  public toDisplayString() {
    return `HTTP request to ${this.url} failed with status ${this.status}`;
  }

  public get transport() { return this.status === 0; }

  public get server() { return !this.transport; }

  public get permanent() { return this.status >= 400 && this.status < 500; }
}

/**
 * Utility for fetching URLs.
 *
 * Wraps axios so that exceptions are thrown in the failure case, rather than an Object response.
 */
export class UrlFetcher {
  public static get(url: string, config: object = null): Bluebird<any> {
    return Bluebird.resolve(axios.get(url, config))
        .catch(response => UrlFetcher.handleError(url, response));
  }

  public static put(url: string, data: object = null, config: object = null): Bluebird<any> {
    return Bluebird.resolve(axios.put(url, data, config))
        .catch(response => UrlFetcher.handleError(url, response));
  }

  private static handleError(url: string, response: AxiosResponse) {
    if (response instanceof Error) {
      // Something happened in setting up the request that triggered an Error
      throw response;
    } else {
      // The request was made, but the server responded with a status code
      // that falls out of the range of 2xx.
      throw new HttpFailure(url, response.status, response.data);
    }
  }
}
