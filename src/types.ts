/** true — є, false — немає, null — невідомо (порожня клітинка) */
export type FeatureValue = boolean | null;

export interface Club {
  id: string;
  name: string;
  status: Record<string, FeatureValue>;
}

export interface Sheet {
  updatedAt: string | null;
  features: string[];
  clubs: Club[];
}

export interface CityGroup {
  id: string;
  city: string;
  clubs: Club[];
}

export interface FieldChange {
  feature: string;
  before: FeatureValue;
  after: FeatureValue;
}

export interface ClubChange {
  club: Club;
  fields: FieldChange[];
}

export interface Snapshot {
  updatedAt: string | null;
  clubs: Club[];
}
