import * as Bluebird from "bluebird";
import {ChromePlatform} from "../chrome/chromeplatform";
import ErrorSubclass from "../lib/ErrorSubclass";
import {HttpFailure} from "../lib/UrlFetcher";
import * as Messages from "../messaging/messages";
import {Document, DocumentContent} from "../model/content";
import {Batch} from "./Batch";
import {DocumentStore} from "./DocumentStore";
import {Integration, ListingResult} from "./Integration";

const FETCH_INTERESTING_COUNT = 25;
const BATCH_SIZE = 150;
const CONTENT_BATCH_SIZE = 10;

const CONTENT_FETCH_CONCURRENCY = 2;

export class Fetcher {
  private readonly i9n: Integration<any>;
  private readonly docStore: DocumentStore;
  private readonly platform: ChromePlatform;
  private readonly fetchCount: number;
  private readonly fulltextCount: number;

  public constructor(integration: Integration<any>, docStore: DocumentStore, platform: ChromePlatform,
      fetchCount: number, fulltextCount: number) {
    this.i9n = integration;
    this.docStore = docStore;
    this.platform = platform;
    this.fetchCount = fetchCount;
    this.fulltextCount = fulltextCount;
  }

  /**
   * Refreshes the most interesting docs and stores them in the doc store.
   *
   * @returns a promise resolving to the ids of refreshed docs
   */
  public refreshInterestingDocs(): Bluebird<string[]> {
    return this.i9n.checkAuthentication()
        .then(authenticated => {
          if (authenticated) {
            console.log("Beginning refresh of interesting docs");
            this.platform.sendMessage(Messages.docsRefreshBegin());
            return this.i9n.listInterestingFiles(FETCH_INTERESTING_COUNT);
          } else {
            console.log("Skipping refresh, not authenticated");
            return [];
          }
        })
        .tap(items => this.docStore.putDocuments(items))
        .then(items => {
          console.log(`Refreshed ${items.length} interesting docs`);
          return items.map(item => item.id);
        })
        .catch(err => {
          recordFailure(err, "Refresh interesting docs");
          return [];
        });
  }

  /**
   * Refreshes all docs and stores them in the doc store.
   *
   * TODO(anorth): Stop refreshing when up to date with previous refreshes.
   * @returns a promise resolving to the ids of all documents fetched
   */
  public refreshAllDocs(): Bluebird<string[]> {
    const self = this;
    const platform = this.platform;
    const i9n = this.i9n;
    const docStore = this.docStore;
    let cancelled = false;
    let contentPromise = Bluebird.resolve();
    return i9n.checkAuthentication()
        .then(authenticated => {
          if (!authenticated) {
            console.log("Skipping full refresh, not authenticated");
            return [];
          }

          return new Bluebird<string[]>((resolve: (ids: string[]) => void, reject) => {
            console.log("Beginning refresh of all docs");
            platform.sendMessage(Messages.docsRefreshBegin());
            const fetchedIds: string[] = [];
            let contentFetched = 0;
            fetchPage(BATCH_SIZE);

            function fetchPage(batchSize: number, continuation?: string) {
              i9n.listAllFiles(batchSize, continuation)
                  .then(handlePageResults)
                  .catch(err => {
                    recordFailure(err, "Refresh all docs");
                    reject(err);
                  })
                  .done();
            }

            function handlePageResults(page: ListingResult) {
              console.debug(`Received ${page.items.length} docs, continuation: ${page.continuation}`);
              if (cancelled) {
                platform.sendMessage(Messages.docsRefreshComplete());
                console.log(`Refresh all done, fetched ${fetchedIds.length} docs`);
                resolve(fetchedIds);
                return;
              }
              return docStore.putDocuments(page.items).then(() => {
                if (contentFetched < self.fulltextCount) {
                  const contentToFetch = Math.min(self.fulltextCount - contentFetched, page.items.length);
                  contentFetched += contentToFetch;
                  const itemsToFetch = page.items.slice(0, contentToFetch);
                  contentPromise = self.fetchFullContent(itemsToFetch, () => cancelled)
                      .catch(err => recordFailure(err, "Fetch content"))
                      .return();
                } else {
                  contentPromise = Bluebird.resolve();
                }

                contentPromise.done(() => {
                  fetchedIds.push(...page.items.map(i => i.id));
                  if (page.continuation && !cancelled && fetchedIds.length < self.fetchCount) {
                    fetchPage(BATCH_SIZE, page.continuation);
                  } else {
                    platform.sendMessage(Messages.docsRefreshComplete());
                    console.log(`Refresh all done, fetched ${fetchedIds.length} docs`);
                    resolve(fetchedIds);
                  }
                });
                return null; // Indicate we didn't forget to return contentPromise.
              });
            }
          });
        })
        .catch(Bluebird.CancellationError, e => {
          // FIXME: Bluebird cancellation semantics changed in V3 such that this block is probably
          // never entered.
          console.log("Refresh cancelled");
          cancelled = true;
          contentPromise.cancel();
          throw e; // Don't swallow it
        })
        .catch(err => {
          console.log("Refreshing all docs failed. " + err);
          return [];
        });
  }

  public fetchFullContent(docs: Document[], getCancelled: () => boolean) {
    const existingContent = this.docStore.getDocumentContents(docs.map(d => d.id))
        .then(contents => new Map(contents.map(c => [c.id, c] as [string, DocumentContent])));

    // Skip fetching docs that haven't changed version. Note that when we have comments, this
    // only works if comments bump the version number (which Confluence doesn't).
    return existingContent.then(existing => {
      function hasNewContent(doc: Document) {
        const e = existing.get(doc.id);
        const docVersion = doc.version || 0;
        return !(e && e.version && e.version >= docVersion);
      }

      const docsToRefresh = docs.filter(hasNewContent);
      const batches = Batch.ofSize(CONTENT_BATCH_SIZE).seq(docsToRefresh);

      return Bluebird.map(batches, batch => {
        return this.i9n.fetchContent(batch).then(results => {
          console.debug(`Fetched content for ${results.length} of ${batch.length} stale docs`);
          if (!getCancelled()) {
            const stored = results.map(cr => Bluebird.all([
              this.docStore.putDocumentContent(cr.content)
                  .catch(e => console.error("Failed to store contents", e)),
              this.docStore.putContributions(cr.contributions)
                  .catch(e => console.error("Failed to store contributions", e))
            ]));
            return Bluebird.all(stored);
          }
        });
      }, {concurrency: CONTENT_FETCH_CONCURRENCY});
    });
  }

  /** Removes all docs */
  public clear() {
    this.platform.sendMessage(Messages.docsRefreshBegin());
    return this.docStore.clear()
        .tap(() => console.log("Document store cleared"))
        .tap(() => this.platform.sendMessage(Messages.docsRefreshComplete()))
        .return(this);
  }
}

function recordFailure(err: ErrorSubclass, contextMsg: string) {
  if (err instanceof HttpFailure && err.transport) {
    console.debug("Fetch failed in transport");
  } else {
    console.error("Failure in " + contextMsg, err);
    // TODO: log to Airbrake or similar
  }
}
