import {median} from "../lib/median";

import {PersonResult, SearchResult, SearchResultSet} from "model/results";

class ScoringParams {
  constructor(
      readonly boosts = {
        // Query dependent boosts.
        // TODO(aschuck): uncomment once plumbed through to localindex.js.
        //title: 10,
        //body: 1,

        // Query independent boosts.
        freshness: 0.5
      }
  ) {}
}

/**
 * Scores search results.
 */
// TODO(aschuck): extract this class to scoring/ subfolder once Boost class etc is added.
export class Scorer {
  private params = new ScoringParams();

  // TODO(aschuck): change type signature to be rerank(SearchResultSet) -> SearchResultSet
  public rerank(results: SearchResult[], peopleResults: PersonResult[], limit: number): SearchResultSet {
    const now = Date.now();
    const timestamps = results.map(r => r.doc.modificationTimestamp);
    const medianModifiedTS = median(timestamps);
    const freshnessStats = {
      now,
      medianModifiedTS,
      modifiedTSs: timestamps
    };

    const debugLines = [`${results.length} results`];

    const sorted = results.map(r => this.scoreResult(r, now, medianModifiedTS))
      .sort((a, b) => a.score - b.score)
      .reverse();
    console.debug("_rerank", results, sorted);

    return {
      results: sorted.slice(0, limit || Number.MAX_SAFE_INTEGER),
      peopleResults,
      totalCount: sorted.length,
      debugLines,
      debugStats: {
        freshness: freshnessStats  // generation of debug histogram/stats done lazily at render time
      }
    };
  }

  // TODO(aschuck): do not pass now, medianModifiedTS in here; rather initialize Boosters with the full
  // result set, and then in scoreResult applyBoost(result).
  private scoreResult(result: SearchResult, now: number, medianModifiedTS: number): SearchResult {
    const irScore = result.score;
    // TODO(aschuck): Make boost non-linear.
    const freshnessBoost = this.params.boosts.freshness *
        (result.doc.modificationTimestamp - medianModifiedTS) /
        (now - medianModifiedTS);
    // TODO(aschuck): make this multiplicative once we have usable scores for network results.
    const score = irScore + freshnessBoost;
    return Object.assign({}, result, {
      score,
      intermediate: {irScore, freshnessBoost}
    });
  }
}
