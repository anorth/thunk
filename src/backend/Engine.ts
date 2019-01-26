import * as Bluebird from "bluebird";
import {HttpFailure} from "../lib/UrlFetcher";
import {Document, Person} from "../model/content";
import {PersonResult, searchResult, SearchResult, SearchResultSet} from "../model/results";
import {Direction, DocumentStore, Index} from "./DocumentStore";
import {Integration} from "./Integration";
import LocalIndex from "./LocalIndex";
import {Scorer} from "./Scorer";

export interface DiscoveryResponse {
  readonly myDocs: SearchResultSet;
  readonly orgDocs: SearchResultSet;
}

export interface SearchResponse {
  query: string;
  results: SearchResultSet;
  isFinished: boolean; // True for the last response
}

// Maximum number of discovery results.
const DISCO_RESULT_LIMIT = 4;
// Minimum number of "viewed by me" results included in discovery results.
const MIN_VIEWED_INCLUDED = 2;
// A timestamp a long way from now.
const FAR_FUTURE_TIMESTAMP = 4000111000111; // ~ yr 2100

/** Search and discovery logic. */
export class Engine {
  private readonly docStore: DocumentStore;
  private readonly localIndex: LocalIndex;
  private readonly i9n: Integration<any>;
  private readonly scorer: Scorer;

  constructor(docStore: DocumentStore, localIndex: LocalIndex, integration: Integration<any>, scorer: Scorer) {
    this.docStore = docStore;
    this.localIndex = localIndex;
    this.i9n = integration;
    this.scorer = scorer;
  }

  /** Queries for discovery documents, provided to a callback. The callback will be invoked only once. */
  public queryDiscovery(): Bluebird<DiscoveryResponse> {
    // Build LHS from a few queries to ensure populated even for anon/idle users.
    const viewedByMe = this.docStore.listDocuments(DISCO_RESULT_LIMIT, Index.VIEWED, Direction.DESC);
    const modifiedByMe = this.docStore.listDocuments(100, Index.MODIFIED_BY_ME, Direction.DESC);

    // A document comparison key function which orders by viewed timestamp if it exists, else by modification
    // timestamp, with all modification timestamps preceding (older than) view timestamps.
    const compareKey = (d: Document) => d.viewedTimestamp ||
        (d.modificationTimestamp - FAR_FUTURE_TIMESTAMP);

    const findMyDocs = Bluebird.join(viewedByMe, modifiedByMe, (viewed, edited) => {
      console.debug(`Building disco result from ${viewed.length} viewed and ${edited.length} modified docs`);
      // Ensure 2 most recently viewed docs, but then prefer modifiedByMe docs (which may also be recently viewed)
      let included: Map<string, Document> = new Map();
      viewed.slice(0, MIN_VIEWED_INCLUDED).forEach(d => included = included.set(d.id, d));
      edited.filter(d => !included.has(d.id))
          .sort((d1, d2) => compareKey(d1) - compareKey(d2)).reverse()
          .slice(0, DISCO_RESULT_LIMIT - included.size)
          .forEach(d => included = included.set(d.id, d));
      viewed.slice(MIN_VIEWED_INCLUDED, MIN_VIEWED_INCLUDED + DISCO_RESULT_LIMIT - included.size)
          .forEach(d => included = included.set(d.id, d));

      return included;
    });

    const modifiedNotEdited = this.docStore.listDocuments(100, Index.MODIFIED, Direction.DESC)
        .then(docs => docs.filter(d => !d.editedTimestamp));

    const findOrgDocs = Bluebird.join(findMyDocs, modifiedNotEdited,
        (myDocs, modifedDocs) => {
          // const myDocIds = new Set(myDocs.keys());
          return modifedDocs
              .filter(d => !myDocs.has(d.id))
              .slice(0, DISCO_RESULT_LIMIT);
        });

    return Bluebird.join(findMyDocs, findOrgDocs, (myDocs, orgDocs) => {
      const peopleResults: PersonResult[] = [];
      return {
        myDocs: this.scorer.rerank(Array.from(myDocs.values()).map(d => searchResult(d)), peopleResults, DISCO_RESULT_LIMIT),
        orgDocs: this.scorer.rerank(orgDocs.map(d => searchResult(d)), peopleResults, DISCO_RESULT_LIMIT)
      };
    });
  }

  /**
   * Queries for documents, providing results to a callback. The callback may be invoked
   * multiple times with progressively enhanced results.
   *
   * @param q {string} query string
   * @param limit max number of results to fetch
   * @param delegate whether to also query the integration as a delegate
   * @param callback {function(error, response)} receives results
   * @return a function which cancels any pending results
   */
  public querySearch(q: string, limit: number, delegate: boolean, callback: (e: Error, response: SearchResponse) => void) {
    const hits = this.localIndex.search(q);
    const hitIds = new Set(hits.map(hit => hit.id));
    const hitIdArray = Array.from(hitIds);
    const idToScore = new Map(hits.map(hit => [hit.id, hit.score] as [string, number]));
    const localResults: Bluebird<SearchResult[]> = this.docStore.getDocuments(hitIdArray)
        .then(docs => docs.map(doc => searchResult(doc, idToScore.get(doc.id) || -1)));
    const localPeopleResults = this.queryPeopleForDocuments(hitIdArray);

    let fullResults: Bluebird<SearchResult[]> = Bluebird.resolve([]);
    if (delegate) {
      fullResults = Bluebird.delay(80)
          .then(() => this.i9n.search(q))
          .then(remoteResults => {
            const newResults = remoteResults.results.filter(r => !hitIds.has(r.doc.id));
            return localResults.then(lr => lr.concat(newResults));
          })
          .catch(Bluebird.CancellationError, () => ([]))
          .catch(err => {
            if (err instanceof HttpFailure && err.transport) {
              console.debug("Search failed in transport");
            } else {
              console.error("Failure in i9n search", err);
            }
            return [];
          });
    }

    const fullPeopleResults = fullResults.then(full =>
        !!full ? this.queryPeopleForDocuments(full.map(r => r.doc.id)) : []);
    const localComplete = Bluebird.join(localResults, localPeopleResults, (results, people) => {
      callback(null, {
        query: q,
        results: this.scorer.rerank(results, people, limit),
        isFinished: !delegate
      });
    });

    if (delegate) {
      Bluebird.join(fullResults, fullPeopleResults, localComplete, (results, people) => {
        if (results) {
          callback(null, {
            query: q,
            results: this.scorer.rerank(results, people, limit),
            isFinished: true
          });
        }
      }).done();
    } else {
      localComplete.done();
    }

    return () => {
      if (!fullResults.isFulfilled()) {
        console.debug(`Cancelling delegate  query [${q}]`);
        fullResults.cancel();
      } else {
        console.debug(`Too late to cancel delegate query [${q}]`);
      }
    };
  }

  private queryPeopleForDocuments(docIds: string[]) {
    return this.docStore.findContributionsToDocs(docIds).then(contribs => {
      const authors: Map<string, Person> = new Map(); // docId -> person
      const docsByAuthor: Map<string, string[]> = new Map(); // personId -> [docids]
      contribs.filter(c => !!c.author).forEach(c => {
        authors.set(c.author.id, c.author);
        docsByAuthor.set(c.author.id, docsByAuthor.get(c.author.id) || []);
        docsByAuthor.get(c.author.id).push(c.docId);
      });
      const countsAndAuthors = Array.from(docsByAuthor, ([authorId, dIds]) => [new Set(dIds).size, authorId] as [number, string])
          .sort((a, b) => a[0] - b[0]);

      return countsAndAuthors.reverse()
          .slice(0, 5)
          .map(([count, authorId]) => ({
            person: authors.get(authorId),
            docCount: count,
            contributionCount: docsByAuthor.get(authorId).length
          }));
    });
  }
}
