export type FileCategory = "pdf" | "image" | "step" | "other";

export function getFileCategory(mimeType: string, fileName = ""): FileCategory {
  if (mimeType === "application/pdf") return "pdf";
  if (mimeType.startsWith("image/")) return "image";
  const lower = fileName.toLowerCase();
  if (lower.endsWith(".step") || lower.endsWith(".stp")) return "step";
  return "other";
}
