export type Note = {
  id: string;
  title: string;
  excerpt: string;
  updated_at: string;
  deleted_at: string | null;
};
export type Snapshot = {
  id: string;
  created_at: string;
  excerpt: string;
  state?: string;
};
