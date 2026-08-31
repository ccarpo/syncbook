export type Note = {
  id: string;
  title: string;
  excerpt: string;
  updated_at: string;
  deleted_at: string | null;
  tags: string[];
  owned: boolean;
  owner_email: string;
};
export type User = {
  id: string;
  email: string;
  created_at: string;
};
export type Snapshot = {
  id: string;
  created_at: string;
  excerpt: string;
  state?: string;
};
