import * as Bluebird from "bluebird";
import ErrorSubclass from "../lib/ErrorSubclass";

// Shims the Chrome platform libraries for future testability.

export class OfflineFailure extends ErrorSubclass {
  constructor() {
    super("Browser is offline.");
  }
}

export type Handle = number;

// Browser-independent cookie info
interface Cookie {
  readonly domain: string;
  readonly name: string;
  readonly path: string;
}
type PortReceiver = (msg: object) => void;
type ChromePlatformReceiver = (message: any, sender: chrome.runtime.MessageSender,
    sendResponse: (response: any) => void) => void;

/**
 * Abstracts browser-specific platform stuff.
 */
export class ChromePlatform {
  private listeners: ListenerCollection<ChromePlatformReceiver>;

  constructor() {
    this.listeners = new ListenerCollection();
  }

  public get extensionVersion() {
    if (chrome.runtime.getManifest) {
      return chrome.runtime.getManifest().version;
    } else {
      return null;
    }
  }

  public get extensionName() {
    if (chrome.runtime.getManifest) {
      return chrome.runtime.getManifest().name;
    } else {
      return "Thunk";
    }
  }

  public get extensionShortName() {
    if (chrome.runtime.getManifest) {
      return chrome.runtime.getManifest().short_name;
    } else {
      return "Thunk";
    }
  }

  /**
   * Fetches a list of cookies from the browser.
   */
  public getCookies() {
    if (chrome.cookies) {
      return new Bluebird((resolve, _) => chrome.cookies.getAll({}, resolve))
          .then((cookies: chrome.cookies.Cookie[]) => cookies.map(({domain, name, path}) => ({domain, name, path})));
    } else {
      return Bluebird.resolve([]);
    }
  }

  /**
   * Fetches a list of open tabs for the current domains.
   * @param domains Imm.Seq of str
   */
  public getOpenTabUrls(domains: string[]) {
    if (chrome.tabs) {
      return new Bluebird((resolve, _) => chrome.tabs.query({
        url: domains.map(d => `*://*.${d}/*`)
      }, resolve))
          .then((tabs: chrome.tabs.Tab[]) => tabs.map(t => t.url));
    } else {
      return Bluebird.resolve([]);
    }
  }

  /**
   * Ensures that the browser has a network connection, i.e. is online.
   */
  public ensureOnline(): Bluebird<void> {
    return new Bluebird((resolve, reject) => {
      navigator.onLine ? resolve() : reject(new OfflineFailure());
    });
  }

  /**
   * Gets the keyboard shortcut associated with the extension's browser action, or null if none
   * exists.
   */
  public browserActionShortcut(): Bluebird<string> {
    return new Bluebird((resolve/*, reject*/) => {
      if (!chrome.commands) {
        resolve(null);
      }
      chrome.commands.getAll((commands) => {
        const browserActionCommand = commands.find((c) => c.name === "_execute_browser_action");
        const shortcut = browserActionCommand ? browserActionCommand.shortcut : null;
        resolve(shortcut);
      });
    });
  }

  /**
   * Creates a browser notification, which can be displayed even if the popup window is closed.
   */
  public notify(title: string, message: string) {
    // CSP prevents localhost for notifications, so use a relative URL for development.
    // For simplicity, use same icon for prod too, which happens to be cached for the chrome store.
    const ICON_PATH = "../icon-128.png";

    chrome.notifications.create(null, {
      type: "basic",
      title,
      message,
      iconUrl: ICON_PATH
    });
  }

  /**
   * Sends a message to registered receivers.
   *
   * Note that this can send a message from the background to the content script, or vice-versa, but not send
   * messages within the background script.
   */
  public sendMessage(msg: any) {
    console.debug("sendMessage", msg);
    chrome.runtime.sendMessage(msg);
  }

  /**
   * Adds a receiver for all messages.
   *
   * @returns a handle by which the receiver can be removed
   */
  public addMessageReceiver(receiver: ChromePlatformReceiver): Handle {
    const chromeListener: ChromePlatformReceiver = (request, sender, sendResponse) => {
      try {
        receiver(request, sender, sendResponse);
      } catch (e) {
        console.error("Error in broadcast message receiver", e);
      }
    };
    const handle = this.listeners.add(chromeListener);
    chrome.runtime.onMessage.addListener(chromeListener);
    return handle;
  }

  /**
   * Removes a previously registered receiver.
   * @param handle {Symbol} from addMessageReceiver
   */
  public removeMessageReceiver(handle: Handle) {
    const chromeListener = this.listeners.remove(handle);
    if (chromeListener) {
      chrome.runtime.onMessage.removeListener(chromeListener);
    } else {
      console.error("Attempted to remove unregistered broadcast receiver");
    }
  }

  public connectPort(name: string): MessagePort {
    const chromePort = chrome.runtime.connect({name});
    chromePort.onDisconnect.addListener(() => console.log("Chrome port disconnected: " + name));
    return new MessagePort(chromePort, name);
  }

  public installPortConnectionListener(callback: (port: MessagePort) => void) {
    const chromeListener = (port: chrome.runtime.Port) => {
      try {
        callback(new MessagePort(port, port.name));
      } catch (e) {
        console.error(`Error in port receiver for ${port.name}`, e);
      }
    };
    chrome.runtime.onConnect.addListener(chromeListener);
  }
}

/** Wraps a chrome message port, catching errors raised by message handlers. */
export class MessagePort {
  // This class might be a bit superfluous, consider inlining it.
  public readonly name: string;

  private chomePort: chrome.runtime.Port;
  private listeners: ListenerCollection<PortReceiver>;

  constructor(chromePort: chrome.runtime.Port, name: string) {
    this.chomePort = chromePort;
    this.name = name;
    this.listeners = new ListenerCollection();
  }

  public sendMessage(msg: object) {
    this.chomePort.postMessage(msg);
  }

  public addMessageReceiver(receiver: PortReceiver): Handle {
    const chromeListener = (msg: object) => {
      try {
        receiver(msg);
      } catch (e) {
        console.error(`Error in message receiver for port ${this.name}`, e);
      }
    };
    const handle = this.listeners.add(chromeListener);
    this.chomePort.onMessage.addListener(chromeListener);
    return handle;
  }

  public removeMessageReceiver(handle: Handle) {
    const listener = this.listeners.remove(handle);
    if (listener) {
      this.chomePort.onMessage.removeListener(listener);
    } else {
      console.error("Attempted to remove unregistered message receiver from port", this);
    }
  }

  public close() {
    this.chomePort.disconnect();
    this.chomePort = null;
    this.listeners = null;
  }
}

/** A collection of listeners keyed by handle (rather than identity). */
// tslint:disable-next-line:ban-types
class ListenerCollection<T extends Function> {
  private readonly listeners: { [key: number]: T };
  // Note: I'd prefer to use Symbol as the key, but Typescript can't handle it as an index key
  // https://github.com/Microsoft/TypeScript/issues/1863
  private nextHandle = 1;

  constructor() {
    this.listeners = {};
  }

  public add(receiver: T): Handle {
    const handle = this.nextHandle++;
    this.listeners[handle] = receiver;
    return handle;
  }

  public remove(handle: Handle): T {
    const listener = this.listeners[handle];
    if (listener) {
      delete this.listeners[handle];
    }
    return listener;
  }
}
