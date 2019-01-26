import * as Bluebird from "bluebird";
import {Contribution, Document, DocumentContent, Person} from "model/content";
import {InstanceSpec} from "../model/InstanceSpec";
import {SearchResultSet} from "../model/results";

// The result of listing an integration's documents.
export interface ListingResult {
  readonly items: Document[];
  readonly continuation?: string;
}

// The result of fetching content/history for a document.
export interface ContentResult {
  readonly content: DocumentContent;
  readonly contributions: Contribution[];
}

/**
 * Interface to a third-party service which can be indexed and searched.
 *
 * Abbreviated "i9n".
 * @param <T> type of authentication data
 */
export interface Integration<T> {

  /** The integration unique name. */
  name: string;
  /** User-visible name for the integration */
  displayName: string;
  /** Whether this integration inspects cookies for authentication and other information. */
  sniffsCookies: boolean;
  /** A template for an instance specification. */
  exampleInstance: InstanceSpec;
  /** URL of the integration home */
  homeUrl: string;
  /** URL of a default avatar image */
  defaultAvatarUrl: string;

  /** Returns instances of this integration. */
  instances(): InstanceSpec[];
  /** Chooses a preferred instance */
  getPreferredInstance(instances: InstanceSpec[]): InstanceSpec;

  /** Checks whether the integration has been authenticated. */
  wasAuthenticated(): Bluebird<boolean>;
  /** Checks whether the browser is currently authenticated. */
  checkAuthentication(): Bluebird<boolean>;
  /** Checks whether launching an authentication requires interactivity. */
  willAuthenticationClosePopup(authData: T): Bluebird<boolean>;
  /** Launches authentication flow, storing credentials if successful. */
  authenticate(authData: T): Bluebird<Integration<T>>;
  /** Clears authentication credentials. */
  unauthenticate(): Bluebird<Integration<T>>;

  /**
   * Lists all documents available, in pages of at most `count`.
   * The result includes an opaque continuation token, which may be passed to a subsequent call to
   * fetch another page of results.
   */
  listAllFiles(count: number, continuation?: string): Bluebird<ListingResult>;

  /**
   * Lists a single page of that are likely to be immediately "interesting" to the user.
   * This is a subset of "all files" intended to quickly refresh immediately-relevant documents for
   * discovery (as opposed to search).
   */
  listInterestingFiles(count: number): Bluebird<Document[]>;

  /** Fetches the full content for an array of documents. */
  fetchContent(docs: Document[]): Bluebird<ContentResult[]>;

  /** Executes a search query against the integration's built-in search interface. */
  search(q: string, limit?: number): Bluebird<SearchResultSet>;

  /**
   * Retrieves information about the authenticated user. Resolves with undefined if the request
   * fails transiently, otherwise rejects with HttpFailure or other Error.
   */
  profile(): Bluebird<Person | void>;
}

export interface Cookie {
  domain: string;
  name: string;
  path: string;

}
