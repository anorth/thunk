// Message definitions for chrome message passing
import {SavedSearch} from "../model/SavedSearches";

export const PING_PONG = "PING_PONG";
export function pingPong(message: string) {
  return {
    type: PING_PONG,
    payload: {
      message
    }
  };
}

export const DOCS_REFRESH_REQUESTED = "DOCS_REFRESH_REQUESTED";
export function docsRefreshRequested() {
  return {
    type: DOCS_REFRESH_REQUESTED,
    payload: {}
  };
}

export const DOCS_REFRESH_BEGIN = "DOCS_REFRESH_BEGIN";
export function docsRefreshBegin() {
  return {
    type: DOCS_REFRESH_BEGIN,
    payload: {}
  };
}

export const DOCS_REFRESH_COMPLETE = "DOCS_REFRESH_COMPLETE";
export function docsRefreshComplete() {
  return {
    type: DOCS_REFRESH_COMPLETE,
    payload: {}
  };
}

export const SIGN_IN_REQUESTED = "SIGN_IN_REQUESTED";
export function signInRequested(authData: any) {
  return {
    type: SIGN_IN_REQUESTED,
    payload: {
      authData
    }
  };
}

export const SIGN_IN_FAILED = "SIGN_IN_FAILED";
export function signInFailed(authError: string) {
  return {
    type: SIGN_IN_FAILED,
    payload: {
      authError
    }
  };
}

export const SIGNED_IN = "SIGNED_IN";
export function signedIn() {
  return {
    type: SIGNED_IN,
    payload: {}
  };
}

export const SIGNED_OUT = "SIGNED_OUT";
export function signedOut() {
  return {
    type: SIGNED_OUT,
    payload: {}
  };
}

export const SAVE_SEARCH_REQUESTED = "SAVE_SEARCH_REQUESTED";
export function saveSearchRequested() {
  return {
    type: SAVE_SEARCH_REQUESTED,
    payload: {}
  };
}

export const SAVED_SEARCH_SELECTED = "SAVED_SEARCH_SELECTED";
export function savedSearchSelected(savedSearch: SavedSearch) {
  return {
    type: SAVED_SEARCH_SELECTED,
    payload: {
      savedSearch
    }
  };
}
