export interface ThesisSource {
  id: string;
  title: string;
  description: string;
  filename: string;
  fileType: string;
  status: "ready" | "unextracted";
  createdAt: string;
}
