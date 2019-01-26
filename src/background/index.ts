/* tslint:disable:no-console */
// Main background "page" entry point.
// This is an "event page" rather than persistent background page, so cannot keep state.
// See https://developer.chrome.com/extensions/event_pages

import * as Bluebird from "bluebird";

import {DocumentStore} from "../backend/DocumentStore";
import {Engine} from "../backend/Engine";
import {Fetcher} from "../backend/Fetcher";
import InstallationId from "../backend/InstallationId";
import {INTEGRATION_SINGLETON} from "../backend/Integrations";
import {Pipeline} from "../backend/Pipeline";
import {Scorer} from "../backend/Scorer";
import {ChromePlatform, MessagePort} from "../chrome/chromeplatform";
import {AuthData, GDrive} from "../integrations/gdrive";
import * as Messages from "../messaging/messages";
import {
  Message,
  QUERY_DISCOVERY_REQUEST,
  QUERY_SEARCH_REQUEST,
  queryDiscoveryResponse,
  querySearchResponse
} from "./engineproxy";

Bluebird.config({
  warnings: true,
  longStackTraces: true,
  cancellation: true,
  // monitoring: false,
});

console.debug("Background loading");

// Maximum number of docs to fetch and index locally.
// Other document can still be found (online) by falling back to searching the integration directly.
const TITLE_COUNT = 1500;
const FULLTEXT_COUNT = 100;

let installationId: InstallationId;
InstallationId.get().then(id => installationId = id);  // assumes quick resolution

const platform = new ChromePlatform();

// Integration is currently hardcoded to Google Drive. Goal is to support multiple in parallel.
const integration = INTEGRATION_SINGLETON;

const docStorePromise = DocumentStore.open(`${integration.name}-docs`)
    .tap(d => console.debug("Doc store ready", d));
const fetcherPromise = docStorePromise.then(
    docStore => new Fetcher(integration, docStore, platform, TITLE_COUNT + FULLTEXT_COUNT, FULLTEXT_COUNT))
    .tap(f => console.debug("Fetcher ready", f));
const pipelinePromise = docStorePromise.then(docStore => {
  const p = new Pipeline(docStore, TITLE_COUNT, FULLTEXT_COUNT);
  return p.reloadIndex().return(p);
}).tap(p => console.debug("Pipeline ready", p));
const enginePromise = pipelinePromise.then(pipeline =>
    new Engine(pipeline.docStore, pipeline.index, integration, new Scorer()))
    .tap(e => console.debug("Engine ready", e));

let refreshPromise: Bluebird<void>;

function refreshAllDocs() {
  fetcherPromise.done(fetcher => {
    if (refreshPromise) { refreshPromise.cancel(); }
    refreshPromise = fetcher.refreshAllDocs().then(ids =>
        pipelinePromise.then(p => p.reindexDocIds(ids))
    );
    refreshPromise.done();
  });
}

function refreshInterestingDocs() {
  return fetcherPromise.then(f => f.refreshInterestingDocs())
      .then(ids => pipelinePromise.then(p => p.reindexDocIds(ids)))
      .then(() => platform.sendMessage(Messages.docsRefreshComplete()));
}

function clearAllState() {
  if (refreshPromise) {
    refreshPromise.cancel();
  }
  Bluebird.join(fetcherPromise, pipelinePromise, (fetcher, pipeline) =>
      fetcher.clear().then(() => pipeline.clear())).done();
}

refreshAllDocs();
setInterval(refreshAllDocs, 60 * 60 * 1000);

///// Hook up index /////

console.debug("Installing Chrome port listeners");
platform.installPortConnectionListener(onPortReceived);
platform.addMessageReceiver(onBroadcastMessageReceived);

function onPortReceived(port: MessagePort) {
  console.debug(`Background received port "${port.name}"`);
  try {
    port.addMessageReceiver(portMessageHandler(port));
  } catch (e) {
    console.error(`Error adding message receiver for port "${port.name}"`, e);
  }
}

// Receives a message from the extension (but not messages broadcast by this background process).
function onBroadcastMessageReceived(msg: Message, sender: chrome.runtime.MessageSender) {
  try {
    const payload = msg.payload;
    console.debug(`Background received broadcast ${msg.type}`, payload);

    switch (msg.type) {
      case Messages.DOCS_REFRESH_REQUESTED:
        refreshInterestingDocs().done();
        break;
      case Messages.SIGN_IN_REQUESTED:
        signIn(payload.authData)
            .then(() => platform.sendMessage(Messages.signedIn()))
            .then(refreshInterestingDocs)
            .then(refreshAllDocs);
        break;
      case Messages.SIGNED_OUT:
        // Eek! We should not be relying on the on UI for this notification
        clearAllState();
        break;
    }
  } catch (e) {
    console.error("Error handling broadcast message", msg, e);
  }
}

function portMessageHandler(port: MessagePort) {
  let abortPreviousSearch: () => void = () => null;

  return (msg: Message) => {
    try {
      const payload = msg.payload;
      console.debug(`Background received message from port "${port.name}": ${msg.type}`, payload);

      switch (msg.type) {
        case Messages.PING_PONG:
          port.sendMessage(msg);
          break;
        case QUERY_DISCOVERY_REQUEST:
          enginePromise.then(engine => {
            return engine.queryDiscovery()
                .then(response => port.sendMessage(queryDiscoveryResponse(response)))
                .catch(e => console.error(e));

          }).done();
          break;
        case QUERY_SEARCH_REQUEST:
          abortPreviousSearch();
          const {q, limit, delegate} = payload;
          enginePromise.then(engine => {
            abortPreviousSearch = engine.querySearch(q, limit, delegate, (err, response) => {
              if (err) {
                console.error(err);
              } else {
                port.sendMessage(querySearchResponse(response));
              }
            });
          });
          break;
      }
    } catch (e) {
      console.error("Error handling port message", msg, e);
    }
  };
}

chrome.runtime.onInstalled.addListener(details => {
  console.log("Thunk installed", details);
});

function signIn<T>(authData: AuthData): Bluebird<void> {
  console.log("Signing in.");

  // NOTE(aschuck): we predict whether the popup will close during auth, to guarantee the user sees
  // any success / failure notifications.
  // An alternate implementation would be to have a notifier object listening to
  // broadcast messages (with awareness of the popup open/close state), showing notifications only
  // if the popup is closed. Approach avoided as awareness of popup open/close state is non-trivial.
  let popupClosed: boolean;

  // Build promise that succeeds if auth does.
  const promise = platform.ensureOnline()
      .then(() => integration.willAuthenticationClosePopup(authData))
      .tap(pc => popupClosed = pc)
      .tap(() => integration.authenticate(authData))
      .return();

  // Tap failures
  promise.tap(() => popupClosed && _notifySignedInUser())
      .catch(err => _handleSignInFailure(err, popupClosed))
      .done();

  return promise;
}

/**
 * @param {Error} err The authentication error.
 * @param {bool} popupClosed Was the browser popup window closed as a result of authentication?
 * @private
 */
function _handleSignInFailure(err: Error, popupClosed: boolean) {
  console.error(err);
  platform.sendMessage(Messages.signedOut());

  const authError = err.toString() || "Sign in failed";
  platform.sendMessage(Messages.signInFailed(authError));
  if (popupClosed) {
    _notifyAuthFailed(authError);
  }
  clearAllState();
}

function _notifySignedInUser(): void {
  return platform.browserActionShortcut().then(shortcut => {
    platform.notify(
        `You are now signed into ${platform.extensionName}`,
        shortcut ?
            `Press ${shortcut} or click the ${platform.extensionShortName} icon to search ${integration.displayName}.` :
            `Click the ${platform.extensionShortName} icon to search your ${integration.displayName}.`
    );
  }).done();
}

/** Notify the user that authentication failed, in the event that the popup window closed. */
function _notifyAuthFailed(authError: string) {
  platform.notify(
      `Unable to sign into ${platform.extensionShortName}: ${authError}`,
      `Sign in for ${integration.displayName} didn't quite work.\n` +
      `Please try again.`
  );
}
