export interface SavedSearch {
  readonly displayName: string;
  readonly query: string;
}

export class SavedSearches {
  private saved: SavedSearch[] = [];

  public addSavedSearch(query: string) {
    const newSearch = {
      displayName: query,
      query
    };
    this.saved.push(newSearch);
    return Promise.resolve(newSearch);
  }

  public listSavedSearches() {
    return Promise.resolve(this.saved);
  }
}
