/* tslint:disable:jsx-no-string-ref */
import {observable} from "mobx";
import {observer} from "mobx-react";
import * as moment from "moment";
import * as React from "react";
import {Integration} from "../../backend/Integration";
import {EngineProxy} from "../../background/engineproxy";
import {ChromePlatform, Handle} from "../../chrome/chromeplatform";
import * as Messages from "../../messaging/messages";
import {Person} from "../../model/content";
import {PersonResult, SearchResult, searchResultSet, SearchResultSet} from "../../model/results";

import "./Listing.scss";

export class ListingVM {
  @observable
  public discovery: DiscoveryState;
  @observable
  public localSearch: SearchState;
  @observable
  public comparisonSearch: SearchState;

  @observable
  public focusedKey: string | null; // For keyboard navigation

  @observable
  public debugEnabled: boolean;

  constructor() {
    this.debugEnabled = false;
    this.clearResults();
  }

  public discoveryFetching(fetching: boolean) {
    this.discovery.fetching = fetching;
  }

  public discoveryComplete(myDocs: SearchResultSet, orgDocs: SearchResultSet) {
    this.discovery.myDocs = myDocs;
    this.discovery.orgDocs = orgDocs;
    this.initFocusedKey();
  }

  public comparisonSearchFetching(query: string) {
    this.comparisonSearch = {fetching: true, query, resultSet: emptyResults()};
  }

  public comparisonSearchComplete(query: string, results: SearchResultSet) {
    this.comparisonSearch = {fetching: false, query, resultSet: results};
    this.initFocusedKey();
  }

  public localSearchFetching(query: string) {
    this.localSearch = {fetching: true, query, resultSet: this.localSearch.resultSet}; // Avoid flickering results.
  }

  public localSearchComplete(finished: boolean, query: string, results: SearchResultSet) {
    this.localSearch = {fetching: !finished, query, resultSet: results};
    this.initFocusedKey();
  }

  public clearResults() {
    this.discovery = {fetching: false, myDocs: emptyResults(), orgDocs: emptyResults()};
    this.localSearch = {fetching: false, query: null, resultSet: emptyResults()};
    this.comparisonSearch = {fetching: false, query: null, resultSet: emptyResults()};
  }

  public navigateResults(delta: number) {
    const keys = this.keysForResults();
    const idxToFocus = keys.indexOf(this.focusedKey) + delta;
    let keyToFocus = keys[idxToFocus];
    if (idxToFocus < 0 || idxToFocus >= keys.length) {  // keep within bounds
      keyToFocus = this.focusedKey;
    }

    this.focusedKey = keyToFocus;
  }

  public setDebug(debug: boolean) {
    this.debugEnabled = debug;
  }

  // Initialises the focusedKey from results, if it's not set and there are some.
  private initFocusedKey() {
    const keys = this.keysForResults();
    if (this.focusedKey && keys.indexOf(this.focusedKey) !== -1) {
      return;  // keep focus on same result if possible, to avoid jitter
    } else if (keys.length > 0) {
      this.focusedKey = keys[0];  // otherwise focus on the first result
    } else {
      this.focusedKey = null;
    }
  }

  private keysForResults(): string[] {
    const limit = numResultsToDisplay(this.debugEnabled);
    // TODO: support debug enabled, i.e. make comparisonSearch kb navigable
    // TODO: use displayedResults for rendering too, to avoid potential inconsistencies.
    const displayedResults = !!this.localSearch.query ?
        [this.localSearch.resultSet] :
        [this.discovery.myDocs, this.discovery.orgDocs];
    return displayedResults.flatMap(r => searchResultKeys(r, limit));
  }
}

interface SearchState {
  fetching: boolean;
  query: string;
  resultSet: SearchResultSet;
}

interface DiscoveryState {
  fetching: boolean;
  myDocs: SearchResultSet;
  orgDocs: SearchResultSet;
}

export interface ListingProps {
  platform: ChromePlatform;
  integration: Integration<any>;
  engine: EngineProxy;
  vm: ListingVM;
}

function emptyResults() {
  return searchResultSet([], 0);
}

function numResultsToDisplay(debugEnabled: boolean) {
  return debugEnabled ? 50 : 12;
}

const __DEVELOPMENT__ = false; // TODO: inject at build

@observer
export class ListingComponent extends React.Component<ListingProps> {
  private readonly platform: ChromePlatform;
  private readonly engine: EngineProxy;
  private readonly integration: Integration<any>;

  private receiver: Handle;
  private queryInput: HTMLInputElement | null;
  private focusedResult: ListingPerson | ListingDocument | null;

  constructor(props: ListingProps) {
    super(props);
    this.platform = props.platform;
    this.engine = props.engine;
    this.integration = props.integration;
  }

  public componentDidMount() {
    this.props.vm.localSearchComplete(true, null, emptyResults());

    // Register discovery result handler
    this.engine.onDiscoveryResponse((err, response) => {
      const mine = response.myDocs;
      const domain = response.orgDocs;
      if (mine.results.length || domain.results.length) {
        this.props.vm.discoveryComplete(mine, domain);
      }
    });

    // Register search result handler
    this.engine.onSearchResponse((err, response) => {
      if (err) {
        console.error("Error in query", err);
        return;
      }
      if (response.query !== this.queryInput.value) {
        return; // Abort if query has changed
      }
      this.props.vm.localSearchComplete(response.isFinished, response.query, response.results);
      if (response.isFinished) {
        if (this.props.vm.debugEnabled) {
          this.doSearch();
        }
      }
    });

    // Register platform message handler
    this.receiver = this.platform.addMessageReceiver((msg/*, sender, sendResponse*/) => {
      const payload = msg.payload;
      console.log("Listing received " + msg.type, payload);
      switch (msg.type) {
        case Messages.DOCS_REFRESH_BEGIN:
          this.props.vm.discoveryFetching(true);
          break;
        case Messages.DOCS_REFRESH_COMPLETE:
          this.props.vm.discoveryFetching(false);
          this.engine.queryDiscovery();
          break;
        case Messages.SAVED_SEARCH_SELECTED:
          if (payload.savedSearch.query) {
            this.queryInput.value = payload.savedSearch.query;
            this.doTypeahead();
          }
          break;
      }
    });

    this.engine.queryDiscovery();
    this.platform.sendMessage(Messages.docsRefreshRequested());
  }

  public componentWillUnmount() {
    this.engine.onDiscoveryResponse(null);
    this.engine.onSearchResponse(null);
    this.platform.removeMessageReceiver(this.receiver);
  }

  public render() {
    const self = this;
    const { discovery, localSearch, comparisonSearch, debugEnabled, focusedKey } = this.props.vm;
    this.focusedResult = null;  // the currently focused 'a' component, enter should trigger a 'click'

    return <div id="Listing" onKeyDown={self._handleKeyPress.bind(self)}>
      {renderSearchForm()}
      {!!localSearch.query ? renderSearchResults() : renderDiscovery()}
      {__DEVELOPMENT__ ? renderDebugControls() : null}
    </div>;

    function renderDebugControls() {
      // TODO: un-hardcode this list, e.g. use local storage
      const SAMPLE_QUERIES = ["jira", "swift", "ready", "7.0"];
      return <div className="debug-controls">
        <div className={"sample-queries" + (debugEnabled ? " enabled" : "")}>
          <h3>Sample queries:</h3>
          <ul>
            {/* tslint:disable-next-line:jsx-no-multiline-js jsx-no-lambda */}
            {SAMPLE_QUERIES.map(q => <li key={q}><a href="#" onClick={() => {
              self.queryInput.value = q;
              self.doTypeahead();
            }}>{q}</a></li>)}
          </ul>
        </div>
        {/* tslint:disable-next-line:jsx-no-lambda */}
        <a href="#" onClick={() => self.setDebug(!debugEnabled)}>(t)</a>
      </div>;
    }

    function renderDiscovery() {
      const context = {
        "context": "discover",
        "result count": discovery.myDocs.totalCount + discovery.orgDocs.totalCount,
        "mine result count": discovery.myDocs.totalCount,
        "domain result count": discovery.orgDocs.totalCount
      };
      return <div>
        <div className="file-listings discovery">
          {!!discovery.fetching ? <div className="spinner"/> : null}
          <div className={"file-list" + (discovery.myDocs.results.length === 0 ? " hidden" : "")}>
            <h3>My work</h3>
            {renderResultSet(discovery.myDocs, Object.assign({list: "mine"}, context))}
          </div>
          <div className="file-list">
            <h3>Recently</h3>
            {renderResultSet(discovery.orgDocs, Object.assign({list: "domain"}, context))}
          </div>
        </div>
      </div>;
    }

    function renderSearchResults() {
      const context = {
        "context": "search",
        "query": localSearch.query,
        "local result count": localSearch.resultSet.totalCount,
        "remote result count": comparisonSearch.resultSet.totalCount
      };
      return <div>
        {(() => {
          let secondaryList = <div className="file-list"/>;
          if (debugEnabled && comparisonSearch.resultSet.totalCount) {
            secondaryList = <div className="file-list">
              <h3>{self.integration.displayName} found {comparisonSearch.resultSet.totalCount ||
              "nothing"}</h3>
              {renderResultSet(comparisonSearch.resultSet,
                  Object.assign({list: "remote"}, context))}
            </div>;
          } else if (localSearch.resultSet.peopleResults.length) {
            const limit = numResultsToDisplay(debugEnabled);
            secondaryList = <div className="person-list">
              <h3>Contributors</h3>
              <ul>
                {localSearch.resultSet.peopleResults.slice(0, limit).map((personResult, idx) =>
                    <li key={personResult.person.id}>
                      <ListingPerson result={personResult}
                                     integration={self.integration}
                                     focused={personResult.person.id === focusedKey}
                                     ref={(c) => {if (personResult.person.id === focusedKey) { self.focusedResult = c; }}}
                      />
                    </li>)
                }
              </ul>
            </div>;
          }
          return <div className="file-listings search">
            {!!localSearch.fetching ? <div className="spinner"/> : null}
            <div className="file-list">
              <h3>{localSearch.resultSet.totalCount ?
                  "Found " + localSearch.resultSet.totalCount + ":" :
                  "Found nothing"}</h3>
              {renderResultSet(localSearch.resultSet, Object.assign({list: "local"}, context))}
            </div>
            {secondaryList}
          </div>;
        })()}
      </div>;
    }

    function renderResultSet(resultSet: SearchResultSet, context: any) {
      const limit = numResultsToDisplay(debugEnabled);
      return <div>
        {renderDebug(debugEnabled, resultSet.debugLines, resultSet.debugStats)}
        {resultSet.results.slice(0, limit).map((r, idx) =>
            <ListingDocument result={r}
                             focused={r.doc.id === focusedKey}
                             key={r.doc.id}
                             ref={(c) => {if (r.doc.id === focusedKey) { self.focusedResult = c; }}}
                             debugEnabled={debugEnabled}/>)}
      </div>;
    }

    function renderSearchForm() {
      return <div className="form-container">
        <form className="search-form" onSubmit={self.doSearch.bind(self)} autoComplete="off">
          <input ref={(e) => self.queryInput = e} type="text" name="q" size={30}
                 spellCheck={false}
                 placeholder={`Find something in ${self.integration.displayName}...`}
                 autoFocus={true}
                 onChange={self.doTypeahead.bind(self)}/>
        </form>
      </div>;
    }
  }

  private queryDiscovery() {
    this.engine.queryDiscovery();
  }

  private doSearch() {
    if (!this.props.vm.debugEnabled) { return; }
    const q = this.queryInput.value;

    if (q) {
      this.props.vm.comparisonSearchFetching(q);
      this.integration.search(q).then(resultSet => {
        this.props.vm.comparisonSearchComplete(q, resultSet);
      }).done();
    } else {
      this.props.vm.comparisonSearchComplete(q, emptyResults());
    }
  }

  private doTypeahead() {
    const query = this.queryInput.value;

    if (query) {
      const limit = numResultsToDisplay(this.props.vm.debugEnabled);
      this.props.vm.localSearchFetching(query);
      this.engine.querySearch(query, limit, true);
    } else {
      this.props.vm.localSearchComplete(true, query, emptyResults());
    }

    if (this.props.vm.comparisonSearch.resultSet) {
      this.props.vm.comparisonSearchComplete(query, emptyResults());
    }
  }

  private setDebug(enabled: boolean) {
    this.props.vm.setDebug(enabled);
  }

  private _handleKeyPress(e: KeyboardEvent) {
    const UP = 38;
    const DOWN = 40;
    const ENTER = 13;

    if (e.keyCode === UP || e.keyCode === DOWN) {
      e.preventDefault();  // prevents cursor jumping within query input field
      const delta = e.keyCode === UP ? -1 : 1;
      this.props.vm.navigateResults(delta);
    } else if (e.keyCode === ENTER) {
      if (this.focusedResult) {
        this.focusedResult.click();
      }
    }
  }
}

interface ListingDocumentProps {
  result: SearchResult;
  debugEnabled: boolean;

  focused: boolean; // For keyboard nav

}

class ListingDocument extends React.Component<ListingDocumentProps> {
  private anchor: HTMLAnchorElement;

  public render() {
    const { result, focused } = this.props;
    const file = result.doc;
    const icon = file.iconUrl ?
        <img alt="file icon" className="icon" src={file.iconUrl}/> :
        <div className={"icon icon-" + contentTypeClassname(file.mimeType)}/>;
    return <div className={"file result" + (focused ? " focused" : "")}>
      <div className="icon-container">
        {icon}
      </div>
      <div className="data-container">
        {/* FIXME handle keyboard modifiers on click */}
        <a href={file.link} target="_blank" className="title" ref={(e) => this.anchor = e}>{file.title}</a>
        <div className="metadata">
          <div className="location">
            {file.locationPath.slice(0, 1).map(l => <span className="item"
                                                      key={l.displayName}>{l.displayName}</span>)}
          </div>
          <span className="narration">
            {authorName(file.lastModifier)} updated {ago(file.modificationTimestamp)}
          </span>
        </div>
        {renderResultDebug(this.props.debugEnabled, result)}
      </div>
    </div>;
  }

  public click() {
    this.anchor.click();
  }
}

interface ListingPersonProps {
  result: PersonResult;
  integration: Integration<any>;
  focused: boolean; // For keyboard nav
}

class ListingPerson extends React.Component<ListingPersonProps> {
  private anchor: HTMLAnchorElement;

  public render() {
    const { result, integration, focused } = this.props;
    const person = result.person;
    // TODO(aschuck): make the default avatar fallback work for transparent avatars too.
    return <div className={"result person" + (focused ? " focused" : "")}>
      <div className="avatar"
    style={{backgroundImage: `url(${person.thumbnailUrl}), url(${integration.defaultAvatarUrl})`}}/>
      <div className="data">
        <div className="name">
          {/* FIXME handle keyboard modifiers on click */}
          <a href={person.profileUrl} target="_blank" className="title" ref={(e) => this.anchor = e}>{person.displayName}</a>
        </div>
        <div className="narration">
          {result.contributionCount} contributions to {result.docCount} pages
        </div>
      </div>
    </div>;
  }

  public click() {
    this.anchor.click();
  }
}

// Returns key strings for a search result set.
function searchResultKeys(rs: SearchResultSet, limit: number): string[] {
  return rs.results.slice(0, limit).map(r => r.doc.id)
      .concat(rs.peopleResults.slice(0, limit).map(r => r.person.id));
}

function authorName(person: Person) {
  const name = !!person ? person.displayName : "Anonymous";
  return <span className="author" title={name}>{name.split(" ")[0]} </span>;
}

function ago(d: number) {
  return !!d ? moment(d).fromNow() : "never";
}

function contentTypeClassname(contentType: string): string {
  if (!contentType) {
    return "";
  }
  return contentType.replace(/[^a-zA-Z-_]/g, "_");
}

///// Debug /////

function renderDebug(debugEnabled: boolean, debugLines: string[], debugStats: any) {
  if (debugEnabled) {
    return <div className="debug enabled">
      {debugLines.map((d: string, key: number) => <p key={key}>{d}</p>)}
      {renderDebugStats(debugStats)}
    </div>;
  }
}

function renderDebugStats(debugStats: any) {
  if (!debugStats) {
    return;
  }
  if (debugStats.freshness) {
    const ageHistogram = _debugAgeHistogram(debugStats.freshness);
    return ageHistogram.map((d, key) => <p key={key}>{d}</p>);
  }
}

function renderResultDebug(debugEnabled: boolean, result: SearchResult) {
  if (!debugEnabled) {
    return;
  }
  const doc = result.doc;
  const debugLines = [
      "SCORE:           " + result.score.toFixed(3),
      "IR score:        " + result.intermediate.irScore.toFixed(3),
      "Freshness boost: " + result.intermediate.freshnessBoost.toFixed(3),
      "",
      "Created:         " + ago(doc.creationTimestamp),
      "Modified:        " + ago(doc.modificationTimestamp),
      "Modified by me:  " + ago(doc.editedTimestamp),
      "Viewed:          " + ago(doc.viewedTimestamp),
  ];
  return <div className="debug enabled">
    {debugLines.map((d: string, key: number) => <p key={key}>{d}</p>)}
  </div>;
}

function _debugAgeHistogram(freshnessStats: any): string[] {
  return [];
  // const { now, medianModifiedTS, modifiedTSs } = freshnessStats;
  //
  // let debugLines = [
  //   `Median age: ${ago(medianModifiedTS)}`,
  //   "Distribution by months ago:"
  // ];
  //
  // const timeStamps = [modifiedTSs];
  // const monthsAgo = timeStamps.map(t => Math.floor(moment.duration(now - t).asMonths()));
  // const histogram = monthsAgo.groupBy(monthsAgo => monthsAgo).mapEntries(([k, v]) => [k, v.size]);
  // const maxMonths = monthsAgo.max();
  //
  // for (let i = 0; i <= maxMonths; ++i) {
  //   debugLines.push(`${String("  " + i).slice(-3)}: ` + new Array(histogram.get(i, 0)).fill("*").join(""));
  // }
  //
  // return debugLines;
}
