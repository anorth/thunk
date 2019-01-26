import {Document, Person} from "./content";

// Return value from search()
export interface SearchResult {
  readonly doc: Document;
  readonly score: number;
  readonly intermediate: { irScore: number, freshnessBoost: number } | null;  // intermediate scoring data, used by rerank/scoring to calculate final score
  readonly debugLines: string[];
}

export interface PersonResult {
  readonly person: Person;
  readonly docCount: number;
  readonly contributionCount: number;
}

export interface SearchResultSet {
  readonly results: SearchResult[];
  readonly peopleResults: PersonResult[];
  readonly totalCount: number;
  readonly debugLines: string[];
  // to allow render-time computation of more debug lines (for performance reasons).
  // e.g. value: {freshness: {now: ..., medianModifiedTS: ..., modifiedTSs: [...]}}
  readonly debugStats: any;
}

// Builds a search result for a document (with optional score).
export function searchResult(doc: Document, score: number = -1): SearchResult {
  return {
    doc,
    score,
    intermediate: null,
    debugLines: []
  };
}

// Builds a set of serach results.
export function searchResultSet(results: SearchResult[], totalCount: number): SearchResultSet {
  return {
    results,
    totalCount,
    peopleResults: [],
    debugLines: [],
    debugStats: null
  };
}
