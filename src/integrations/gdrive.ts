import * as Bluebird from "bluebird";

import * as moment from "moment";
import * as querystring from "querystring";
import {Integration, ListingResult} from "../backend/Integration";
import {HttpFailure, UrlFetcher} from "../lib/UrlFetcher";
import {Document, DocumentContent, Person} from "../model/content";
import {InstanceSpec} from "../model/InstanceSpec";
import {searchResult, searchResultSet, SearchResultSet} from "../model/results";

import DEFAULT_AVATAR_URL from "./avatar-gdrive.png";

// https://developers.google.com/drive/api/v3/about-files
// An individual file lives within a shared drive, or "My Drive", but not both.
// Folders (application/vnd.google-apps.folder) contain only metadata.
// A single file in My Drive may be in multiple folders, but on a shared drive has only one parent folder.
// Content in a shared drive is owned by a group of users.
//
// A user may have access to a file because:
// - They created it in My Drive (corpus: user)
// - Another user created it (in My Drive or shared) and explicitly shared with them (corpus: user)
// - Another user created it (in My Drive or shared) and explicitly shared with the domain (corpus: domain)
// - It was created in a shared drive (corpus: drive/allDrives)
//
// From the other angle some notes on corpora:
// - user includes all docs accessed by the user, wherever they are
// - domain is *only* files explicitly shared with the domain (and not simply b/c in shared drive)
// - allDrives does include My Drive
// - allDrives does include files not in a shared drive but shared explicitly
// - allDrives does include files not in a shared drive but shared with the domain (incl. never viewed)
// ∴ I think allDrives is a superset of "domain" and "user"
//
// Since allDrives is subject to truncated searches if they are too expensive, we should probably
// move to listing shared drives individually.
// See https://developers.google.com/drive/api/v3/enable-shareddrives#including_shared_drive_content_fileslist

const I9N_NAME = "gdrive";

// Thunk browser extension (thunk-extension-2019) - 'Thunk Chrome Extension'
const CLIENT_ID = "126742556121-07rk9a9nbn42b806tu75tu11as51jq0q.apps.googleusercontent.com";
const OAUTH_URL_BASE = "https://accounts.google.com/o/oauth2/auth";

const SCOPES = Object.freeze([
  "profile",
  "https://www.googleapis.com/auth/drive.readonly"
]);

/** Parameters for listing methods. */
const DISCOVERY_QUERIES = Object.freeze([
  // Documents in the domain, in order of recent modification
  {corpora: "allDrives", orderBy: "modifiedTime desc"}, // TODO: "not viewed by me" to exclude below
  // Documents viewed by me, in order of recent modification (by anyone)
  {corpora: "user", orderBy: "modifiedTime desc"},
  // Documents viewed by me, in order of recent view
  {corpora: "user", orderBy: "viewedByMeTime desc"}
]);

// Only (some) Google-native documents have exports links.
// Non-native files have a temporary-looking downloadUrl
// Also available: text/html, text/rtf
const EXPORT_TYPES = Object.freeze(["text/plain", "text/csv"]);

export type AuthData = void;

export class GDrive implements Integration<AuthData> {
  private accessToken: string | null;

  constructor() {
    this.accessToken = null;
  }

  get name() {
    return I9N_NAME;
  }

  get displayName() {
    return "Google Drive";
  }

  get sniffsCookies() {
    return false;
  }

  get exampleInstance() {
    return instanceSpec();
  }

  get homeUrl() {
    return "https://drive.google.com/drive/u/0/my-drive";
  }

  get defaultAvatarUrl() {
    return DEFAULT_AVATAR_URL;
  }

  public instances() {
    return [instanceSpec()];
  }

  public getPreferredInstance(instances: InstanceSpec[]): InstanceSpec {
    return instances[0];
  }

  public wasAuthenticated() {
    return requestOAuthToken(false).return(true).catch(() => false);
  }

  public checkAuthentication() {
    return requestOAuthToken(false)
        .then(accessToken => this.accessToken = accessToken)
        .return(true)
        .catch(() => false);
  }

  public willAuthenticationClosePopup(authData: AuthData) {
    return Bluebird.resolve(true);  // auth is interactive
  }

  public authenticate(authData: AuthData): Bluebird<GDrive> {
    return requestOAuthToken(true)
        .then(accessToken => this.accessToken = accessToken)
        .return(this);
  }

  public unauthenticate(): Bluebird<GDrive> {
    return new Bluebird<GDrive>((resolve/*, reject*/) => {
      const url = "https://accounts.google.com/logout";
      console.log("Requesting OAuth at " + url);
      chrome.identity.launchWebAuthFlow({url, interactive: false},
          () => {
            this.accessToken = null;
            ignore(chrome.runtime.lastError);
            resolve(this);
          });
    });
  }

  public listAllFiles(pageLimit: number, continuation?: string) {
    // TODO: Add stopping condition such as oldest modification date
    const params = {
      corpora: "allDrives",
      pageSize: pageLimit,
      pageToken: continuation,
      q: 'mimeType!="application/vnd.google-apps.folder" and trashed=false',
      orderBy: "modifiedTime desc"
    };
    return fetchFilesList(params, this.accessToken);
  }

  /**
   * Lists files that may be recently interesting due to the user's or other activity.
   */
  public listInterestingFiles(limit: number) {
    const params = {
      pageSize: limit,
      q: 'mimeType!="application/vnd.google-apps.folder" and trashed=false'
    };
    const queries = DISCOVERY_QUERIES.map(listingParams =>
        fetchFilesList(Object.assign({}, listingParams, params), this.accessToken));
    return Bluebird.all(queries).then(results => {
      const uniques: Document[] = [];
      const ids: { [key: string]: boolean } = {};
      results.flatMap((r: ListingResult) => r.items).forEach((item: Document) => {
        if (!ids[item.id]) {
          uniques.push(item);
          ids[item.id] = true;
        }
      });
      return uniques;
    });
  }

  /**
   * Lists files matching a search query
   */
  public search(query: string, limit = 30): Bluebird<SearchResultSet> {
    query = query.trim();
    // mimeType!="application/vnd.google-apps.folder"
    const params = {
      pageSize: limit,
      q: `trashed=false and fullText contains '${query}'`
    };

    return fetchFilesList(Object.assign(params, {corpora: "allDrives"}), this.accessToken)
        .then(r => r.items)
        .then(docs => searchResultSet(docs.map(d => searchResult(d)), docs.length));
  }

  public profile() {
    const params = {
      fields: "user",
    };
    return gapiGet("https://www.googleapis.com/drive/v2/about", params, this.accessToken)
        .then(result => {
          const u = result.data.user;
          return ({
            displayName: u.displayName,
            emailAddress: u.emailAddress,
            // TODO(aschuck): set other properties, e.g. id, as needed
            id: null,
            profileUrl: null,
            thumbnailUrl: null
          });
        }).catch(HttpFailure, e => {
          if (e.transport) {
            console.error("Profile fetch failed in transport");
          } else {
            throw e;
          }
        });
  }

  /**
   * Fetches full content for a collection of items.
   *
   * Returns a promise of a list of content objects.
   */
  public fetchContent(docs: Document[]) {
    // TODO(anorth): Batch HTTP requests with Google's multipart batch thing.
    const fetchTimestamp = Date.now();
    const promises = docs.map(doc => {
      const exportLinks = doc.raw.exportLinks;
      let promisedContent: Bluebird<DocumentContent | void> = Bluebird.resolve();
      if (exportLinks) {
        const mimeType = first(EXPORT_TYPES.filter(t => !!exportLinks[t]));
        const exportUrl = !!mimeType ? exportLinks[mimeType] : null;

        if (exportUrl) {
          promisedContent = fetch(exportUrl, this.accessToken)
              .then(response => ({
                id: doc.id,
                version: doc.version, // Fetched at least this version
                modificationTimestamp: doc.modificationTimestamp,
                fetchTimestamp,
                mimeType,
                content: response.data
              }))
              .catch(e => console.error("Failed to export content for " + doc.id, e));
        }
      }
      return promisedContent;
    });
    return Bluebird.all(promises)
        .then(cs => cs.filter(c => !!c)
            .map((c: DocumentContent) => ({content: c, contributions: []})));

    function fetch(url: string, accessToken: string) {
      return UrlFetcher.get(url, {
        responseType: "text",
        headers: {
          Authorization: "Bearer " + accessToken
        }
      });
    }
  }
}

function instanceSpec() { return new InstanceSpec("drive.google.com", ""); }

function buildOAuthUrl(forceInteractive: boolean) {
  const query = {
    client_id: CLIENT_ID,
    scope: SCOPES.join(" "),
    response_type: "token",
    prompt: !!forceInteractive ? "select_account" : undefined,
    redirect_uri: chrome.identity.getRedirectURL("gdrive")
  };
  return OAUTH_URL_BASE + "?" + querystring.stringify(query);
}

function requestOAuthToken(interactive: boolean): Bluebird<string> {
  const url = buildOAuthUrl(interactive);
  console.log("Requesting " + (interactive ? "interactive " : "") + "Auth at " + url);
  return new Bluebird((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({url, interactive},
        (redirectUrl: string) => {
          console.log("OAuth redirected to " + redirectUrl);
          if (redirectUrl) {
            const hashQuery = redirectUrl.slice(redirectUrl.indexOf("#") + 1);
            const parsed = querystring.parse(hashQuery);
            if (parsed.access_token) {
              // FIXME(anorth): validate token
              // https://developers.google.com/identity/protocols/OAuth2UserAgent#validatetoken
              resolve(parsed.access_token as string);
            } else {
              reject(new Error(parsed.error as string));
            }
          } else {
            // FIXME(anorth): This fails when offline and logs the user out, requiring re-auth
            const err = chrome.runtime.lastError || {message: "Unknown error"};
            reject(new Error("No OAuth redirect. " + err.message));
          }
        });
  });
}

/**
 * Fetches items from GDrive files list.
 */
function fetchFilesList(parameters: any, accessToken: string): Bluebird<ListingResult> {
  // Default sort order appears to be 'modifiedDate desc'
  // Drive UI Recent view is 'recency desc'
  const params = Object.assign({
    // Defaults, overridden by parameters
    pageSize: 30,
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
    spaces: "drive", // not "appData" or "photos"
    fields: "*",
  }, parameters);
  // fields: "nextPageToken,incompleteSearch," +
  //     "files(kind,id,name,description,version,mimeType,createdTime,modifiedTime,viewedByMeTime,modifiedByMeTime,sharedWithMeTime," +
  //     "owners,parents,sharingUser,lastModifyingUser,webViewLink,webContentLink,iconLink,thumbnailLink,driveId)",

  return gapiGet("https://www.googleapis.com/drive/v3/files", params, accessToken)
      .then(result => ({
        items: result.data.files.map(asDocument),
        continuation: result.data.nextPageToken
      }));
}

function gapiGet(urlBase: string, params: any, accessToken: string): Bluebird<any> {
  const query = urlBase + "?" + querystring.stringify(params);
  return UrlFetcher.get(query, {
    headers: {
      Authorization: "Bearer " + accessToken
    }
  })
      .tap(r => console.debug(`Request ${urlBase}`, params, r))
      .tapCatch(e => {
        console.error(`Drive error requesting ${urlBase}: ${e}`);
      });
}

function asDocument(driveFile: any): Document {
  if (driveFile.kind !== "drive#file") {
    throw new Error(`${driveFile.kind} is not a drive#file`);
  }

  const owner: any | undefined = first(driveFile.owners);
  const parentId: any | undefined = first(driveFile.parents);

  return {
    id: driveFile.id,
    mimeType: driveFile.mimeType,
    creationTimestamp: timestamp(driveFile.createdTime),
    modificationTimestamp: timestamp(driveFile.modifiedTime),
    viewedTimestamp: timestamp(driveFile.viewedByMeTime),
    editedTimestamp: timestamp(driveFile.modifiedByMeTime),
    sharedTimestamp: timestamp(driveFile.sharedWithMeTime),
    creator: asPerson(owner), // N.B. Files in shared drives don't have an owner/creator
    sharer: asPerson(driveFile.sharingUser),
    lastModifier: asPerson(driveFile.lastModifyingUser),
    parentId: !!parentId ? parentId : undefined,
    title: driveFile.name,
    link: driveFile.webViewLink || driveFile.webContentLink,
    iconUrl: driveFile.iconLink,
    thumbnailUrl: driveFile.thumbnailLink,
    version: parseInt(driveFile.version, 10),
    locationPath: [],
    raw: driveFile
  };
}

function asPerson(driveUser: any): Person {
  if (!driveUser) { return null; }
  if (driveUser.kind !== "drive#user") {
    throw new Error(`${driveUser.kind} is not a drive#user`);
  }
  return {
    id: driveUser.permissionId,
    displayName: driveUser.displayName || "Anonymous",
    thumbnailUrl: !!driveUser.picture ? driveUser.picture.url : undefined,
    emailAddress: driveUser.emailAddress,
    profileUrl: null
  };
}

function timestamp(isoOrNull: string | null): number | undefined {
  if (!!isoOrNull) {
    return moment(isoOrNull).utc().valueOf();
  }
  return undefined;
}

function first<T>(array?: T[]): T | null {
  if (array && array.length) {
    return array[0];
  }
  return null;
}

/**
 * Does nothing. This exists to allow evaluating of chrome.runtime.lastError when it's known
 * to be set but not important.
 */
// tslint:disable-next-line:no-empty
function ignore(v: any) {
}

export default GDrive;
