export type DocsMetadata = {
  [key: string]: TopLevelDocsSectionMetadata[] | undefined;
} | TopLevelDocsSectionMetadata[];

export enum NavIcons {
  dataFlow = "dataFlow",
  lightBulb = "lightBulb",
  book = "book",
  analyze = "analyze",
  history = "history",
}

export interface TopLevelDocsSectionMetadata {
  text: string;
  path: string;
  defaultSubPath?: string;
  icon?: NavIcons;
  notVersioned?: boolean;
  default?: boolean;
  sub?: DocsSubsectionMetadata[];
}

export interface DocsSubsectionMetadata {
  text: string;
  path: string;
  sub?: DocsSubsectionMetadata[];
}
