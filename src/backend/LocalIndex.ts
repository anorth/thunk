import * as Bluebird from "bluebird";
import {Parser} from "htmlparser2";
import MiniSearch, {SearchResult} from "MiniSearch";

import {Document, DocumentContent} from "model/content";
import {Stem} from "./Stemmer";

export interface QueryHit {
  id: string;
  score: number;
}

interface IndexDocument {
  id: string;
  title: string;
  content?: string;
}

/**
 * A locally stored index.
 *
 * TODO:
 * - stopwords?
 *
 * Back-ends considered include:
 * - https://github.com/weixsong/elasticlunr.js
 * - https://github.com/lucaong/minisearch
 * - https://github.com/fergiemcdowall/search-index
 */
export default class LocalIndex {
  private index: MiniSearch;

  constructor() {
    this.index = newIndex();
  }

  public clear() {
    this.index = newIndex();
  }

  /** Adds/updates a document to the index. */
  public addDocument(doc: Document, docContent?: DocumentContent) {
    this.remove(doc.id);
    this.index.add(this.marshal(doc, docContent));
  }

  /** Adds/updates many documents to the index. */
  public addMany(docs: Document[], contents: DocumentContent[]): Bluebird<void> {
    contents.fill(undefined, contents.length, docs.length);
    const marshalled: IndexDocument[] = [];
    for (let i = 0; i < docs.length; i++) {
      this.remove(docs[i].id);
      marshalled.push(this.marshal(docs[i], contents[i]));
    }
    return Bluebird.resolve(this.index.addAllAsync(marshalled, {chunkSize: 40}));
  }

  public search(query: string): QueryHit[] {
    const options = {
      // fields: fields to search
      // prefix: whether to perform prefix search
      // fuzzy: number >=1 gives max edit distance to match
      // combineWith: 'AND'|'OR' (default 'OR')
      // tokenize: tokenizer for query (defaults to index default)
      // processTerm: term processor for query (defaults to index default)
    };
    const results = this.index.search(query, options);
    return results.map((res: SearchResult) => ({id: res.id, score: res.score}));
  }

  private get(id: string): SearchResult | null {
    const found = this.index.search(id, {
      fields: ["id"],
      // Disable tokenization and stemming when looking up ids.
      tokenize: (w: string) => [w],
      processTerm: (w: string) => w
    });
    return found.length > 0 ? found[0] : null;
  }

  private remove(id: string): SearchResult | null {
    const found = this.get(id);
    if (found != null) {
      this.index.remove(found);
    }
    return found;
  }

  private marshal(doc: Document, content?: DocumentContent): IndexDocument {
    let textContent;
    if (content) {
      textContent = content.mimeType === "text/html" ? html2Text(content.content) : content.content;
    }

    return {
      id: doc.id,
      title: doc.title,
      content: textContent || undefined
    };
  }
}

function newIndex() {
  // The default tokenizer splits on space and punctuation characters. It's very possible we can do better.
  // The default term processor just lowercases it.
  return new MiniSearch({
    idField: "id",
    fields: ["title", "content"],
    // tokenize: (s: string) => s.split(/[^a-zA-Z0-9\u00C0-\u017F]+/)
    //     .filter(term => term.length > 1),
    processTerm: (term: string) => Stem(term.toLowerCase()),
    searchOptions: {
      boost: {title: 10}
    },
  });
}

function html2Text(html: string) {
  const pieces: string[] = [];
  const parser = new Parser({
    ontext: text => pieces.push(text.trim())
  });
  parser.write(html);
  parser.end();
  return pieces.join(" ");
}
