import * as Bluebird from "bluebird";
import {Document, DocumentContent} from "../model/content";
import {Direction, DocumentStore, Index} from "./DocumentStore";
import LocalIndex from "./LocalIndex";

// Plumbing etc for indexing
export class Pipeline {
  public readonly docStore: DocumentStore;
  public readonly index: LocalIndex;

  private readonly titleCount: number;
  private readonly fulltextCount: number;

  constructor(docStore: DocumentStore, titleCount: number, fulltextCount: number) {
    this.docStore = docStore;
    this.index = new LocalIndex();
    this.titleCount = titleCount;
    this.fulltextCount = fulltextCount;
  }

  public clear() {
    console.log("Dropping index");
    this.index.clear();
  }

  public reindexDocIds(ids: string[], fullText = false) {
    console.log(`Reindexing ${ids.length} docs`);
    const getDocs = this.docStore.getDocuments(ids);
    return getDocs.then(docs => fullText ?
        indexFullText(this.index, docs, this.docStore) :
        indexTitle(this.index, docs))
        .tap(() => console.log(`Reindexing done`));
  }

  public reloadIndex(): Bluebird<void> {
    console.log("Reloading local index");
    this.index.clear();
    const begin = Date.now();
    const allDocs = this.docStore.listDocuments(this.titleCount + this.fulltextCount, Index.MODIFIED, Direction.DESC);

    return allDocs.then(docs => {
      console.debug(`Loaded ${docs.length} documents from store`);
      const fulltextDocs = docs.slice(0, this.fulltextCount);
      const titleOnlyDocs = docs.slice(this.fulltextCount, docs.length);

      return indexFullText(this.index, fulltextDocs, this.docStore)
          .finally(() => indexTitle(this.index, titleOnlyDocs));
    }).tap(() => console.log(`Local index constructed in ${Date.now() - begin} ms`));
  }
}

function indexFullText(index: LocalIndex, docs: Document[], docStore: DocumentStore) {
  console.debug(`Indexing fulltext of ${docs.length} documents`);
  return docStore.getDocumentContents(docs.map(d => d.id)).then(contents => {
    const contentById = new Map(contents.map(c => [c.id, c] as [string, DocumentContent]));
    const contentArray = docs.map(d => contentById.get(d.id));
    return index.addMany(docs, contentArray);
  });
}

function indexTitle(index: LocalIndex, docs: Document[]) {
  console.debug(`Indexing title of ${docs.length}`);
  return index.addMany(docs, []);
}
