import * as Bluebird from "bluebird";
import Dexie from "dexie";

import {Contribution, Document, DocumentContent} from "model/content";

export enum Index {
  CREATED = "creationTimestamp",
  MODIFIED = "modificationTimestamp",
  MODIFIED_BY_ME = "editedTimestamp",
  VIEWED = "viewedTimestamp",
}

export enum Direction {
  ASC = "ASC",
  DESC = "DESC",
}

// See https://dexie.org/docs/Typescript for why a subclass is the preferred pattern in Typescript.
export class DocumentStore extends Dexie {
  /** Opens a new store. */
  public static open(name: string): Bluebird<DocumentStore> {
    const st = new DocumentStore(name);
    return Bluebird.resolve(st.open()).return(st);
  }

  private documents: Dexie.Table<Document, string>;
  private contents: Dexie.Table<DocumentContent, string>;
  private contributions: Dexie.Table<Contribution, string>;

  /** Note: the instance must be openStore()ed before use. */
  constructor(name: string) {
    super(name);
    this.version(1).stores({
      // Maps table names to (primary key, index1, index2, ...)
      documents: "id,creationTimestamp,modificationTimestamp,editedTimestamp,viewedTimestamp",
      contents: "id",
      contributions: ",docId,[author.id+modificationTimestamp]"
    });
  }

  public putDocument(doc: Document): Bluebird<DocumentStore> {
    return Bluebird.resolve(this.documents.put(doc)).return(this);
  }

  public putDocuments(docs: Document[]): Bluebird<DocumentStore> {
    return Bluebird.resolve(this.transaction("rw", [this.documents], () => {
      const table = this.documents;
      docs.forEach(d => table.put(d));
    })).return(this);
  }

  public listDocuments(limit: number, indexName: string, direction: Direction): Bluebird<Document[]> {
    let collection = !!indexName ? this.documents.orderBy(indexName) : this.documents.toCollection();
    if (direction === Direction.DESC) {
      collection = collection.reverse();
    }
    if (limit) {
      collection = collection.limit(limit);
    }
    return Bluebird.resolve(collection.toArray());
  }

  public getDocument(id: string): Bluebird<Document> {
    return Bluebird.resolve(this.documents.get(id));
  }

  public getDocuments(ids: string[]): Bluebird<Document[]> {
    return Bluebird.resolve(this.documents.where(":id").anyOf(ids).toArray());
  }

  public putDocumentContent(content: DocumentContent): Bluebird<DocumentStore> {
    return Bluebird.resolve(this.contents.put(content)).return(this);
  }

  public getDocumentContent(id: string): Bluebird<DocumentContent> {
    return Bluebird.resolve(this.contents.get(id));
  }

  public getDocumentContents(ids: string[]): Bluebird<DocumentContent[]> {
    return Bluebird.resolve(this.contents.where(":id").anyOf(ids).toArray());
  }

  public putContributions(contribs: Contribution[]): Bluebird<DocumentStore> {
    return Bluebird.resolve(this.transaction("rw", [this.contributions], () => {
      const table = this.contributions;
      contribs.forEach(d => table.put(d, d.docId + ":" + d.version));
    })).return(this);
  }

  public findContributionsToDocs(docIds: string[]): Bluebird<Contribution[]> {
    return Bluebird.resolve(this.contributions.where("docId").anyOf(docIds).toArray());
  }

  public findContributionsByAuthor(authorId: string): Bluebird<Contribution[]> {
    return Bluebird.resolve(this.contributions.where("[author.id+modificationTimestamp]")
        .between([authorId], [authorId, Number.MAX_SAFE_INTEGER]).toArray());
  }

  public clear(): Bluebird<unknown> {
    return Bluebird.all([
          this.documents.clear(),
          this.contents.clear(),
          this.contributions.clear()
        ]
    );
  }
}
