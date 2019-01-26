export interface Person {
  readonly id: string;
  readonly displayName: string;
  readonly thumbnailUrl: string;
  readonly emailAddress: string;
  readonly profileUrl: string;
}

export interface Location {
  readonly id: string;
  readonly displayName: string;
  readonly link: string;
  readonly mimeType: string;
}

export interface Contribution {
  readonly docId: string;
  readonly author: Person | undefined;
  readonly version: number | undefined;
  readonly modificationTimestamp: number;
}

export interface Document {
  readonly id: string;
  readonly mimeType: string;
  readonly creationTimestamp: number;
  readonly modificationTimestamp?: number;  // modified by anyone
  readonly viewedTimestamp?: number;  // viewed by me
  readonly editedTimestamp?: number;  // modified by me
  readonly sharedTimestamp?: number;  // shared with me (drive only)
  readonly creator?: Person;
  readonly sharer?: Person;
  readonly lastModifier?: Person;
  readonly parentId: string;
  readonly title: string;
  readonly link: string;
  readonly iconUrl: string;
  readonly thumbnailUrl: string;
  readonly version: number;
  readonly locationPath: Location[];
  readonly raw: any;
}

export interface DocumentContent {
  readonly id: string;
  readonly version?: number;
  readonly modificationTimestamp?: number;
  readonly fetchTimestamp: number;
  readonly mimeType: string;
  readonly content: string;
}

function maybeInt(v: string | undefined) {
  if (v !== undefined && v !== null) {
    return parseInt(v, 10);
  }
}
